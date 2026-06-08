// SPDX-License-Identifier: MIT
pragma solidity >=0.8.4;

import { IAlgebraPool } from "@cryptoalgebra/integral-core/contracts/interfaces/IAlgebraPool.sol";
import { TickMath } from "@cryptoalgebra/integral-core/contracts/libraries/TickMath.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { INonfungiblePositionManager } from "@cryptoalgebra/integral-periphery/contracts/interfaces/INonfungiblePositionManager.sol";

library ExternalPriceRebalance {
    using SafeERC20 for IERC20;

    error InvalidPosition();
    error NonZeroLiquidity();
    error TargetPriceNotReached();
    error ZeroAddress();
    error ZeroValue();

    // 100 wei of each token is sufficient to create a meaningful temporary position
    // and is negligible relative to any realistic vault reserve.
    uint256 private constant TEMPORARY_TOKEN_AMOUNT = 100;

    /**
     @notice Moves an Algebra pool to an externally supplied price using a minimal
     NFT temporary position at the target price range.
     @dev The vault must have approved the NFT manager for both tokens before calling.
     The target is trusted in the current version; production integrations should validate
     keeper authorization, freshness, and maximum price deviation before calling the vault.
     @param poolAddress The Algebra pool whose price is to be moved.
     @param nftManager The NonfungiblePositionManager used to mint the temporary position.
     @param pluginDeployer The plugin deployer address required by the pool's NFT mint.
     @param tickSpacing The pool's tick spacing.
     @param targetSqrtPriceX96 The desired pool price after the swap.
     @param swapPayer Address that pre-funds the swap input and receives the swap output.
                    Pass address(this) to use the vault's own token balance instead of pulling funds.
     @param maxSwapInput Maximum input tokens the swap may consume.
     */
    function movePrice(
        address poolAddress,
        address nftManager,
        address pluginDeployer,
        int24 tickSpacing,
        uint160 targetSqrtPriceX96,
        address swapPayer,
        uint256 maxSwapInput
    ) public returns (uint256 fee0, uint256 fee1) {
        if (swapPayer == address(0)) revert ZeroAddress();

        IAlgebraPool pool = IAlgebraPool(poolAddress);
        (uint160 currentSqrtPriceX96, , , , uint128 activeLiquidity, , ) = pool.safelyGetStateOfAMM();
        if (activeLiquidity != 0) revert NonZeroLiquidity();

        if (targetSqrtPriceX96 != currentSqrtPriceX96) {
            if (maxSwapInput == 0 || maxSwapInput > uint256(type(int256).max)) revert ZeroValue();

            bool zeroToOne = targetSqrtPriceX96 < currentSqrtPriceX96;
            (int24 targetLower, int24 targetUpper) = _temporaryPositionTicks(
                targetSqrtPriceX96,
                tickSpacing,
                zeroToOne
            );

            uint256 positionId = _mintTemporaryPosition(
                pool,
                nftManager,
                pluginDeployer,
                targetLower,
                targetUpper
            );

            address inputToken = zeroToOne ? pool.token0() : pool.token1();
            bool payerIsVault = swapPayer == address(this);
            if (!payerIsVault) {
                IERC20(inputToken).safeTransferFrom(swapPayer, address(this), maxSwapInput);
            }

            (int256 amount0, int256 amount1) = pool.swap(
                swapPayer,
                zeroToOne,
                int256(maxSwapInput),
                targetSqrtPriceX96,
                bytes("")
            );

            uint256 actualSwapInput = uint256(zeroToOne ? amount0 : amount1);
            if (!payerIsVault) {
                IERC20(inputToken).safeTransfer(swapPayer, maxSwapInput - actualSwapInput);
            }

            (fee0, fee1) = _dismantleTemporaryPosition(nftManager, positionId);
        }

        uint160 resultingSqrtPriceX96;
        (resultingSqrtPriceX96, , , , activeLiquidity, , ) = pool.safelyGetStateOfAMM();
        if (resultingSqrtPriceX96 != targetSqrtPriceX96) revert TargetPriceNotReached();
        if (activeLiquidity != 0) revert NonZeroLiquidity();
    }

    /**
     @notice Mints a minimal NFT position at the given range via the NFT manager.
     @dev The vault must have approved the NFT manager before calling.
     The temporary position uses small fixed token amounts so that the vault's
     token balance is barely changed. The position is single-sided by design:
     if the target range is entirely above the current tick only token0 is consumed,
     and vice versa. The pool will only accept the relevant token anyway, so passing
     both keeps this function direction-agnostic.
     */
    function _mintTemporaryPosition(
        IAlgebraPool pool,
        address nftManager,
        address pluginDeployer,
        int24 tickLower,
        int24 tickUpper
    ) private returns (uint256 positionId) {
        (positionId, , , ) = INonfungiblePositionManager(nftManager).mint(
            INonfungiblePositionManager.MintParams({
                token0: pool.token0(),
                token1: pool.token1(),
                deployer: pluginDeployer,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: TEMPORARY_TOKEN_AMOUNT,
                amount1Desired: TEMPORARY_TOKEN_AMOUNT,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(this),
                deadline: block.timestamp
            })
        );
    }

    function _dismantleTemporaryPosition(
        address nftManager,
        uint256 positionId
    ) private returns (uint256 fee0, uint256 fee1) {
        INonfungiblePositionManager nft = INonfungiblePositionManager(nftManager);

        (, , , , , , , uint128 liquidity, , , , ) = nft.positions(positionId);
        uint256 burned0;
        uint256 burned1;
        if (liquidity > 0) {
            (burned0, burned1) = nft.decreaseLiquidity(
                INonfungiblePositionManager.DecreaseLiquidityParams({
                    tokenId: positionId,
                    liquidity: liquidity,
                    amount0Min: 0,
                    amount1Min: 0,
                    deadline: block.timestamp
                })
            );
        }
        (uint256 collected0, uint256 collected1) = nft.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: positionId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );
        nft.burn(positionId);
        fee0 = collected0 - burned0;
        fee1 = collected1 - burned1;
    }

    function _temporaryPositionTicks(
        uint160 targetSqrtPriceX96,
        int24 tickSpacing,
        bool zeroToOne
    ) private pure returns (int24 tickLower, int24 tickUpper) {
        int24 targetTick = TickMath.getTickAtSqrtRatio(targetSqrtPriceX96);
        int24 roundedDownTick = (targetTick / tickSpacing) * tickSpacing;
        if (targetTick < 0 && targetTick % tickSpacing != 0) roundedDownTick -= tickSpacing;

        tickLower = roundedDownTick;
        tickUpper = roundedDownTick + tickSpacing;

        // For an upward move to an aligned tick, liquidity must be active immediately below the target.
        if (!zeroToOne && targetSqrtPriceX96 == TickMath.getSqrtRatioAtTick(roundedDownTick)) {
            tickLower -= tickSpacing;
            tickUpper -= tickSpacing;
        }

        if (tickLower < TickMath.MIN_TICK || tickUpper > TickMath.MAX_TICK) revert InvalidPosition();
    }
}

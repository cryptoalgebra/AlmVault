// SPDX-License-Identifier: BUSL-1.1

pragma solidity >=0.8.4;

import { SafeMath } from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { UV3Math } from "./lib/UV3Math.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import {
    IAlgebraSwapCallback
} from "@cryptoalgebra/integral-core/contracts/interfaces/callback/IAlgebraSwapCallback.sol";
import { IAlgebraPool } from "@cryptoalgebra/integral-core/contracts/interfaces/IAlgebraPool.sol";
import {
    INonfungiblePositionManager
} from "@cryptoalgebra/integral-periphery/contracts/interfaces/INonfungiblePositionManager.sol";
import {
    IBasePluginV1Factory
} from "@cryptoalgebra/integral-base-plugin/contracts/interfaces/IBasePluginV1Factory.sol";

import { IICHIVault } from "./interfaces/IICHIVault.sol";
import { IICHIVaultFactory } from "./interfaces/IICHIVaultFactory.sol";

/**
 @notice A Uniswap V2-like interface with fungible liquidity to Uniswap V3
 which allows for either one-sided or two-sided liquidity provision.
 ICHIVaults should be deployed by the ICHIVaultFactory.
 ICHIVaults should not be used with tokens that charge transaction fees.
 */
contract ICHIVault is IICHIVault, IAlgebraSwapCallback, ERC20, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    address public immutable override ichiVaultFactory;
    address public immutable override pool;
    address public immutable override token0;
    address public immutable override token1;
    bool public immutable override allowToken0;
    bool public immutable override allowToken1;

    address public override ammFeeRecipient;
    address public override affiliate;

    // Position tracking
    uint256 public override basePositionId;
    uint256 public override limitPositionId;

    uint256 public override deposit0Max;
    uint256 public override deposit1Max;
    uint256 public override hysteresis;

    uint256 public constant PRECISION = 10 ** 18;
    uint256 constant PERCENT = 100;
    address constant NULL_ADDRESS = address(0);
    uint256 constant MIN_SHARES = 1000;

    uint32 public twapPeriod;

    /**
     @notice Creates an ICHIVault instance based on Uniswap V3 pool. Controls liquidity provision types.
     @param _pool Address of the Uniswap V3 pool for liquidity management.
     @param _allowToken0 Flag indicating if token0 deposits are allowed.
     @param _allowToken1 Flag indicating if token1 deposits are allowed.
     @param __owner Owner address of the ICHIVault.
     @param _twapPeriod TWAP period for hysteresis checks.
     @param _vaultIndex Index of the vault in the factory.
     */
    constructor(
        address _pool,
        bool _allowToken0,
        bool _allowToken1,
        address __owner,
        uint32 _twapPeriod,
        uint256 _vaultIndex
    ) ERC20("ICHI Vault Liquidity", UV3Math.computeIVsymbol(_vaultIndex, _pool, _allowToken0)) {
        require(_pool != NULL_ADDRESS, "IV.constructor: zero address");
        require((_allowToken0 && !_allowToken1) ||
                (_allowToken1 && !_allowToken0), "IV.constructor: must be single sided");

        ichiVaultFactory = msg.sender;
        pool = _pool;
        token0 = IAlgebraPool(_pool).token0();
        token1 = IAlgebraPool(_pool).token1();
        allowToken0 = _allowToken0;
        allowToken1 = _allowToken1;
        twapPeriod = _twapPeriod;

        transferOwnership(__owner);

        hysteresis = PRECISION.div(PERCENT).div(2); // 0.5% threshold
        deposit0Max = type(uint256).max; // max uint256
        deposit1Max = type(uint256).max; // max uint256
        ammFeeRecipient = NULL_ADDRESS; // by default there is no amm fee recipient address;
        affiliate = NULL_ADDRESS; // by default there is no affiliate address

        // Approve NFT manager to spend tokens
        IERC20(token0).approve(IICHIVaultFactory(ichiVaultFactory).nftManager(), type(uint256).max);
        IERC20(token1).approve(IICHIVaultFactory(ichiVaultFactory).nftManager(), type(uint256).max);

        emit DeployICHIVault(msg.sender, _pool, _allowToken0, _allowToken1, __owner, _twapPeriod);
    }

    /// @notice gets baseLower tick from the base position
    /// @return int24 baseLower tick
    function baseLower() external view override returns (int24) {
        if (basePositionId == 0) return 0;
        (,,,,,int24 tickLower,,,,,,) = _nftManager().positions(basePositionId);
        return tickLower;
    }

    /// @notice gets baseUpper tick from the base position
    /// @return int24 baseUpper tick
    function baseUpper() external view override returns (int24) {
        if (basePositionId == 0) return 0;
        (,,,,,,int24 tickUpper,,,,,) = _nftManager().positions(basePositionId);
        return tickUpper;
    }

    /// @notice gets limitLower tick from the limit position
    /// @return int24 limitLower tick
    function limitLower() external view override returns (int24) {
        if (limitPositionId == 0) return 0;
        (,,,,,int24 tickLower,,,,,,) = _nftManager().positions(limitPositionId);
        return tickLower;
    }

    /// @notice gets limitUpper tick from the limit position
    /// @return int24 limitUpper tick
    function limitUpper() external view override returns (int24) {
        if (limitPositionId == 0) return 0;
        (,,,,,,int24 tickUpper,,,,,) = _nftManager().positions(limitPositionId);
        return tickUpper;
    }

    /// @notice resets allowances for the NFT manager
    function resetAllowances() external override onlyOwner {
        IERC20(token0).approve(address(_nftManager()), type(uint256).max);
        IERC20(token1).approve(address(_nftManager()), type(uint256).max);
    }

    /// @notice sets TWAP period for hysteresis checks
    /// @dev onlyOwner
    /// @param newTwapPeriod new TWAP period
    function setTwapPeriod(uint32 newTwapPeriod) external onlyOwner {
        require(newTwapPeriod > 0, "IV.setTwapPeriod: missing period");
        twapPeriod = newTwapPeriod;
        emit SetTwapPeriod(msg.sender, newTwapPeriod);
    }

    /// @notice collects fees and tokens from the positions and burns the NFTs
    /// @param positionId NFT position ID
    function _dismantlePosition(uint256 positionId) internal {
        if (positionId != 0) {
            _nftManager().decreaseLiquidity(
                INonfungiblePositionManager.DecreaseLiquidityParams({
                    tokenId: positionId,
                    liquidity: _getPositionLiquidity(positionId),
                    amount0Min: 0,
                    amount1Min: 0,
                    deadline: block.timestamp
                })
            );

            _nftManager().collect(
                INonfungiblePositionManager.CollectParams({
                    tokenId: positionId,
                    recipient: address(this),
                    amount0Max: type(uint128).max,
                    amount1Max: type(uint128).max
                })
            );
            _nftManager().burn(positionId);
            // not setting positionId to 0, as it is done in the rebalance->mint functions
        }
    }

    /// @notice gets NFT manager
    /// @return INonfungiblePositionManager NFT manager
    function _nftManager() internal view returns (INonfungiblePositionManager) {
        return INonfungiblePositionManager(IICHIVaultFactory(ichiVaultFactory).nftManager());
    }

    /// @notice collects fees from the position
    /// @param positionId NFT position ID
    function _collectFromPosition(uint256 positionId) internal returns (uint256 fees0, uint256 fees1) {
        if (positionId == 0) {
            return (0, 0);
        }
        (uint256 _fees0, uint256 _fees1) = _nftManager().collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: positionId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );
        fees0 = _fees0;
        fees1 = _fees1;
    }

    /// @notice collects fees from both positions and distributes them
    /// @param withEvent flag to emit CollectFees event (false in rebalances, true otherwise)
    /// @return fees0 collected fees in token0
    /// @return fees1 collected fees in token1
    function _cleanPositions(bool withEvent) internal returns (uint256 fees0, uint256 fees1) {
        fees0 = 0;
        fees1 = 0;
        if (basePositionId != 0) {
            (uint256 feesBase0, uint256 feesBase1) = _collectFromPosition(basePositionId);
            fees0 = fees0.add(feesBase0);
            fees1 = fees1.add(feesBase1);
        }
        if (limitPositionId != 0) {
            (uint256 feesLimit0, uint256 feesLimit1) = _collectFromPosition(limitPositionId);
            fees0 = fees0.add(feesLimit0);
            fees1 = fees1.add(feesLimit1);
        }
        if (fees0 > 0 || fees1 > 0) {
            _distributeFees(fees0, fees1);
            if (withEvent) {
                emit CollectFees(msg.sender, fees0, fees1);
            }
        }
    }

    /**
    @notice Internal function to mint an NFT position
    @param tickLower Lower tick of the position
    @param tickUpper Upper tick of the position
    @param amount0Desired Desired amount of token0
    @param amount1Desired Desired amount of token1
    @return positionId ID of the minted NFT position
    */
    function _mintPosition(
        int24 tickLower,
        int24 tickUpper,
        uint256 amount0Desired,
        uint256 amount1Desired
    ) internal returns (uint256 positionId) {
        // Don't try to mint if we don't have any tokens
        if (amount0Desired == 0 && amount1Desired == 0) {
            return 0;
        }

        // Get current tick to determine if position can be minted
        int24 currentTick = currentTick();

        // If current tick is within or on the boundaries of our range, we need both tokens
        if (currentTick >= tickLower && currentTick < tickUpper) {
            if (amount0Desired == 0 || amount1Desired == 0) {
                return 0;
            }
        }
        // If entirely above current tick (not including boundary), we only need token0
        else if (currentTick < tickLower) {
            if (amount0Desired == 0) {
                return 0;
            }
        }
        // If entirely below current tick (including boundary), we only need token1
        else if (currentTick >= tickUpper) {
            if (amount1Desired == 0) {
                return 0;
            }
        }

        (positionId, , , ) = _nftManager().mint(
            INonfungiblePositionManager.MintParams({
                token0: token0,
                token1: token1,
                deployer: address(0),
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: amount0Desired,
                amount1Desired: amount1Desired,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(this),
                deadline: block.timestamp
            })
        );
    }

    /// @notice mints base position
    /// @param _baseLower lower tick of the base position
    /// @param _baseUpper upper tick of the base position
    /// @param amount0Desired desired amount of token0
    /// @param amount1Desired desired amount of token1
    function _mintBasePosition(
        int24 _baseLower,
        int24 _baseUpper,
        uint256 amount0Desired,
        uint256 amount1Desired
    ) internal {
        basePositionId = _mintPosition(_baseLower, _baseUpper, amount0Desired, amount1Desired);
    }

    /// @notice mints limit position
    /// @param _limitLower lower tick of the limit position
    /// @param _limitUpper upper tick of the limit position
    /// @param amount0Desired desired amount of token0
    /// @param amount1Desired desired amount of token1
    function _mintLimitPosition(
        int24 _limitLower,
        int24 _limitUpper,
        uint256 amount0Desired,
        uint256 amount1Desired
    ) internal {
        limitPositionId = _mintPosition(_limitLower, _limitUpper, amount0Desired, amount1Desired);
    }

    /**
     @notice Distributes shares based on token1 value, adjusted by liquidity shares and pool's AUM in token1.
     @param deposit0 Token0 amount transferred from sender to ICHIVault.
     @param deposit1 Token1 amount transferred from sender to ICHIVault.
     @param to Recipient address for minted liquidity tokens.
     @return shares Number of liquidity tokens minted for deposit.
     */
    function deposit(
        uint256 deposit0,
        uint256 deposit1,
        address to
    ) external override nonReentrant returns (uint256 shares) {
        require(allowToken0 || deposit0 == 0, "IV.deposit: token0 not allowed");
        require(allowToken1 || deposit1 == 0, "IV.deposit: token1 not allowed");
        require(deposit0 > 0 || deposit1 > 0, "IV.deposit: deposits must be > 0");
        require(deposit0 < deposit0Max && deposit1 < deposit1Max, "IV.deposit: deposits too large");
        require(to != NULL_ADDRESS && to != address(this), "IV.deposit: to");

        // Get spot price
        uint256 price = _fetchSpot(token0, token1, currentTick(), PRECISION);

        // Get TWAP price
        uint256 twap = _fetchTwap(pool, token0, token1, twapPeriod, PRECISION);

        // Check price manipulation
        uint256 delta = (price > twap)
            ? price.sub(twap).mul(PRECISION).div(price)
            : twap.sub(price).mul(PRECISION).div(twap);
        if (delta > hysteresis) require(checkHysteresis(), "IV.deposit: try later");

        // Clean positions and collect/distribute fees
        _cleanPositions(true);

        // Get total amounts including current positions with updated fees
        (uint256 pool0, uint256 pool1) = getTotalAmounts();

        // Transfer tokens from depositor
        if (deposit0 > 0) {
            IERC20(token0).safeTransferFrom(msg.sender, address(this), deposit0);
        }
        if (deposit1 > 0) {
            IERC20(token1).safeTransferFrom(msg.sender, address(this), deposit1);
        }

        // Calculate share value in token1
        uint256 deposit0PricedInToken1 = deposit0.mul((price < twap) ? price : twap).div(PRECISION);

        // Calculate shares to mint
        shares = deposit1.add(deposit0PricedInToken1);

        if (totalSupply() != 0) {
            uint256 pool0PricedInToken1 = pool0.mul((price > twap) ? price : twap).div(PRECISION);
            shares = shares.mul(totalSupply()).div(pool0PricedInToken1.add(pool1));
        } else {
            shares = shares.mul(MIN_SHARES);
        }

        _mint(to, shares);
        emit Deposit(msg.sender, to, shares, deposit0, deposit1);
    }

    /**
    @notice Decreases liquidity from NFT position proportional to shares
    @param positionId NFT position ID
    @param shares Amount of shares being withdrawn
    @param totalSupply Total supply of shares
    @param to Address to receive tokens
    @return amount0 Token0 amount withdrawn
    @return amount1 Token1 amount withdrawn
    */
    function _withdrawFromPosition(
        uint256 positionId,
        uint256 shares,
        uint256 totalSupply,
        address to
    ) internal returns (uint256 amount0, uint256 amount1) {
        // this function is always called after _cleanPositions is aleady called

        // Get position info
        (
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            uint128 positionLiquidity,
            ,
            ,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        ) = _nftManager().positions(positionId);

        // should not be happening, safety check
        require(tokensOwed0 == 0 && tokensOwed1 == 0, "IV.withdraw: tokens owed");

        // Calculate proportional liquidity
        uint128 liquidityToDecrease = uint128(uint256(positionLiquidity).mul(shares).div(totalSupply));

        if (liquidityToDecrease > 0) {
            // Decrease liquidity
            (amount0, amount1) = _nftManager().decreaseLiquidity(
                INonfungiblePositionManager.DecreaseLiquidityParams({
                    tokenId: positionId,
                    liquidity: liquidityToDecrease,
                    amount0Min: 0,
                    amount1Min: 0,
                    deadline: block.timestamp
                })
            );

            // Collect tokens
            _nftManager().collect(
                INonfungiblePositionManager.CollectParams({
                    tokenId: positionId,
                    recipient: to,
                    amount0Max: uint128(amount0),
                    amount1Max: uint128(amount1)
                })
            );
        }
    }
    /**
     @notice Redeems shares for a proportion of ICHIVault's AUM, matching the share percentage of total issued.
     @param shares Quantity of liquidity tokens to redeem as pool assets.
     @param to Address receiving the redeemed pool assets.
     @return amount0 Token0 amount received from liquidity token redemption.
     @return amount1 Token1 amount received from liquidity token redemption.
     */
    function withdraw(
        uint256 shares,
        address to
    ) external override nonReentrant returns (uint256 amount0, uint256 amount1) {
        require(shares > 0, "IV.withdraw: shares");
        require(to != NULL_ADDRESS, "IV.withdraw: to");

        uint256 _totalSupply = totalSupply();
        require(shares == _totalSupply || _totalSupply >= shares.add(MIN_SHARES), "IV.withdraw: min shares");

        // Clean positions and collect/distribute fees
        _cleanPositions(true);

        // Withdraw from positions
        uint256 base0;
        uint256 base1;
        uint256 limit0;
        uint256 limit1;

        if (basePositionId != 0) {
            (base0, base1) = _withdrawFromPosition(basePositionId, shares, _totalSupply, to);
        }

        if (limitPositionId != 0) {
            (limit0, limit1) = _withdrawFromPosition(limitPositionId, shares, _totalSupply, to);
        }

        // Add proportional share of unused balances
        uint256 unusedAmount0 = IERC20(token0).balanceOf(address(this)).mul(shares).div(_totalSupply);
        uint256 unusedAmount1 = IERC20(token1).balanceOf(address(this)).mul(shares).div(_totalSupply);
        if (unusedAmount0 > 0) IERC20(token0).safeTransfer(to, unusedAmount0);
        if (unusedAmount1 > 0) IERC20(token1).safeTransfer(to, unusedAmount1);

        // Calculate total amounts returned
        amount0 = base0.add(limit0).add(unusedAmount0);
        amount1 = base1.add(limit1).add(unusedAmount1);

        _burn(msg.sender, shares);

        emit Withdraw(msg.sender, to, shares, amount0, amount1);
    }

    /**
     @notice Updates LP positions in the ICHIVault.
     @dev First places a base position symmetrically around current price, using one token fully.
     Remaining token forms a single-sided order.
     @param _baseLower Lower tick of the base position.
     @param _baseUpper Upper tick of the base position.
     @param _limitLower Lower tick of the limit position.
     @param _limitUpper Upper tick of the limit position.
     @param swapQuantity Token swap quantity; positive for token0 to token1, negative for token1 to token0.
     */
    function rebalance(
        int24 _baseLower,
        int24 _baseUpper,
        int24 _limitLower,
        int24 _limitUpper,
        int256 swapQuantity
    ) external override nonReentrant onlyOwner {
        int24 tickSpacing_ = IAlgebraPool(pool).tickSpacing();
        require(
            _baseLower < _baseUpper && _baseLower % tickSpacing_ == 0 && _baseUpper % tickSpacing_ == 0,
            "IV.rebalance: base position invalid"
        );
        require(
            _limitLower < _limitUpper && _limitLower % tickSpacing_ == 0 && _limitUpper % tickSpacing_ == 0,
            "IV.rebalance: limit position invalid"
        );
        require(_baseLower != _limitLower || _baseUpper != _limitUpper, "IV.rebalance: identical positions");

        // Clean positions and collect/distribute fees
        (uint256 fees0, uint256 fees1) = _cleanPositions(false);

        // dismantle positions, collect all tokens (fees already collected)
        _dismantlePosition(basePositionId);
        _dismantlePosition(limitPositionId);

        // swap tokens if required
        if (swapQuantity != 0) {
            IAlgebraPool(pool).swap(
                address(this),
                swapQuantity > 0,
                swapQuantity > 0 ? swapQuantity : -swapQuantity,
                swapQuantity > 0 ? UV3Math.MIN_SQRT_RATIO + 1 : UV3Math.MAX_SQRT_RATIO - 1,
                abi.encode(address(this))
            );
        }

        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));

        emit Rebalance(
            currentTick(),
            balance0,
            balance1,
            fees0,
            fees1,
            totalSupply()
        );

        _mintBasePosition(_baseLower, _baseUpper,
            balance0, balance1);
        // balances had changed, so we need to recalculate them for the limit position
        _mintLimitPosition(_limitLower, _limitUpper,
            IERC20(token0).balanceOf(address(this)),
            IERC20(token1).balanceOf(address(this))
        );
    }

    /**
     @notice Collects and distributes fees from ICHIVault's LP positions. Transaction can be paid by anyone.
     @return fees0 Collected fees in token0.
     @return fees1 Collected fees in token1.
     */
    function collectFees() external override nonReentrant returns (uint256 fees0, uint256 fees1) {
        (uint256 _fees0, uint256 _fees1) = _cleanPositions(true);
        return (_fees0, _fees1);
    }

    /// @notice min function
    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    /**
     @notice Sends portion of swap fees to ammFeeRecepient, feeRecipient and affiliate.
     @param fees0 fees for token0
     @param fees1 fees for token1
     */
    function _distributeFees(uint256 fees0, uint256 fees1) internal {
        uint256 ammFee = IICHIVaultFactory(ichiVaultFactory).ammFee();
        uint256 baseFee = IICHIVaultFactory(ichiVaultFactory).baseFee();

        // Make sure there are always enough fees to distribute
        fees0 = min(fees0, IERC20(token0).balanceOf(address(this)));
        fees1 = min(fees1, IERC20(token1).balanceOf(address(this)));

        // baseFeeRecipient cannot be NULL. This is checked and controlled in the factory
        // ammFeeRecipient could be NULL, in this case ammFees are not taken
        // ammFee + baseFee is always <= 100%. Also controlled in the factory

        if (ammFee > 0 && ammFeeRecipient != NULL_ADDRESS) {
            if (fees0 > 0) {
                IERC20(token0).safeTransfer(ammFeeRecipient, fees0.mul(ammFee).div(PRECISION));
            }
            if (fees1 > 0) {
                IERC20(token1).safeTransfer(ammFeeRecipient, fees1.mul(ammFee).div(PRECISION));
            }
        }

        if (baseFee > 0) {
            // if there is no affiliate 100% of the baseFee should go to feeRecipient
            uint256 baseFeeSplit = (affiliate == NULL_ADDRESS)
                ? PRECISION
                : IICHIVaultFactory(ichiVaultFactory).baseFeeSplit();
            address feeRecipient = IICHIVaultFactory(ichiVaultFactory).feeRecipient();

            if (fees0 > 0) {
                uint256 totalFee = fees0.mul(baseFee).div(PRECISION);
                uint256 toRecipient = totalFee.mul(baseFeeSplit).div(PRECISION);
                uint256 toAffiliate = totalFee.sub(toRecipient);
                IERC20(token0).safeTransfer(feeRecipient, toRecipient);
                if (toAffiliate > 0) {
                    IERC20(token0).safeTransfer(affiliate, toAffiliate);
                }
            }
            if (fees1 > 0) {
                uint256 totalFee = fees1.mul(baseFee).div(PRECISION);
                uint256 toRecipient = totalFee.mul(baseFeeSplit).div(PRECISION);
                uint256 toAffiliate = totalFee.sub(toRecipient);
                IERC20(token1).safeTransfer(feeRecipient, toRecipient);
                if (toAffiliate > 0) {
                    IERC20(token1).safeTransfer(affiliate, toAffiliate);
                }
            }
        }
    }

    /**
     @notice Checks if the last price change happened in the current block
     */
    function checkHysteresis() private view returns (bool) {
        address basePlugin = IBasePluginV1Factory(IICHIVaultFactory(ichiVaultFactory).basePluginFactory()).pluginByPool(
            pool
        );
        // make sure the base plugin is connected to the pool
        require(UV3Math.isOracleConnectedToPool(basePlugin, pool), "IV.checkHysteresis: diconnected plugin");

        // get latest timestamp from the plugin
        (, uint32 blockTimestamp) = UV3Math.lastTimepointMetadata(basePlugin);
        return (block.timestamp != blockTimestamp);
    }

    /**
     @notice Returns the current fee in the pool
     @return fee_ current fee in the pool
     */
    function fee() external view override returns (uint24 fee_) {
        (, , fee_, , , ) = IAlgebraPool(pool).globalState();
    }

    /**
     @notice Sets the hysteresis threshold, in percentage points (10**16 = 1%). Triggers a flashloan attack
     check when the difference between spot price and TWAP exceeds this threshold.
     @dev Accessible only by the owner.
     @param _hysteresis Hysteresis threshold value.
     */
    function setHysteresis(uint256 _hysteresis) external override onlyOwner {
        hysteresis = _hysteresis;
        emit Hysteresis(msg.sender, _hysteresis);
    }

    /**
     @notice Sets the AMM fee recipient account address, where portion of the collected swap fees will be distributed
     @dev onlyOwner
     @param _ammFeeRecipient The AMM fee recipient account address
     */
    function setAmmFeeRecipient(address _ammFeeRecipient) external override onlyOwner {
        ammFeeRecipient = _ammFeeRecipient;
        emit AmmFeeRecipient(msg.sender, _ammFeeRecipient);
    }

    /**
     @notice Sets the affiliate account address where portion of the collected swap fees will be distributed
     @dev onlyOwner
     @param _affiliate The affiliate account address
     */
    function setAffiliate(address _affiliate) external override onlyOwner {
        affiliate = _affiliate;
        emit Affiliate(msg.sender, _affiliate);
    }

    /**
     @notice Sets the maximum token0 and token1 amounts the contract allows in a deposit
     @dev onlyOwner
     @param _deposit0Max The maximum amount of token0 allowed in a deposit
     @param _deposit1Max The maximum amount of token1 allowed in a deposit
     */
    function setDepositMax(uint256 _deposit0Max, uint256 _deposit1Max) external override onlyOwner {
        deposit0Max = _deposit0Max;
        deposit1Max = _deposit1Max;
        emit DepositMax(msg.sender, _deposit0Max, _deposit1Max);
    }

    /**
     @notice Returns the current tickSpacing in the pool
     @return tickSpacing current tickSpacing in the pool
     */
    function tickSpacing() external view override returns (int24) {
        return IAlgebraPool(pool).tickSpacing();
    }

    /**
     @notice Calculates total quantity of token0 and token1 in both positions (and unused in the ICHIVault)
     @return total0 Quantity of token0 in both positions (and unused in the ICHIVault)
     @return total1 Quantity of token1 in both positions (and unused in the ICHIVault)
     */
    function getTotalAmounts() public view override returns (uint256 total0, uint256 total1) {
        (, uint256 base0, uint256 base1) = getBasePosition();
        (, uint256 limit0, uint256 limit1) = getLimitPosition();
        total0 = IERC20(token0).balanceOf(address(this)).add(base0).add(limit0);
        total1 = IERC20(token1).balanceOf(address(this)).add(base1).add(limit1);
    }

    /**
    * @notice Gets position info and calculates token amounts for a given NFT position
    * @param positionId NFT position ID to query
    * @return liquidity Amount of liquidity in the position
    * @return amount0 Amount of token0 in position (including fees)
    * @return amount1 Amount of token1 in position (including fees)
    */
    function _getPositionAmounts(
        uint256 positionId
    ) internal view returns (uint128 liquidity, uint256 amount0, uint256 amount1) {
        if (positionId == 0) {
            return (0, 0, 0);
        }

        // Get current position info from NFT manager
        (
            ,
            ,
            ,
            ,
            ,
            int24 tickLower,
            int24 tickUpper,
            uint128 positionLiquidity,
            ,
            ,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        ) = _nftManager().positions(positionId);

        // Get current price from pool for amount calculation
        (uint160 sqrtRatioX96, , , , , ) = IAlgebraPool(pool).globalState();

        // Calculate amounts for the current liquidity
        (amount0, amount1) = UV3Math.getAmountsForLiquidity(
            sqrtRatioX96,
            UV3Math.getSqrtRatioAtTick(tickLower),
            UV3Math.getSqrtRatioAtTick(tickUpper),
            positionLiquidity
        );

        // Add any uncollected fees
        amount0 = amount0.add(uint256(tokensOwed0));
        amount1 = amount1.add(uint256(tokensOwed1));
        liquidity = positionLiquidity;
    }

    /**
    * @notice Gets position liquidity for a given NFT position
    * @param positionId NFT position ID to query
    * @return liquidity Amount of liquidity in the position
    */
    function _getPositionLiquidity(
        uint256 positionId
    ) internal view returns (uint128 liquidity) {
        if (positionId == 0) {
            return 0;
        }

        // Get current position info from NFT manager
        (
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            uint128 positionLiquidity,
            ,
            ,
            ,
        ) = _nftManager().positions(positionId);
        liquidity = positionLiquidity;
    }

    /**
     @notice Calculates amount of total liquidity in the base position
     @return liquidity Amount of total liquidity in the base position
     @return amount0 Estimated amount of token0 that could be collected by burning the base position
     @return amount1 Estimated amount of token1 that could be collected by burning the base position
     */
    function getBasePosition() public view override returns (uint128 liquidity, uint256 amount0, uint256 amount1) {
        return _getPositionAmounts(basePositionId);
    }

    /**
     @notice Calculates amount of total liquidity in the limit position
     @return liquidity Amount of total liquidity in the base position
     @return amount0 Estimated amount of token0 that could be collected by burning the limit position
     @return amount1 Estimated amount of token1 that could be collected by burning the limit position
     */
    function getLimitPosition() public view override returns (uint128 liquidity, uint256 amount0, uint256 amount1) {
        return _getPositionAmounts(limitPositionId);
    }

    /**
     @notice Returns current price tick
     @return tick Uniswap pool's current price tick
     */
    function currentTick() public view override returns (int24 tick) {
        (, int24 tick_, , , , bool unlocked_) = IAlgebraPool(pool).globalState();
        require(unlocked_, "IV.currentTick: the pool is locked");
        tick = tick_;
    }

    /**
     @notice returns equivalent _tokenOut for _amountIn, _tokenIn using spot price
     @param _tokenIn token the input amount is in
     @param _tokenOut token for the output amount
     @param _tick tick for the spot price
     @param _amountIn amount in _tokenIn
     @return amountOut equivalent anount in _tokenOut
     */
    function _fetchSpot(
        address _tokenIn,
        address _tokenOut,
        int24 _tick,
        uint256 _amountIn
    ) internal pure returns (uint256 amountOut) {
        return UV3Math.getQuoteAtTick(_tick, UV3Math.toUint128(_amountIn), _tokenIn, _tokenOut);
    }

    /**
     @notice returns equivalent _tokenOut for _amountIn, _tokenIn using TWAP price
     @param _pool Uniswap V3 pool address to be used for price checking
     @param _tokenIn token the input amount is in
     @param _tokenOut token for the output amount
     @param _twapPeriod the averaging time period
     @param _amountIn amount in _tokenIn
     @return amountOut equivalent anount in _tokenOut
     */
    function _fetchTwap(
        address _pool,
        address _tokenIn,
        address _tokenOut,
        uint32 _twapPeriod,
        uint256 _amountIn
    ) internal view returns (uint256 amountOut) {
        // Leave twapTick as a int256 to avoid solidity casting
        address basePlugin = IBasePluginV1Factory(IICHIVaultFactory(ichiVaultFactory).basePluginFactory()).pluginByPool(
            _pool
        );
        // make sure the base plugin is connected to the pool
        require(UV3Math.isOracleConnectedToPool(basePlugin, _pool), "IV.checkHysteresis: diconnected plugin");

        int256 twapTick = UV3Math.consult(basePlugin, _twapPeriod);
        return
            UV3Math.getQuoteAtTick(
                int24(twapTick), // can assume safe being result from consult()
                UV3Math.toUint128(_amountIn),
                _tokenIn,
                _tokenOut
            );
    }

    /**
     @notice Callback function for swap
     @dev this is where the payer transfers required token0 and token1 amounts
     @param amount0Delta required amount of token0
     @param amount1Delta required amount of token1
     @param data encoded payer's address
     */
    function algebraSwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external override {
        require(msg.sender == address(pool), "cb2");
        address payer = abi.decode(data, (address));

        if (amount0Delta > 0) {
            if (payer == address(this)) {
                IERC20(token0).safeTransfer(msg.sender, uint256(amount0Delta));
            } else {
                IERC20(token0).safeTransferFrom(payer, msg.sender, uint256(amount0Delta));
            }
        } else if (amount1Delta > 0) {
            if (payer == address(this)) {
                IERC20(token1).safeTransfer(msg.sender, uint256(amount1Delta));
            } else {
                IERC20(token1).safeTransferFrom(payer, msg.sender, uint256(amount1Delta));
            }
        }
    }

}

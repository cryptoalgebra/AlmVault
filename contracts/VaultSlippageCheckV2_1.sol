// SPDX-License-Identifier: BUSL-1.1
pragma solidity >=0.8.4;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IAlgebraPool } from "@cryptoalgebra/integral-core/contracts/interfaces/IAlgebraPool.sol";
import { IGnosisSafe } from "./interfaces/IGnosisSafe.sol";
import { IICHIVault } from "./interfaces/IICHIVault.sol";
import { IVaultSlippageCheckV2 } from "./interfaces/IVaultSlippageCheckV2.sol";
import { IICHIVaultFactory } from "./interfaces/IICHIVaultFactory.sol";
import { Enum } from "./common/Enum.sol";
import {
    IBasePluginV1Factory
} from "@cryptoalgebra/integral-base-plugin/contracts/interfaces/IBasePluginV1Factory.sol";
import { UV3Math } from "./lib/UV3Math.sol";

/// @dev a more permissive version of VaultSlippageCheckV2 which allows for observations in the current block
/// whereas VaultSlippageCheckV2 does check and disallow rebalances if there is an observation that occured previously in the current block
contract VaultSlippageCheckV2_1 is Ownable, IVaultSlippageCheckV2 {
    /**
    @notice rebalances an ICHIVault uses hysteresis to detect if rebalance is risky and reverts calls gnosis execTransactionFromModule
    @param gnosis Gnosis safe that owns the vault
    @param vault ICHIVault address
    @param expectedCurrentTick The current tick
    @param baseLower The lower tick of the base position
    @param baseUpper The upper tick of the base position
    @param limitLower The lower tick of the limit position
    @param limitUpper The upper tick of the limit position
    @param swapQuantity Quantity of tokens to swap; if quantity is positive, `swapQuantity` token0 are swapped for token1, if negative, `swapQuantity` token1 is swapped for token0
    @param range The allowed range (+/-) around the expected tick
    */
    function rebalance(
        address gnosis,
        address vault,
        int24 expectedCurrentTick,
        int24 baseLower,
        int24 baseUpper,
        int24 limitLower,
        int24 limitUpper,
        int256 swapQuantity,
        int24 range
    ) external override onlyOwner {
        require(isWithinRange(vault, expectedCurrentTick, range), "RB.swap: front runner");

        IGnosisSafe(gnosis).execTransactionFromModule(
            vault,
            0,
            abi.encodeWithSelector(
                IICHIVault.rebalance.selector,
                baseLower,
                baseUpper,
                limitLower,
                limitUpper,
                swapQuantity
            ),
            Enum.Operation.Call
        );
    }

    /**
     * @notice Checks if the pool's current tick is within the allowed range of the expected tick
     * @param vault Address of the vault.
     * @param expectedTick The expected current tick.
     * @param range The allowed range (+/-) around the expected tick.
     */
    function isWithinRange(address vault, int24 expectedTick, int24 range) private view returns (bool _isWithinRange) {
        address pool = IICHIVault(vault).pool();
        address vaultsFactory = IICHIVault(vault).ichiVaultFactory();

        (, int24 currentTick, , , , ) = IAlgebraPool(pool).globalState();

        // Check if the current tick is within the allowed range
        _isWithinRange = (currentTick >= (expectedTick - range)) && (currentTick <= (expectedTick + range));
    }
}

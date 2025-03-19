// SPDX-License-Identifier: BUSL-1.1
pragma solidity >=0.5.0;

interface IVaultSlippageCheckV2 {
    /**
     * @notice Rebalances an ICHIVault. Detects rebalance risk using hysteresis.
     *         Reverts calls to gnosis execTransactionFromModule if risky.
     * @param gnosis Address of the Gnosis Safe owning the vault.
     * @param vault Address of the ICHIVault.
     * @param expectedCurrentTick Current operational tick.
     * @param baseLower Lower tick of the base position.
     * @param baseUpper Upper tick of the base position.
     * @param limitLower Lower tick of the limit position.
     * @param limitUpper Upper tick of the limit position.
     * @param swapQuantity Token quantity for swapping. Positive values swap
     *                     `swapQuantity` of token0 for token1, negative values swap
     *                     `swapQuantity` of token1 for token0.
     * @param range Allowed tick range (+/-) around the expected tick.
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
    ) external;
}

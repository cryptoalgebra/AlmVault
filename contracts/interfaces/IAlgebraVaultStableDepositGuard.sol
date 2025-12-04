// SPDX-License-Identifier: BUSL-1.1

pragma solidity >=0.8.4;

interface IAlgebraVaultStableDepositGuard {

    /// @notice Emitted when the contract is deployed.
    /// @param _AlgebraVaultStableFactory Address of the AlgebraVaultStableFactory.
    event Deployed(address _AlgebraVaultStableFactory);

    /// @notice Emitted when a deposit is forwarded to an AlgebraVaultStable.
    /// @param sender The address initiating the deposit.
    /// @param vault The AlgebraVaultStable receiving the deposit.
    /// @param amount0 The amount of the token0 being deposited.
    /// @param amount1 The amount of the token1 being deposited.
    /// @param shares The amount of shares issued in the vault as a result of the deposit.
    /// @param to The address receiving the vault shares.
    event DepositForwarded(
        address indexed sender,
        address indexed vault,
        uint256 amount0,
        uint256 amount1,
        uint256 shares,
        address to
    );

    /// @notice Retrieves the address of the AlgebraVaultStableFactory.
    /// @return Address of the AlgebraVaultStableFactory.
    function AlgebraVaultStableFactory() external view returns (address);

    /// @notice Forwards a deposit to the specified AlgebraVaultStable after input validation.
    /// @dev Emits a DepositForwarded event upon success.
    /// @param vault The address of the AlgebraVaultStable to deposit into.
    /// @param vaultDeployer The address of the vault deployer.
    /// @param token0 The address of the token0 being deposited.
    /// @param amount0 The amount of the token0 being deposited.
    /// @param token1 The address of the token1 being deposited.
    /// @param amount1 The amount of the token1 being deposited.
    /// @param minimumProceeds The minimum amount of vault tokens to be received.
    /// @param to The address to receive the vault tokens.
    /// @return vaultTokens The number of vault tokens received.
    function forwardDepositToAlgebraVaultStable(
        address vault,
        address vaultDeployer,
        address token0,
        uint256 amount0,
        address token1,
        uint256 amount1,
        uint256 minimumProceeds,
        address to
    ) external returns (uint256 vaultTokens);


    /// @notice Forwards a request to withdraw from an AlgebraVaultStable.
    /// @param vault The address of the AlgebraVaultStable to withdraw from.
    /// @param vaultDeployer The address of the vault deployer.
    /// @param shares The amount of shares to withdraw.
    /// @param to The address to receive the withdrawn tokens.
    /// @param minAmount0 The minimum amount of token0 expected to receive.
    /// @param minAmount1 The minimum amount of token1 expected to receive.
    /// @return amount0 The amount of token0 received.
    /// @return amount1 The amount of token1 received.
    function forwardWithdrawFromAlgebraVaultStable(
        address vault,
        address vaultDeployer,
        uint256 shares,
        address to,
        uint256 minAmount0,
        uint256 minAmount1
    ) external returns (uint256 amount0, uint256 amount1);

    /// @notice Computes the unique key for a vault based on given parameters.
    /// @param vaultDeployer The address of the vault deployer.
    /// @param token0 The address of the first token in the vault.
    /// @param token1 The address of the second token in the vault.
    /// @return key The computed unique key for the vault.
    function vaultKey(
        address vaultDeployer,
        address token0,
        address token1
    ) external view returns (bytes32 key);
}
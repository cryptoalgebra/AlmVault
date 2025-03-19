// SPDX-License-Identifier: BUSL-1.1

pragma solidity >=0.8.4;

interface IICHIVaultDepositGuard {

    /// @notice Emitted when the contract is deployed.
    /// @param _ICHIVaultFactory Address of the ICHIVaultFactory.
    /// @param _WETH Address of the Wrapped ETH token.
    event Deployed(address _ICHIVaultFactory, address _WETH);

    /// @notice Emitted when a deposit is forwarded to an ICHIVault.
    /// @param sender The address initiating the deposit.
    /// @param vault The ICHIVault receiving the deposit.
    /// @param token The token being deposited.
    /// @param amount The amount of the token being deposited.
    /// @param shares The amount of shares issued in the vault as a result of the deposit.
    /// @param to The address receiving the vault shares.
    event DepositForwarded(
        address indexed sender,
        address indexed vault,
        address indexed token,
        uint256 amount,
        uint256 shares,
        address to
    );

    /// @notice Retrieves the address of the ICHIVaultFactory.
    /// @return Address of the ICHIVaultFactory.
    function ICHIVaultFactory() external view returns (address);

    /// @notice Retrieves the address of the Wrapped Native Token (e.g., WETH).
    /// @return Address of the Wrapped Native Token.
    function WRAPPED_NATIVE() external view returns (address);

    /// @notice Forwards a deposit to the specified ICHIVault after input validation.
    /// @dev Emits a DepositForwarded event upon success.
    /// @param vault The address of the ICHIVault to deposit into.
    /// @param vaultDeployer The address of the vault deployer.
    /// @param token The address of the token being deposited.
    /// @param amount The amount of the token being deposited.
    /// @param minimumProceeds The minimum amount of vault tokens to be received.
    /// @param to The address to receive the vault tokens.
    /// @return vaultTokens The number of vault tokens received.
    function forwardDepositToICHIVault(
        address vault,
        address vaultDeployer,
        address token,
        uint256 amount,
        uint256 minimumProceeds,
        address to
    ) external returns (uint256 vaultTokens);

    /// @notice Forwards a native currency (e.g., ETH) deposit to an ICHIVault.
    /// @dev Converts the native currency to Wrapped Native Token before deposit.
    /// @param vault The address of the ICHIVault to deposit into.
    /// @param vaultDeployer The address of the vault deployer.
    /// @param minimumProceeds The minimum amount of vault tokens to be received.
    /// @param to The address to receive the vault tokens.
    /// @return vaultTokens The number of vault tokens received.
    function forwardNativeDepositToICHIVault(
        address vault,
        address vaultDeployer,
        uint256 minimumProceeds,
        address to
    ) external payable returns (uint256 vaultTokens);

    /// @notice Forwards a request to withdraw from an ICHIVault.
    /// @param vault The address of the ICHIVault to withdraw from.
    /// @param vaultDeployer The address of the vault deployer.
    /// @param shares The amount of shares to withdraw.
    /// @param to The address to receive the withdrawn tokens.
    /// @param minAmount0 The minimum amount of token0 expected to receive.
    /// @param minAmount1 The minimum amount of token1 expected to receive.
    /// @return amount0 The amount of token0 received.
    /// @return amount1 The amount of token1 received.
    function forwardWithdrawFromICHIVault(
        address vault,
        address vaultDeployer,
        uint256 shares,
        address to,
        uint256 minAmount0,
        uint256 minAmount1
    ) external returns (uint256 amount0, uint256 amount1);

    /// @notice Forwards a request to withdraw native currency from an ICHIVault.
    /// @dev Converts the Wrapped Native Tokens back to native currency on withdrawal.
    /// @param vault The address of the ICHIVault to withdraw from.
    /// @param vaultDeployer The address of the vault deployer.
    /// @param shares The amount of shares to withdraw.
    /// @param to The address to receive the withdrawn native currency.
    /// @param minAmount0 The minimum amount of token0 expected to receive.
    /// @param minAmount1 The minimum amount of token1 expected to receive.
    /// @return amount0 The amount of token0 received.
    /// @return amount1 The amount of token1 received.
    function forwardNativeWithdrawFromICHIVault(
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
    /// @param allowToken0 Boolean indicating if token0 is allowed in the vault.
    /// @param allowToken1 Boolean indicating if token1 is allowed in the vault.
    /// @return key The computed unique key for the vault.
    function vaultKey(
        address vaultDeployer,
        address token0,
        address token1,
        bool allowToken0,
        bool allowToken1
    ) external view returns (bytes32 key);
}
// SPDX-License-Identifier: Unlicense

pragma solidity >=0.8.4;

import { IAlgebraVaultStableDepositGuard } from "./interfaces/IAlgebraVaultStableDepositGuard.sol";
import { IAlgebraVaultStableFactory } from "./interfaces/IAlgebraVaultStableFactory.sol";
import { IAlgebraVaultStable } from "./interfaces/IAlgebraVaultStable.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract AlgebraVaultStableDepositGuard is IAlgebraVaultStableDepositGuard, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable override AlgebraVaultStableFactory;

    address private constant NULL_ADDRESS = address(0);

    /// @notice Constructs the IAlgebraVaultStableDepositGuard contract.
    /// @param _AlgebraVaultStableFactory The address of the AlgebraVaultStableFactory.
    constructor(address _AlgebraVaultStableFactory) {
        require(_AlgebraVaultStableFactory != NULL_ADDRESS, "DG.constructor: zero address");
        AlgebraVaultStableFactory = _AlgebraVaultStableFactory;
        emit Deployed(_AlgebraVaultStableFactory);
    }

    /// @inheritdoc IAlgebraVaultStableDepositGuard
    function forwardDepositToAlgebraVaultStable(
        address vault,
        address vaultDeployer,
        address token0,
        uint256 amount0,
        address token1,
        uint256 amount1,
        uint256 minimumProceeds,
        address to
    ) external override nonReentrant returns (uint256 vaultTokens) {
        vaultTokens = _forwardDeposit(
            vault,
            vaultDeployer,
            token0,
            amount0,
            token1,
            amount1,
            minimumProceeds,
            to
        );
    }

    /// @inheritdoc IAlgebraVaultStableDepositGuard
    function forwardWithdrawFromAlgebraVaultStable(
        address vault,
        address vaultDeployer,
        uint256 shares,
        address to,
        uint256 minAmount0,
        uint256 minAmount1
    ) external override nonReentrant returns (uint256 amount0, uint256 amount1) {
        (amount0, amount1) = _forwardWithdraw(vault, vaultDeployer, shares, to, minAmount0, minAmount1);
    }

    /// @inheritdoc IAlgebraVaultStableDepositGuard
    function vaultKey(
        address vaultDeployer,
        address token0,
        address token1
    ) public view override returns (bytes32 key) {
        key = IAlgebraVaultStableFactory(AlgebraVaultStableFactory).genKey(vaultDeployer, token0, token1);
    }

    function _forwardDeposit(
        address vault,
        address vaultDeployer,
        address token0,
        uint256 amount0,
        address token1,
        uint256 amount1,
        uint256 minimumProceeds,
        address to
    ) private returns (uint256 vaultTokens) {
        _validateRecipient(to);
        (IAlgebraVaultStable algebraVaultStable, address vaultToken0, address vaultToken1) = _validateVault(vault, vaultDeployer);

        require(token0 == vaultToken0 && token1 == vaultToken1, "Invalid tokens");

        // For stable vault, both tokens are allowed
        IERC20(token0).safeIncreaseAllowance(vault, amount0);
        IERC20(token1).safeIncreaseAllowance(vault, amount1);

        vaultTokens = algebraVaultStable.deposit(amount0, amount1, to);
        require(vaultTokens >= minimumProceeds, "Slippage too great. Try again.");

        emit DepositForwarded(
            msg.sender,
            vault,
            amount0,
            amount1,
            vaultTokens,
            to
        );
    }

    function _forwardWithdraw(
        address vault,
        address vaultDeployer,
        uint256 shares,
        address to,
        uint256 minAmount0,
        uint256 minAmount1
    ) private returns (uint256 amount0, uint256 amount1) {
        _validateRecipient(to);
        (IAlgebraVaultStable algebraVaultStable, address token0, address token1) = _validateVault(vault, vaultDeployer);

        // - sender must grant the guard an allowance for the vault share token
        // - the guard can then transfer those share tokens to itself
        // - the guard then approves the vault an allowance in order to burn shares and withdraw from the vault
        IERC20(vault).safeTransferFrom(msg.sender, address(this), shares);

        (amount0, amount1) = algebraVaultStable.withdraw(shares, to);

        require(amount0 >= minAmount0 && amount1 >= minAmount1, "Insufficient out");
    }

    function _validateRecipient(address to) private pure {
        require(to != NULL_ADDRESS, "Invalid to");
    }

    function _validateVault(
        address vault,
        address vaultDeployer
    ) private view returns (IAlgebraVaultStable algebraVaultStable, address token0, address token1) {
        algebraVaultStable = IAlgebraVaultStable(vault);

        token0 = algebraVaultStable.token0();
        token1 = algebraVaultStable.token1();

        bytes32 factoryVaultKey = vaultKey(
            vaultDeployer,
            token0,
            token1
        );

        require(IAlgebraVaultStableFactory(AlgebraVaultStableFactory).getAlgebraVaultStable(factoryVaultKey) == vault, "Invalid vault");
    }
}
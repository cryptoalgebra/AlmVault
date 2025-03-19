// SPDX-License-Identifier: Unlicense

pragma solidity >=0.8.4;

import { IICHIVaultDepositGuard } from "./interfaces/IICHIVaultDepositGuard.sol";
import { IICHIVaultFactory } from "./interfaces/IICHIVaultFactory.sol";
import { IICHIVault } from "./interfaces/IICHIVault.sol";
import { IWRAPPED_NATIVE } from "./interfaces/IWRAPPED_NATIVE.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract ICHIVaultDepositGuard is IICHIVaultDepositGuard, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable override ICHIVaultFactory;
    address public immutable override WRAPPED_NATIVE;

    address private constant NULL_ADDRESS = address(0);

    /// @notice Constructs the IICHIVaultDepositGuard contract.
    /// @param _ICHIVaultFactory The address of the ICHIVaultFactory.
    constructor(address _ICHIVaultFactory, address _WRAPPED_NATIVE) {
        require(_ICHIVaultFactory != NULL_ADDRESS, "DG.constructor: zero address");
        ICHIVaultFactory = _ICHIVaultFactory;
        WRAPPED_NATIVE = _WRAPPED_NATIVE;
        emit Deployed(_ICHIVaultFactory, _WRAPPED_NATIVE);
    }

    receive() external payable {
        assert(msg.sender == WRAPPED_NATIVE); // only accept ETH via fallback from the WRAPPED_NATIVE contract
    }

    /// @inheritdoc IICHIVaultDepositGuard
    function forwardDepositToICHIVault(
        address vault,
        address vaultDeployer,
        address token,
        uint256 amount,
        uint256 minimumProceeds,
        address to
    ) external override nonReentrant returns (uint256 vaultTokens) {
        vaultTokens = _forwardDeposit(vault, vaultDeployer, token, amount, minimumProceeds, to, false);
    }

    /// @inheritdoc IICHIVaultDepositGuard
    function forwardNativeDepositToICHIVault(
        address vault,
        address vaultDeployer,
        uint256 minimumProceeds,
        address to
    ) external payable override nonReentrant returns (uint256 vaultTokens) {
        uint256 nativeAmount = msg.value;
        IWRAPPED_NATIVE(WRAPPED_NATIVE).deposit{ value: nativeAmount }();

        vaultTokens = _forwardDeposit(vault, vaultDeployer, WRAPPED_NATIVE, nativeAmount, minimumProceeds, to, true);
    }

    /// @inheritdoc IICHIVaultDepositGuard
    function forwardWithdrawFromICHIVault(
        address vault,
        address vaultDeployer,
        uint256 shares,
        address to,
        uint256 minAmount0,
        uint256 minAmount1
    ) external override nonReentrant returns (uint256 amount0, uint256 amount1) {
        (amount0, amount1) = _forwardWithdraw(vault, vaultDeployer, shares, to, minAmount0, minAmount1, false);
    }

    /// @inheritdoc IICHIVaultDepositGuard
    function forwardNativeWithdrawFromICHIVault(
        address vault,
        address vaultDeployer,
        uint256 shares,
        address to,
        uint256 minAmount0,
        uint256 minAmount1
    ) external override nonReentrant returns (uint256 amount0, uint256 amount1) {
        (amount0, amount1) = _forwardWithdraw(vault, vaultDeployer, shares, to, minAmount0, minAmount1, true);
    }

    /// @inheritdoc IICHIVaultDepositGuard
    function vaultKey(
        address vaultDeployer,
        address token0,
        address token1,
        bool allowToken0,
        bool allowToken1
    ) public view override returns (bytes32 key) {
        key = IICHIVaultFactory(ICHIVaultFactory).genKey(vaultDeployer, token0, token1, allowToken0, allowToken1);
    }

    function _forwardDeposit(
        address vault,
        address vaultDeployer,
        address token,
        uint256 amount,
        uint256 minimumProceeds,
        address to,
        bool depositNative
    ) private returns (uint256 vaultTokens) {
        _validateRecipient(to);
        (IICHIVault ichiVault, address token0, address token1) = _validateVault(vault, vaultDeployer, depositNative);

        require(token == token0 || token == token1, "Invalid token");

        if (token == token0) {
            require(ichiVault.allowToken0(), "Token0 deposits not allowed");
        } else {
            require(ichiVault.allowToken1(), "Token1 deposits not allowed");
        }

        // if deposit is a native deposit then we don't need to transfer WRAPPED_NATIVE
        // since this contract receives WRAPPED_NATIVE amount on successful WRAPPED_NATIVE#deposit
        if (!depositNative) {
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }

        IERC20(token).safeIncreaseAllowance(vault, amount);

        uint256 token0Amount = token == token0 ? amount : 0;
        uint256 token1Amount = token == token1 ? amount : 0;

        vaultTokens = ichiVault.deposit(token0Amount, token1Amount, to);
        require(vaultTokens >= minimumProceeds, "Slippage too great. Try again.");

        emit DepositForwarded(msg.sender, vault, token, amount, vaultTokens, to);
    }

    function _forwardWithdraw(
        address vault,
        address vaultDeployer,
        uint256 shares,
        address to,
        uint256 minAmount0,
        uint256 minAmount1,
        bool withdrawNative
    ) private returns (uint256 amount0, uint256 amount1) {
        _validateRecipient(to);
        (IICHIVault ichiVault, address token0, address token1) = _validateVault(vault, vaultDeployer, withdrawNative);

        // - sender must grant the guard an allowance for the vault share token
        // - the guard can then transfer those share tokens to itself
        // - the guard then approves the vault an allowance in order to burn shares and withdraw from the vault
        IERC20(vault).safeTransferFrom(msg.sender, address(this), shares);

        if (withdrawNative) {
            // the vault temporarily custodies the withdrawn amounts
            (amount0, amount1) = ichiVault.withdraw(shares, address(this));
            if (token0 == WRAPPED_NATIVE) {
                IWRAPPED_NATIVE(WRAPPED_NATIVE).withdraw(amount0);
                payable(to).transfer(amount0);
                IERC20(token1).safeTransfer(to, amount1);
            } else {
                IWRAPPED_NATIVE(WRAPPED_NATIVE).withdraw(amount1);
                payable(to).transfer(amount1);
                IERC20(token0).safeTransfer(to, amount0);
            }
        } else {
            (amount0, amount1) = ichiVault.withdraw(shares, to);
        }

        require(amount0 >= minAmount0 && amount1 >= minAmount1, "Insufficient out");
    }

    function _validateRecipient(address to) private pure {
        require(to != NULL_ADDRESS, "Invalid to");
    }

    function _validateVault(
        address vault,
        address vaultDeployer,
        bool validateNative
    ) private view returns (IICHIVault ichiVault, address token0, address token1) {
        ichiVault = IICHIVault(vault);

        token0 = ichiVault.token0();
        token1 = ichiVault.token1();

        if (validateNative) {
            require(token0 == WRAPPED_NATIVE || token1 == WRAPPED_NATIVE, "Native vault");
        }

        bytes32 factoryVaultKey = vaultKey(
            vaultDeployer,
            token0,
            token1,
            ichiVault.allowToken0(),
            ichiVault.allowToken1()
        );

        require(IICHIVaultFactory(ICHIVaultFactory).getICHIVault(factoryVaultKey) == vault, "Invalid vault");
    }
}
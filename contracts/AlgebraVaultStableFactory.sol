// SPDX-License-Identifier: BUSL-1.1
pragma solidity >=0.8.4;

import { IAlgebraVaultStableFactory } from "./interfaces/IAlgebraVaultStableFactory.sol";
import { IAlgebraFactory } from "@cryptoalgebra/integral-core/contracts/interfaces/IAlgebraFactory.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import { AlgebraVaultStableDeployer } from "./lib/AlgebraVaultStableDeployer.sol";
import { IAlgebraPool } from "@cryptoalgebra/integral-core/contracts/interfaces/IAlgebraPool.sol";

contract AlgebraVaultStableFactory is IAlgebraVaultStableFactory, ReentrancyGuard, AccessControl {
    bytes32 public constant override MANAGER_ROLE = keccak256("MANAGER_ROLE");
    bytes32 public constant override REBALANCER_ROLE = keccak256("REBALANCER_ROLE");

    address constant NULL_ADDRESS = address(0);
    uint256 constant DEFAULT_AMM_FEE = 0; // 0%
    uint256 constant DEFAULT_BASE_FEE = 2 * 10 ** 17; // 20%
    uint256 constant DEFAULT_BASE_FEE_SPLIT = 5 * 10 ** 17; // 50%
    uint256 constant PRECISION = 10 ** 18;
    uint32 constant DEFAULT_TWAP_PERIOD = 60 minutes;
    address public immutable override algebraFactory;
    address public immutable override pluginDeployer;
    address public immutable override nftManager;
    string public override ammName;

    address public override feeRecipient;
    uint256 public override ammFee;
    uint256 public override baseFee;
    uint256 public override baseFeeSplit;

    mapping(bytes32 => address) public getAlgebraVault;
    address[] public allVaults;

    /**
     @notice creates an instance of AlgebraVaultFactory
     @param _algebraFactory Algebra Integral factory
     @param _pluginDeployer Address of the plugin factory used for pool's plugin deployment.
     @param _nftManager Address of the Algebra NFT position manager.
     @param _ammName Name which should be reflected in the ERC20 name.
     */
    constructor(address _algebraFactory,
                address _pluginDeployer,
                address _nftManager,
                string memory _ammName) {
        require(_algebraFactory != NULL_ADDRESS &&
                _nftManager != NULL_ADDRESS, "AVF.constructor: zero address");
        algebraFactory = _algebraFactory;
        pluginDeployer = _pluginDeployer;
        nftManager = _nftManager;
        ammName = _ammName;
        feeRecipient = msg.sender;
        ammFee = DEFAULT_AMM_FEE;
        baseFee = DEFAULT_BASE_FEE;
        baseFeeSplit = DEFAULT_BASE_FEE_SPLIT;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MANAGER_ROLE, msg.sender);
        _grantRole(REBALANCER_ROLE, msg.sender);

        emit DeployAlgebraVaultFactory(msg.sender, _algebraFactory);
    }

    /**
     @notice Creates an AlgebraVault for specified tokenA/tokenB for stablecoins.
     Both tokens are allowed for deposits.
     @param tokenA TokenA of the Algebra V1 pool.
     @param tokenB TokenB of the Algebra V1 pool.
     @return algebraVault Address of the newly created AlgebraVault.
     */
    function createAlgebraVault(
        address tokenA,
        address tokenB
    ) external override onlyRole(MANAGER_ROLE) nonReentrant returns (address algebraVault) {
        require(tokenA != tokenB, "AVF.createAlgebraVault: identical tokens");

        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);

        require(token0 != NULL_ADDRESS, "AVF.createAlgebraVault: zero address");

        require(
            getAlgebraVault[genKey(msg.sender, token0, token1)] == NULL_ADDRESS,
            "AVF.createAlgebraVault: vault exists"
        );

        address pool;
        if (pluginDeployer != address(0)) {
            pool = IAlgebraFactory(algebraFactory).customPoolByPair(pluginDeployer, tokenA, tokenB);
        } else {
            pool = IAlgebraFactory(algebraFactory).poolByPair(tokenA, tokenB);
        }

        require(pool != NULL_ADDRESS, "AVF.createAlgebraVault: pool must exist");

        (, , , , , bool unlocked) = IAlgebraPool(pool).globalState();

        require(unlocked, "AVF.createAlgebraVault: pool is locked");

        algebraVault = AlgebraVaultStableDeployer.createAlgebraVault(
            pool,
            DEFAULT_TWAP_PERIOD,
            allVaults.length
        );

        // populate mapping in the reverse direction
        getAlgebraVault[genKey(msg.sender, token0, token1)] = algebraVault;
        getAlgebraVault[genKey(msg.sender, token1, token0)] = algebraVault;
        allVaults.push(algebraVault);

        emit AlgebraVaultStableCreated(msg.sender, algebraVault, token0, token1, allVaults.length);
    }

    /**
     @notice Sets the fee recipient account address, where portion of the collected swap fees will be distributed
     @param _feeRecipient The fee recipient account address
     */
    function setFeeRecipient(address _feeRecipient) external override onlyRole(MANAGER_ROLE) {
        require(_feeRecipient != NULL_ADDRESS, "AVF.setFeeRecipient: zero address");
        feeRecipient = _feeRecipient;
        emit FeeRecipient(msg.sender, _feeRecipient);
    }

    /**
     @notice Sets the fee percentage taken from pool's swap fees, allocated to the AMM for external incentives.
     @param _ammFee Fee percentage taken from the pool's accumulated swap fees.
     */
    function setAmmFee(uint256 _ammFee) external override onlyRole(MANAGER_ROLE) {
        require(baseFee + _ammFee <= PRECISION, "AVF.setAmmFee: fees must be <= 10**18");
        ammFee = _ammFee;
        emit AmmFee(msg.sender, _ammFee);
    }

    /**
     @notice Sets the fee percentage taken from pool's swap fees, distributed between feeRecipient and affiliates.
     @param _baseFee Fee percentage taken from the pool's accumulated swap fees.
     */
    function setBaseFee(uint256 _baseFee) external override onlyRole(MANAGER_ROLE) {
        require(ammFee + _baseFee <= PRECISION, "AVF.setBaseFee: fees must be <= 10**18");
        baseFee = _baseFee;
        emit BaseFee(msg.sender, _baseFee);
    }

    /**
     @notice Sets the fee split ratio between feeRecipient and affiliate accounts. Ratio format:
     (baseFeeSplit)/(100 - baseFeeSplit). E.g., for a 20/80 split, set baseFeeSplit to 20.
     @param _baseFeeSplit Fee split ratio between feeRecipient and affiliate accounts.
     */
    function setBaseFeeSplit(uint256 _baseFeeSplit) external override onlyRole(MANAGER_ROLE) {
        require(_baseFeeSplit <= PRECISION, "AVF.setBaseFeeSplit: must be <= 10**18");
        baseFeeSplit = _baseFeeSplit;
        emit BaseFeeSplit(msg.sender, _baseFeeSplit);
    }

    /**
     * @notice generate a key for getAlgebraVault
     * @param deployer vault creator
     * @param token0 the first of two tokens in the vault
     * @param token1 the second of two tokens in the vault
     * @return key generated key
     */
    function genKey(
        address deployer,
        address token0,
        address token1
    ) public pure override returns (bytes32 key) {
        key = keccak256(abi.encodePacked(deployer, token0, token1));
    }
}
// SPDX-License-Identifier: BUSL-1.1
pragma solidity >=0.8.4;

import {IAlmVaultFactory} from './interfaces/IAlmVaultFactory.sol';
import {IAlgebraFactory} from '@cryptoalgebra/integral-core/contracts/interfaces/IAlgebraFactory.sol';
import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {AlmVaultDeployer} from './libraries/AlmVaultDeployer.sol';
import {IAlgebraPool} from "@cryptoalgebra/integral-core/contracts/interfaces/IAlgebraPool.sol";
import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "hardhat/console.sol";

contract AlmVaultFactory is IAlmVaultFactory, ReentrancyGuard, Ownable {
    
    using SafeMath for uint256;

    address constant NULL_ADDRESS = address(0);
    uint256 constant DEFAULT_AMM_FEE = 0; // 0%
    uint256 constant DEFAULT_BASE_FEE = 2 * 10**17; // 20%
    uint256 constant DEFAULT_BASE_FEE_SPLIT = 5 * 10**17; // 50%
    uint256 constant PRECISION = 10**18;
    uint32 constant DEFAULT_TWAP_PERIOD = 60 minutes;
    address public override immutable algebraFactory;
    address public pluginFactory;
    address public override feeRecipient;
    uint256 public override ammFee;
    uint256 public override baseFee;
    uint256 public override baseFeeSplit;

    mapping(bytes32 => address) public getAlmVault; 
    address[] public allVaults;

    /**
     @notice creates an instance of AlmVaultFactory
     @param _algebraFactory Algebra V1 factory
     */
    constructor(address _algebraFactory, address _pluginFactory) {
        require(_algebraFactory != NULL_ADDRESS, 'IVF.constructor: zero address');
        algebraFactory = _algebraFactory;
        pluginFactory = _pluginFactory;
        feeRecipient = msg.sender;
        ammFee = DEFAULT_AMM_FEE; 
        baseFee = DEFAULT_BASE_FEE; 
        baseFeeSplit = DEFAULT_BASE_FEE_SPLIT; 
        emit DeployAlmVaultFactory(msg.sender, _algebraFactory);
    }

    /**
     @notice creates an instance of AlmVault for specified tokenA/tokenB/fee setting. If needed creates underlying Uniswap V3 pool. AllowToken parameters control whether the AlmVault allows one-sided or two-sided liquidity provision
     @param tokenA tokenA of the Algebra V1 pool
     @param allowTokenA flag that indicates whether tokenA is accepted during deposit
     @param tokenB tokenB of the Algebra V1 pool
     @param allowTokenB flag that indicates whether tokenB is accepted during deposit
     @return almVault address of the created AlmVault
     */
    function createAlmVault(
        address tokenA,
        bool allowTokenA,
        address tokenB,
        bool allowTokenB
    ) external override nonReentrant returns (address almVault) {
        require(tokenA != tokenB, 'IVF.createAlmVault: identical tokens');

        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        (bool allowToken0, bool allowToken1) = tokenA < tokenB ? (allowTokenA, allowTokenB) : (allowTokenB, allowTokenA);

        require(token0 != NULL_ADDRESS, 'IVF.createAlmVault: zero address');
        require(allowTokenA || allowTokenB, 'IVF.createAlmVault: no allowed tokens');

        require(getAlmVault[genKey(msg.sender, token0, token1, allowToken0, allowToken1)] == NULL_ADDRESS, 'IVF.createAlmVault: vault exists');

        address pool = IAlgebraFactory(algebraFactory).poolByPair(tokenA, tokenB);
        
        require(pool != NULL_ADDRESS, 'IVF.createAlmVault: pool must exist');

        (/*uint160 price*/,
         /*int24 tick*/,
         /*uint16 lastFee*/,
         /*uint8 pluginConfig*/,
         /*uint16 communityFee*/,
         bool unlocked
        ) = IAlgebraPool(pool).globalState();

        require(unlocked, 'IVF.createAlmVault: pool is locked');

        almVault = AlmVaultDeployer.createAlmVault(
                pluginFactory,
                pool, 
                token0,
                allowToken0, 
                token1,
                allowToken1, 
                DEFAULT_TWAP_PERIOD,
                allVaults.length
        );

        getAlmVault[genKey(msg.sender, token0, token1, allowToken0, allowToken1)] = almVault;
        getAlmVault[genKey(msg.sender, token1, token0, allowToken1, allowToken0)] = almVault; // populate mapping in the reverse direction
        allVaults.push(almVault);

        emit AlmVaultCreated(msg.sender, almVault, token0, allowToken0, token1, allowToken1, allVaults.length);
    }

    /**
     @notice Sets the fee recipient account address, where portion of the collected swap fees will be distributed
     @dev onlyOwner
     @param _feeRecipient The fee recipient account address
     */
    function setFeeRecipient(address _feeRecipient) external override onlyOwner {
        require(_feeRecipient != NULL_ADDRESS, 'IVF.setFeeRecipient: zero address');
        feeRecipient = _feeRecipient;
        emit FeeRecipient(msg.sender, _feeRecipient);
    }

    /**
     @notice Sets the fee percentage to be taked from the accumulated pool's swap fees. This percentage is then sent to the AMM, to be used for external incentive programs
     @dev onlyOwner
     @param _ammFee The fee percentage to be taked from the accumulated pool's swap fee
     */
    function setAmmFee(uint256 _ammFee) external override onlyOwner {
        require(baseFee.add(_ammFee) <= PRECISION, 'IVF.setAmmFee: fees must be <= 10**18');
        ammFee = _ammFee;
        emit AmmFee(msg.sender, _ammFee);
    }

    /**
     @notice Sets the fee percentage to be taked from the accumulated pool's swap fees. This percentage is then distributed between the feeRecipient and affiliate accounts
     @dev onlyOwner
     @param _baseFee The fee percentage to be taked from the accumulated pool's swap fee
     */
    function setBaseFee(uint256 _baseFee) external override onlyOwner {
        require(ammFee.add(_baseFee) <= PRECISION, 'IVF.setBaseFee: fees must be <= 10**18');
        baseFee = _baseFee;
        emit BaseFee(msg.sender, _baseFee);
    }

    /**
     @notice Sets the fee split ratio between feeRecipient and affilicate accounts. The ratio is set as (baseFeeSplit)/(100 - baseFeeSplit), that is if we want 20/80 ratio (with feeRecipient getting 20%), baseFeeSplit should be set to 20
     @dev onlyOwner
     @param _baseFeeSplit The fee split ratio between feeRecipient and affilicate accounts
     */
    function setBaseFeeSplit(uint256 _baseFeeSplit) external override onlyOwner {
        require(_baseFeeSplit <= PRECISION, 'IVF.setBaseFeeSplit: must be <= 10**18');
        baseFeeSplit = _baseFeeSplit;
        emit BaseFeeSplit(msg.sender, _baseFeeSplit);
    }

    /**
     * @notice generate a key for getAlmVault
     * @param deployer vault creator
     * @param token0 the first of two tokens in the vault
     * @param token1 the second of two tokens in the vault
     * @param allowToken0 allow deposits
     * @param allowToken1 allow deposits
     * @return key generated key
     */
    function genKey(address deployer, address token0, address token1, bool allowToken0, bool allowToken1) public pure override returns(bytes32 key) {
        key = keccak256(abi.encodePacked(deployer, token0, token1, allowToken0, allowToken1));
    }
}

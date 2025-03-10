// SPDX-License-Identifier: BUSL-1.1

pragma solidity >=0.5.0;

interface IAlmVaultFactory {

    event FeeRecipient(
        address indexed sender, 
        address feeRecipient);

    event AmmFee(
        address indexed sender, 
        uint256 ammFee);

    event BaseFee(
        address indexed sender, 
        uint256 baseFee);

    event BaseFeeSplit(
        address indexed sender, 
        uint256 baseFeeSplit);
    
    event DeployAlmVaultFactory(
        address indexed sender, 
        address algebraFactory);

    event AlmVaultCreated(
        address indexed sender, 
        address almVault, 
        address tokenA,
        bool allowTokenA,
        address tokenB,
        bool allowTokenB,
        uint256 count);    

    function algebraFactory() external view returns(address);
    function feeRecipient() external view returns(address);
    function ammFee() external view returns(uint256);
    function baseFee() external view returns(uint256);
    function baseFeeSplit() external view returns(uint256);
    
    function setFeeRecipient(address _feeRecipient) external;
    function setAmmFee(uint256 _ammFee) external;
    function setBaseFee(uint256 _baseFee) external;
    function setBaseFeeSplit(uint256 _baseFeeSplit) external;

    function createAlmVault(
        address tokenA,
        bool allowTokenA,
        address tokenB,
        bool allowTokenB
    ) external returns (address almVault);

    function genKey(
        address deployer, 
        address token0, 
        address token1, 
        bool allowToken0, 
        bool allowToken1) external pure returns(bytes32 key);
}

// SPDX-License-Identifier: BUSL-1.1

pragma solidity >=0.8.4;

interface IAlgebraVaultStableFactory {
    event FeeRecipient(address indexed sender, address feeRecipient);

    event AmmFee(address indexed sender, uint256 ammFee);

    event BaseFee(address indexed sender, uint256 baseFee);

    event BaseFeeSplit(address indexed sender, uint256 baseFeeSplit);

    event DeployAlgebraVaultStableFactory(address indexed sender, address algebraFactory);

    event AlgebraVaultStableCreated(
        address indexed sender,
        address algebraVaultStable,
        address tokenA,
        address tokenB,
        uint256 count
    );

    function MANAGER_ROLE() external view returns (bytes32);

    function REBALANCER_ROLE() external view returns (bytes32);

    function getAlgebraVaultStable(bytes32 vaultKey) external view returns(address);

    function algebraFactory() external view returns (address);

    function pluginDeployer() external view returns (address);

    function nftManager() external view returns (address);

    function ammName() external view returns (string memory);

    function feeRecipient() external view returns (address);

    function ammFee() external view returns (uint256);

    function baseFee() external view returns (uint256);

    function baseFeeSplit() external view returns (uint256);

    function setFeeRecipient(address _feeRecipient) external;

    function setAmmFee(uint256 _ammFee) external;

    function setBaseFee(uint256 _baseFee) external;

    function setBaseFeeSplit(uint256 _baseFeeSplit) external;

    function createAlgebraVaultStable(
        address tokenA,
        address tokenB
    ) external returns (address algebraVaultStable);

    function genKey(
        address deployer,
        address token0,
        address token1
    ) external pure returns (bytes32 key);
}
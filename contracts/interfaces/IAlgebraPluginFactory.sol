pragma solidity >=0.5.0;
pragma abicoder v2;

// TODO: заменить на нормальный интерфейс (из npm)
interface IAlgebraPluginFactory {
    /// @notice Returns address of plugin created for given AlgebraPool
    /// @param pool The address of AlgebraPool
    /// @return The address of corresponding plugin
    function pluginByPool(address pool) external view returns (address);
}

pragma solidity =0.8.20;

import { IAlgebraPoolDeployer } from "@cryptoalgebra/integral-core/contracts/interfaces/IAlgebraPoolDeployer.sol";
import { IAlgebraPool } from "@cryptoalgebra/integral-core/contracts/interfaces/IAlgebraPool.sol";
import { ISwapRouter } from "@cryptoalgebra/integral-periphery/contracts/interfaces/ISwapRouter.sol";
import {
    INonfungiblePositionManager
} from "@cryptoalgebra/integral-periphery/contracts/interfaces/INonfungiblePositionManager.sol";

import {
    IBasePluginV1Factory
} from "@cryptoalgebra/integral-base-plugin/contracts/interfaces/IBasePluginV1Factory.sol";

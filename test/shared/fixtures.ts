import {
  abi as ALGEBRA_FACTORY_ABI,
  bytecode as ALGEBRA_FACTORY_BYTECODE,
} from "@cryptoalgebra/integral-core/artifacts/contracts/AlgebraFactory.sol/AlgebraFactory.json";
import {
  abi as ALGEBRA_POOL_DEPLOYER_ABI,
  bytecode as ALGEBRA_POOL_DEPLOYER_BYTECODE,
} from "@cryptoalgebra/integral-core/artifacts/contracts/AlgebraPoolDeployer.sol/AlgebraPoolDeployer.json";
import {
  abi as NON_FUNGIBLE_POSITION_MANAGER_ABI,
  bytecode as NON_FUNGIBLE_POSITION_MANAGER_BYTECODE,
} from "@cryptoalgebra/integral-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json";
import {
  abi as SWAP_ROUTER_ABI,
  bytecode as SWAP_ROUTER_BYTECODE,
} from "@cryptoalgebra/integral-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json";
import {
  abi as BASE_PLUGIN_FACTORY_ABI,
  bytecode as BASE_PLUGIN_FACTORY_BYTECODE,
} from "@cryptoalgebra/integral-base-plugin/artifacts/contracts/BasePluginV1Factory.sol/BasePluginV1Factory.json";
import { BigNumber } from "@ethersproject/bignumber";
import { getCreateAddress } from "ethers-v6";
import { ethers } from "hardhat";

import {
  IAlgebraFactory,
  IAlgebraPoolDeployer,
  IBasePluginV1Factory,
  INonfungiblePositionManager,
  ISwapRouter
} from "../../types";
import { AlgebraVaultFactory } from "../../types/contracts/AlgebraVaultFactory";
import { UV3Math } from "../../types/contracts/lib/UV3Math";
import { TestERC20 } from "../../types/contracts/mocks/TestERC20";
import { TestOracle } from "../../types/contracts/mocks/TestOracle";

const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";

type Fixture<T> = () => Promise<T>;

interface AlgebraFixture {
  factory: IAlgebraFactory;
  router: ISwapRouter;
  nft: INonfungiblePositionManager;
  pluginFactory: IBasePluginV1Factory;
  oracle: TestOracle;
}


async function algebraFixture(): Promise<AlgebraFixture> {
  const [deployer] = await ethers.getSigners();

  // precompute
  const poolDeployerAddress = getCreateAddress({
    from: deployer.address,
    nonce: (await ethers.provider.getTransactionCount(deployer.address)) + 1,
  });

  // const factoryFactory = await ethers.getContractFactory('AlgebraFactory');
  const factoryFactory = new ethers.ContractFactory(ALGEBRA_FACTORY_ABI, ALGEBRA_FACTORY_BYTECODE, deployer);

  const factory_c = await factoryFactory.deploy(poolDeployerAddress);

  const factory = factory_c as IAlgebraFactory;

  const poolDeployerFactory = new ethers.ContractFactory(
    ALGEBRA_POOL_DEPLOYER_ABI,
    ALGEBRA_POOL_DEPLOYER_BYTECODE,
    deployer,
  );

  const poolDeployer = (await poolDeployerFactory.deploy(factory.address)) as IAlgebraPoolDeployer;

  // const pluginFactoryFactory = await ethers.getContractFactory("BasePluginV1Factory");
  // const pluginFactory = (await pluginFactoryFactory.deploy(factory.address)) as IBasePluginV1Factory;

  const pluginFactoryFactory = new ethers.ContractFactory(BASE_PLUGIN_FACTORY_ABI, BASE_PLUGIN_FACTORY_BYTECODE, deployer);
  const pluginFactory = (await pluginFactoryFactory.deploy(factory.address)) as IBasePluginV1Factory;

  await factory.setDefaultPluginFactory(pluginFactory.address);

  const tokenFactory = await ethers.getContractFactory("TestERC20");
  const WETH = (await tokenFactory.deploy(BigNumber.from(2).pow(255))) as TestERC20; // TODO: change to real WETH

  const routerFactory = new ethers.ContractFactory(SWAP_ROUTER_ABI, SWAP_ROUTER_BYTECODE, deployer);
  const router = (await routerFactory.deploy(factory.address, WETH.address, poolDeployer.address)) as ISwapRouter;

  const nftFactory = new ethers.ContractFactory(
    NON_FUNGIBLE_POSITION_MANAGER_ABI,
    NON_FUNGIBLE_POSITION_MANAGER_BYTECODE,
    deployer,
  );
  const nft = (await nftFactory.deploy(
    factory.address,
    WETH.address,
    ethers.constants.AddressZero,
    poolDeployer.address,
  )) as INonfungiblePositionManager;

  const uV3MathFactory = await ethers.getContractFactory("UV3Math");
  const uV3Math = (await uV3MathFactory.deploy()) as UV3Math;
  const oracleFactory = await ethers.getContractFactory("TestOracle", {
    libraries: {
      UV3Math: uV3Math.address,
    },
  });
  const oracle = (await oracleFactory.deploy()) as TestOracle;

  return { factory, router, nft, pluginFactory, oracle };
}

interface TokensFixture {
  token0: TestERC20;
  token1: TestERC20;
  token2: TestERC20;
}

async function tokensFixture(): Promise<TokensFixture> {
  const tokenFactory = await ethers.getContractFactory("TestERC20");
  const tokenA = (await tokenFactory.deploy(BigNumber.from(2).pow(255))) as TestERC20;
  const tokenB = (await tokenFactory.deploy(BigNumber.from(2).pow(255))) as TestERC20;
  const tokenC = (await tokenFactory.deploy(BigNumber.from(2).pow(255))) as TestERC20;

  const [token0, token1, token2] = [tokenA, tokenB, tokenC].sort((tokenA, tokenB) =>
    tokenA.address.toLowerCase() < tokenB.address.toLowerCase() ? -1 : 1,
  );

  return { token0, token1, token2 };
}

interface AlgebraVaultFactoryFixture {
  algebraVaultFactory: AlgebraVaultFactory;
}

async function algebraVaultFactoryFixture(
  factory: IAlgebraFactory,
  nft: INonfungiblePositionManager,
): Promise<AlgebraVaultFactoryFixture> {
  const uV3MathFactory = await ethers.getContractFactory("UV3Math");
  const uV3Math = (await uV3MathFactory.deploy()) as UV3Math;

  const algebraVaultDeployer = await ethers.getContractFactory("AlgebraVaultDeployer", {
    libraries: {
      UV3Math: uV3Math.address,
    },
  });
  const libAlgebraVaultDeployer = await algebraVaultDeployer.deploy();

  const algebraVaultFactoryFactory = await ethers.getContractFactory("AlgebraVaultFactory", {
    libraries: {
      AlgebraVaultDeployer: libAlgebraVaultDeployer.address,
    },
  });

  const algebraVaultFactory = (await algebraVaultFactoryFactory.deploy(
    factory.address,
    nft.address,
    "VEL"
  )) as AlgebraVaultFactory;

  return { algebraVaultFactory };
}

type AlgebraVaultTestFixture = AlgebraFixture & TokensFixture & AlgebraVaultFactoryFixture;

export const algebraVaultTestFixture: Fixture<AlgebraVaultTestFixture> = async function (): Promise<AlgebraVaultTestFixture> {
  const { factory, router, nft, pluginFactory, oracle } = await algebraFixture();
  const { token0, token1, token2 } = await tokensFixture();
  const { algebraVaultFactory } = await algebraVaultFactoryFixture(factory, nft);

  return {
    token0,
    token1,
    token2,
    factory,
    router,
    nft,
    pluginFactory,
    oracle,
    algebraVaultFactory,
  };
};

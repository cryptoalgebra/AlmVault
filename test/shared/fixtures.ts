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
import { BigNumber } from "@ethersproject/bignumber";
import { getCreateAddress } from "ethers-v6";
import { ethers } from "hardhat";

import {
  IAlgebraFactory,
  IAlgebraPoolDeployer,
  IBasePluginV1Factory,
  INonfungiblePositionManager,
  ISwapRouter,
  MockFactory,
  MockPool,
  MockTimeAlgebraBasePluginV1,
  MockTimeDSFactory,
} from "../../types";
import { ICHIVaultFactory } from "../../types/contracts/ICHIVaultFactory";
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

interface MockFactoryFixture {
  mockFactory: MockFactory;
}

async function mockFactoryFixture(): Promise<MockFactoryFixture> {
  const mockFactoryFactory = await ethers.getContractFactory("MockFactory");
  const mockFactory = (await mockFactoryFactory.deploy()) as MockFactory;

  return { mockFactory };
}

interface PluginFixture extends MockFactoryFixture {
  plugin: MockTimeAlgebraBasePluginV1;
  mockPluginFactory: MockTimeDSFactory;
  mockPool: MockPool;
}

// Monday, October 5, 2020 9:00:00 AM GMT-05:00
export const TEST_POOL_START_TIME = 1601906400;
export const TEST_POOL_DAY_BEFORE_START = 1601906400 - 24 * 60 * 60;

export const pluginFixture: Fixture<PluginFixture> = async function (): Promise<PluginFixture> {
  const { mockFactory } = await mockFactoryFixture();
  //const { token0, token1, token2 } = await tokensFixture()

  const mockPluginFactoryFactory = await ethers.getContractFactory("MockTimeDSFactory");
  const mockPluginFactory = (await mockPluginFactoryFactory.deploy(mockFactory.address)) as MockTimeDSFactory;

  const mockPoolFactory = await ethers.getContractFactory("MockPool");
  const mockPool = (await mockPoolFactory.deploy()) as MockPool;

  await mockPluginFactory.createPlugin(mockPool.address);
  const pluginAddress = await mockPluginFactory.pluginByPool(mockPool.address);

  const mockDSOperatorFactory = await ethers.getContractFactory("MockTimeAlgebraBasePluginV1");
  const plugin = mockDSOperatorFactory.attach(pluginAddress) as MockTimeAlgebraBasePluginV1;

  return {
    plugin,
    mockPluginFactory,
    mockPool,
    mockFactory,
  };
};

interface PluginFactoryFixture extends MockFactoryFixture {
  pluginFactory: IBasePluginV1Factory;
}

export const pluginFactoryFixture: Fixture<PluginFactoryFixture> = async function (): Promise<PluginFactoryFixture> {
  const { mockFactory } = await mockFactoryFixture();

  const pluginFactoryFactory = await ethers.getContractFactory("BasePluginV1Factory");
  const pluginFactory = (await pluginFactoryFactory.deploy(mockFactory.address)) as IBasePluginV1Factory;

  return {
    pluginFactory,
    mockFactory,
  };
};

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
  const vaultAddress = await factory.communityVault();

  const poolDeployerFactory = new ethers.ContractFactory(
    ALGEBRA_POOL_DEPLOYER_ABI,
    ALGEBRA_POOL_DEPLOYER_BYTECODE,
    deployer,
  );

  const poolDeployer = (await poolDeployerFactory.deploy(factory.address, vaultAddress)) as IAlgebraPoolDeployer;

  const pluginFactoryFactory = await ethers.getContractFactory("BasePluginV1Factory");
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

interface ICHIVaultFactoryFixture {
  ichiVaultFactory: ICHIVaultFactory;
}

async function ichiVaultFactoryFixture(
  factory: IAlgebraFactory,
  pluginFactory: IBasePluginV1Factory,
): Promise<ICHIVaultFactoryFixture> {
  const uV3MathFactory = await ethers.getContractFactory("UV3Math");
  const uV3Math = (await uV3MathFactory.deploy()) as UV3Math;

  const ichiVaultDeployer = await ethers.getContractFactory("ICHIVaultDeployer", {
    libraries: {
      UV3Math: uV3Math.address,
    },
  });
  const libICHIVaultDeployer = await ichiVaultDeployer.deploy();

  const ichiVaultFactoryFactory = await ethers.getContractFactory("ICHIVaultFactory", {
    libraries: {
      ICHIVaultDeployer: libICHIVaultDeployer.address,
    },
  });

  const ichiVaultFactory = (await ichiVaultFactoryFactory.deploy(
    factory.address,
    pluginFactory.address,
    "VEL"
  )) as ICHIVaultFactory;

  return { ichiVaultFactory };
}

type allContractsFixture = AlgebraFixture & TokensFixture;

export const fixture: Fixture<allContractsFixture> = async function (): Promise<allContractsFixture> {
  const { factory, router, nft, pluginFactory, oracle } = await algebraFixture();
  const { token0, token1, token2 } = await tokensFixture();

  return {
    token0,
    token1,
    token2,
    factory,
    router,
    nft,
    pluginFactory,
    oracle,
  };
};

type ICHIVaultTestFixture = AlgebraFixture & TokensFixture & ICHIVaultFactoryFixture;

export const ichiVaultTestFixture: Fixture<ICHIVaultTestFixture> = async function (): Promise<ICHIVaultTestFixture> {
  const { factory, router, nft, pluginFactory, oracle } = await algebraFixture();
  const { token0, token1, token2 } = await tokensFixture();
  const { ichiVaultFactory } = await ichiVaultFactoryFixture(factory, pluginFactory);

  return {
    token0,
    token1,
    token2,
    factory,
    router,
    nft,
    pluginFactory,
    oracle,
    ichiVaultFactory,
  };
};

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
  MockPluginFactory,
  INonfungiblePositionManager,
  ISwapRouter,
  AlgebraVaultStableFactory,
  UV3Math,
  TestERC20,
  TestOracle,
} from "../../types";

const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";

type Fixture<T> = () => Promise<T>;

interface AlgebraFixture {
  factory: IAlgebraFactory;
  router: ISwapRouter;
  nft: INonfungiblePositionManager;
  pluginFactory: MockPluginFactory;
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

  const pluginFactoryFactory = await ethers.getContractFactory("MockPluginFactory");
  const pluginFactory = (await pluginFactoryFactory.deploy()) as MockPluginFactory;

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

interface AlgebraVaultStableFactoryFixture {
  algebraVaultStableFactory: AlgebraVaultStableFactory;
}

async function algebraVaultStableFactoryFixture(
  factory: IAlgebraFactory,
  nft: INonfungiblePositionManager,
): Promise<AlgebraVaultStableFactoryFixture> {
  const uV3MathFactory = await ethers.getContractFactory("UV3Math");
  const uV3Math = (await uV3MathFactory.deploy()) as UV3Math;

  const algebraVaultStableDeployer = await ethers.getContractFactory("AlgebraVaultStableDeployer", {
    libraries: {
      UV3Math: uV3Math.address,
    },
  });
  const libAlgebraVaultStableDeployer = await algebraVaultStableDeployer.deploy();

  const algebraVaultStableFactoryFactory = await ethers.getContractFactory("AlgebraVaultStableFactory", {
    libraries: {
      AlgebraVaultStableDeployer: libAlgebraVaultStableDeployer.address,
    },
  });

  const algebraVaultStableFactory = (await algebraVaultStableFactoryFactory.deploy(
    factory.address,
    NULL_ADDRESS,
    nft.address,
    "VEL"
  )) as AlgebraVaultStableFactory;

  return { algebraVaultStableFactory };
}

type AlgebraVaultStableTestFixture = AlgebraFixture & TokensFixture & AlgebraVaultStableFactoryFixture;

export const algebraVaultStableTestFixture: Fixture<AlgebraVaultStableTestFixture> = async function (): Promise<AlgebraVaultStableTestFixture> {
  const { factory, router, nft, pluginFactory, oracle } = await algebraFixture();
  const { token0, token1, token2 } = await tokensFixture();
  const { algebraVaultStableFactory } = await algebraVaultStableFactoryFixture(factory, nft);

  return {
    token0,
    token1,
    token2,
    factory,
    router,
    nft,
    pluginFactory,
    oracle,
    algebraVaultStableFactory,
  };
};

import {
  IAlgebraFactory,
  IAlgebraPoolDeployer,
  MockPluginFactory,
  INonfungiblePositionManager,
  ISwapRouter,
  IAccessControl,
  IAlgebraEternalFarming,
  AlgebraVaultFactory,
  UV3Math,
  TestERC20,
  TestOracle,
  IFarmingCenter,
  AlgebraVaultDepositGuard,
} from "../../types";
import {
  abi as ALGEBRA_FACTORY_ABI,
  bytecode as ALGEBRA_FACTORY_BYTECODE,
} from "@cryptoalgebra/integral-core/artifacts/contracts/AlgebraFactory.sol/AlgebraFactory.json";
import {
  abi as ALGEBRA_POOL_DEPLOYER_ABI,
  bytecode as ALGEBRA_POOL_DEPLOYER_BYTECODE,
} from "@cryptoalgebra/integral-core/artifacts/contracts/AlgebraPoolDeployer.sol/AlgebraPoolDeployer.json";
import {
  abi as FARMING_CENTER_ABI,
  bytecode as FARMING_CENTER_BYTECODE,
} from "@cryptoalgebra/integral-farming/artifacts/contracts/FarmingCenter.sol/FarmingCenter.json";
import {
  abi as ETERNAL_FARMING_ABI,
  bytecode as ETERNAL_FARMING_BYTECODE,
} from "@cryptoalgebra/integral-farming/artifacts/contracts/farmings/AlgebraEternalFarming.sol/AlgebraEternalFarming.json";
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

const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";

type Fixture<T> = () => Promise<T>;

interface AlgebraFixture {
  factory: IAlgebraFactory;
  router: ISwapRouter;
  nft: INonfungiblePositionManager;
  pluginFactory: MockPluginFactory;
  oracle: TestOracle;
  poolDeployer: IAlgebraPoolDeployer;
}

async function algebraFixture(): Promise<AlgebraFixture> {
  const [deployer] = await ethers.getSigners();

  // precompute
  const poolDeployerAddress = getCreateAddress({
    from: deployer.address,
    nonce: (await ethers.provider.getTransactionCount(deployer.address)) + 1,
  });

  // const factoryFactory = await ethers.getContractFactory('AlgebraFactory');
  const factoryFactory = new ethers.ContractFactory(
    ALGEBRA_FACTORY_ABI,
    ALGEBRA_FACTORY_BYTECODE,
    deployer
  );

  const factory_c = await factoryFactory.deploy(poolDeployerAddress);

  const factory = factory_c as IAlgebraFactory;

  const poolDeployerFactory = new ethers.ContractFactory(
    ALGEBRA_POOL_DEPLOYER_ABI,
    ALGEBRA_POOL_DEPLOYER_BYTECODE,
    deployer
  );

  const poolDeployer = (await poolDeployerFactory.deploy(
    factory.address
  )) as IAlgebraPoolDeployer;

  // const pluginFactoryFactory = await ethers.getContractFactory("BasePluginV1Factory");
  // const pluginFactory = (await pluginFactoryFactory.deploy(factory.address)) as IBasePluginV1Factory;

  const pluginFactoryFactory = await ethers.getContractFactory(
    "MockPluginFactory"
  );
  const pluginFactory =
    (await pluginFactoryFactory.deploy()) as MockPluginFactory;

  await factory.setDefaultPluginFactory(pluginFactory.address);

  const tokenFactory = await ethers.getContractFactory("TestERC20");
  const WETH = (await tokenFactory.deploy(
    BigNumber.from(2).pow(255)
  )) as TestERC20; // TODO: change to real WETH

  const routerFactory = new ethers.ContractFactory(
    SWAP_ROUTER_ABI,
    SWAP_ROUTER_BYTECODE,
    deployer
  );
  const router = (await routerFactory.deploy(
    factory.address,
    WETH.address,
    poolDeployer.address
  )) as ISwapRouter;

  const nftFactory = new ethers.ContractFactory(
    NON_FUNGIBLE_POSITION_MANAGER_ABI,
    NON_FUNGIBLE_POSITION_MANAGER_BYTECODE,
    deployer
  );
  const nft = (await nftFactory.deploy(
    factory.address,
    WETH.address,
    ethers.constants.AddressZero,
    poolDeployer.address
  )) as INonfungiblePositionManager;

  const uV3MathFactory = await ethers.getContractFactory("UV3Math");
  const uV3Math = (await uV3MathFactory.deploy()) as UV3Math;
  const oracleFactory = await ethers.getContractFactory("TestOracle", {
    libraries: {
      UV3Math: uV3Math.address,
    },
  });
  const oracle = (await oracleFactory.deploy()) as TestOracle;

  return { factory, router, nft, pluginFactory, oracle, poolDeployer };
}

interface TokensFixture {
  token0: TestERC20;
  token1: TestERC20;
  token2: TestERC20;
  token3: TestERC20;
}

async function tokensFixture(): Promise<TokensFixture> {
  const tokenFactory = await ethers.getContractFactory("TestERC20");
  const tokenA = (await tokenFactory.deploy(
    BigNumber.from(2).pow(255)
  )) as TestERC20;
  const tokenB = (await tokenFactory.deploy(
    BigNumber.from(2).pow(255)
  )) as TestERC20;
  const tokenC = (await tokenFactory.deploy(
    BigNumber.from(2).pow(255)
  )) as TestERC20;
  const tokenD = (await tokenFactory.deploy(
    BigNumber.from(2).pow(255)
  )) as TestERC20;

  const [token0, token1, token2, token3] = [
    tokenA,
    tokenB,
    tokenC,
    tokenD,
  ].sort((tokenA, tokenB) =>
    tokenA.address.toLowerCase() < tokenB.address.toLowerCase() ? -1 : 1
  );

  return { token0, token1, token2, token3 };
}

interface AlgebraVaultFactoryFixture {
  algebraVaultFactory: AlgebraVaultFactory;
  algebraEternalFarming: IAlgebraEternalFarming;
  farmingCenter: IFarmingCenter;
  depositGuard: AlgebraVaultDepositGuard;
  depositGuardToken1: AlgebraVaultDepositGuard;
}

async function algebraVaultFactoryFixture(
  factory: IAlgebraFactory,
  poolDeployer: IAlgebraPoolDeployer,
  nft: INonfungiblePositionManager,
  token0: TestERC20,
  token1: TestERC20
): Promise<AlgebraVaultFactoryFixture> {
  const [deployer] = await ethers.getSigners();

  const uV3MathFactory = await ethers.getContractFactory("UV3Math");
  const uV3Math = (await uV3MathFactory.deploy()) as UV3Math;

  const eternalFarmingFactory = new ethers.ContractFactory(
    ETERNAL_FARMING_ABI,
    ETERNAL_FARMING_BYTECODE,
    deployer
  );
  const algebraEternalFarming = (await eternalFarmingFactory.deploy(
    poolDeployer.address,
    nft.address
  )) as IAlgebraEternalFarming;

  const farmingCenterFactory = new ethers.ContractFactory(
    FARMING_CENTER_ABI,
    FARMING_CENTER_BYTECODE,
    deployer
  );
  const farmingCenter = (await farmingCenterFactory.deploy(
    algebraEternalFarming.address,
    nft.address
  )) as IFarmingCenter;

  await nft.setFarmingCenter(farmingCenter.address);

  await algebraEternalFarming.setFarmingCenterAddress(farmingCenter.address);

  const incentiveMakerRole = await algebraEternalFarming.INCENTIVE_MAKER_ROLE();

  await (factory as any as IAccessControl).grantRole(
    incentiveMakerRole,
    deployer.address
  );

  const algebraVaultDeployer = await ethers.getContractFactory(
    "AlgebraVaultDeployer",
    {
      libraries: {
        UV3Math: uV3Math.address,
      },
    }
  );
  const libAlgebraVaultDeployer = await algebraVaultDeployer.deploy();

  const farmingRewardsDistributorDeployer = await ethers.getContractFactory(
    "FarmingRewardsDistributorDeployer"
  );
  const libFarmingRewardsDistributorDeployer =
    await farmingRewardsDistributorDeployer.deploy();

  const algebraVaultFactoryFactory = await ethers.getContractFactory(
    "AlgebraVaultFactory",
    {
      libraries: {
        AlgebraVaultDeployer: libAlgebraVaultDeployer.address,
        FarmingRewardsDistributorDeployer:
          libFarmingRewardsDistributorDeployer.address,
      },
    }
  );

  const algebraVaultFactory = (await algebraVaultFactoryFactory.deploy(
    factory.address,
    NULL_ADDRESS,
    algebraEternalFarming.address,
    nft.address,
    "VEL"
  )) as AlgebraVaultFactory;

  const depositGuardFactory = await ethers.getContractFactory(
    "AlgebraVaultDepositGuard"
  );
  const depositGuard = (await depositGuardFactory.deploy(
    algebraVaultFactory.address,
    token0.address
  )) as AlgebraVaultDepositGuard;
  const depositGuardToken1 = (await depositGuardFactory.deploy(
    algebraVaultFactory.address,
    token1.address
  )) as AlgebraVaultDepositGuard;

  return {
    algebraVaultFactory,
    algebraEternalFarming,
    farmingCenter,
    depositGuard,
    depositGuardToken1,
  };
}

type AlgebraVaultTestFixture = AlgebraFixture &
  TokensFixture &
  AlgebraVaultFactoryFixture;

export const algebraVaultTestFixture: Fixture<AlgebraVaultTestFixture> =
  async function (): Promise<AlgebraVaultTestFixture> {
    const { factory, router, nft, pluginFactory, oracle, poolDeployer } =
      await algebraFixture();
    const { token0, token1, token2, token3 } = await tokensFixture();
    const {
      algebraVaultFactory,
      algebraEternalFarming,
      farmingCenter,
      depositGuard,
      depositGuardToken1,
    } = await algebraVaultFactoryFixture(factory, poolDeployer, nft, token0, token1);

    return {
      token0,
      token1,
      token2,
      token3,
      factory,
      router,
      nft,
      pluginFactory,
      oracle,
      poolDeployer,
      algebraVaultFactory,
      algebraEternalFarming,
      farmingCenter,
      depositGuard,
      depositGuardToken1,
    };
  };

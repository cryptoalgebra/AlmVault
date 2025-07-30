import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network } from "hardhat";

import {
  IAlgebraEternalFarming,
  IAlgebraFactory,
  IFarmingCenter,
  INonfungiblePositionManager,
  ISwapRouter
} from "../types";
import { IAlgebraPool } from "../types/@cryptoalgebra/integral-core/contracts/interfaces/IAlgebraPool";
import { AlgebraVault } from "../types/contracts/AlgebraVault";
import { AlgebraVaultFactory } from "../types/contracts/AlgebraVaultFactory";
import { UV3Math } from "../types/contracts/lib/UV3Math";
import { TestERC20 } from "../types/contracts/mocks/TestERC20";
import { TestOracle } from "../types/contracts/mocks/TestOracle";
import { algebraVaultTestFixture } from "./shared/fixtures";
import { FeeAmount, TICK_SPACINGS, encodePriceSqrt, getMaxTick, getMinTick } from "./shared/utilities";
import {BigNumber} from "ethers";

const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";

const PERCENT_101 = "1010000000000000000";
const PERCENT_100 = "1000000000000000000";
const PERCENT_81 = "810000000000000000";
const PERCENT_50 = "500000000000000000";
const PERCENT_40 = "400000000000000000";
const PERCENT_20 = "200000000000000000";
const PERCENT_10 = "100000000000000000";

const smallTokenAmount = ethers.utils.parseEther("1000");
const largeTokenAmount = ethers.utils.parseEther("1000000");
const veryLargeTokenAmount = ethers.utils.parseEther("10000000000");
const giantTokenAmount = ethers.utils.parseEther("1000000000000");

describe("Farming Integration", () => {
  const totalReward = BigNumber.from(2_000_000);
  const bonusReward = BigNumber.from(4_000);
  const duration = 40 * 24 * 60 * 60; // 40 days

  let factory: IAlgebraFactory;
  let nft: INonfungiblePositionManager;
  let token0: TestERC20;
  let token1: TestERC20;
  let token2: TestERC20;
  let algebraPool: IAlgebraPool;
  let algebraVaultFactory: AlgebraVaultFactory;
  let algebraEternalFarming: IAlgebraEternalFarming;
  let farmingCenter: IFarmingCenter;
  let algebraVault: AlgebraVault;

  let wallet: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let carol: SignerWithAddress;
  let other: SignerWithAddress;
  let user0: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;
  let user4: SignerWithAddress;

  before("create fixture loader", async () => {
    [wallet, alice, bob, carol, other, user0, user1, user2, user3, user4] = await ethers.getSigners();
  });

  beforeEach("deploy contracts", async () => {
    ({ token0, token1, token2, factory, nft, algebraVaultFactory, algebraEternalFarming, farmingCenter } = await loadFixture(
      algebraVaultTestFixture,
    ));
    await factory.createPool(token0.address, token1.address, '0x');
    const poolAddress = await factory.poolByPair(token0.address, token1.address);

    algebraPool = (await ethers.getContractAt("IAlgebraPool", poolAddress)) as IAlgebraPool;
    await algebraPool.initialize(encodePriceSqrt("1", "1"));

    let nonce = await algebraEternalFarming.numOfIncentives();

    await token1.approve(algebraEternalFarming.address, bonusReward);
    await token2.approve(algebraEternalFarming.address, totalReward);

    await algebraEternalFarming.createEternalFarming(
        {
          pool: algebraPool.address,
          rewardToken: token2.address,
          bonusRewardToken: token1.address,
          nonce,
        },
        {
          reward: totalReward,
          bonusReward: bonusReward,
          rewardRate: 10,
          bonusRewardRate: 10,
          minimalPositionWidth: 1,
        },
        await algebraPool.plugin()
    )

    await algebraVaultFactory.connect(wallet).createAlgebraVault(token0.address, true, token1.address, false);

    const algebraVaultAddress = await algebraVaultFactory.allVaults(0);
    algebraVault = (await ethers.getContractAt("AlgebraVault", algebraVaultAddress)) as AlgebraVault;

    await expect(
      algebraVault.connect(wallet).setDepositMax(ethers.utils.parseEther("100000"), ethers.utils.parseEther("100000")),
    )
      .to.emit(algebraVault, "DepositMax")
      .withArgs(wallet.address, ethers.utils.parseEther("100000"), ethers.utils.parseEther("100000"));

    // adding extra liquidity into pool to make sure there's always
    // someone to swap with
    await token0.mint(carol.address, giantTokenAmount);
    await token1.mint(carol.address, giantTokenAmount);

    await token0.connect(carol).approve(nft.address, veryLargeTokenAmount);
    await token1.connect(carol).approve(nft.address, veryLargeTokenAmount);

    await nft.connect(carol).mint({
      token0: token0.address,
      token1: token1.address,
      deployer: NULL_ADDRESS,
      //fee: FeeAmount.MEDIUM,
      tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
      tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
      recipient: carol.address,
      amount0Desired: veryLargeTokenAmount,
      amount1Desired: veryLargeTokenAmount,
      //amount0Desired: 1000,
      //amount1Desired: 1000,
      amount0Min: 0,
      amount1Min: 0,
      deadline: 2000000000,
    });

    await network.provider.send("evm_increaseTime", [3600]);
  });

  it("Enters farming on rebalance", async () => {});
});

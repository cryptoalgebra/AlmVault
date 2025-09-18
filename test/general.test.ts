import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network } from "hardhat";

import { IAlgebraFactory, INonfungiblePositionManager, ISwapRouter } from "../types";
import { IAlgebraPool } from "../types/@cryptoalgebra/integral-core/contracts/interfaces/IAlgebraPool";
import { AlgebraVaultStable } from "../types/contracts/AlgebraVaultStable";
import { AlgebraVaultStableFactory } from "../types/contracts/AlgebraVaultStableFactory";
import { UV3Math } from "../types/contracts/lib/UV3Math";
import { TestERC20 } from "../types/contracts/mocks/TestERC20";
import { TestOracle } from "../types/contracts/mocks/TestOracle";
import { algebraVaultStableTestFixture } from "./shared/fixtures";
import { FeeAmount, TICK_SPACINGS, encodePriceSqrt, getMaxTick, getMinTick } from "./shared/utilities";

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

describe("Access Control Checks", () => {
  let factory: IAlgebraFactory;
  let router: ISwapRouter;
  let nft: INonfungiblePositionManager;
  let oracle: TestOracle;
  let token0: TestERC20;
  let token1: TestERC20;
  let token2: TestERC20;
  let uniswapPool: IAlgebraPool;
  let algebraVaultStableFactory: AlgebraVaultStableFactory;
  let algebraVaultStable: AlgebraVaultStable;

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
    ({ token0, token1, token2, factory, router, nft, oracle, algebraVaultStableFactory } = await loadFixture(
      algebraVaultStableTestFixture,
    ));
    await factory.createPool(token0.address, token1.address, '0x');
    await factory.createPool(token0.address, token2.address, '0x');
    const poolAddress = await factory.poolByPair(token0.address, token1.address);
    const pool2Address = await factory.poolByPair(token0.address, token2.address);
    // console.log(poolAddress);
    uniswapPool = (await ethers.getContractAt("IAlgebraPool", poolAddress)) as IAlgebraPool;
    const uniswapPool2 = (await ethers.getContractAt("IAlgebraPool", pool2Address)) as IAlgebraPool;
    await uniswapPool.initialize(encodePriceSqrt("1", "1"));
    await uniswapPool2.initialize(encodePriceSqrt("1", "1"));

    await algebraVaultStableFactory.connect(wallet).createAlgebraVault(token0.address, token1.address);

    const algebraVaultStableAddress = await algebraVaultStableFactory.allVaults(0);
    algebraVaultStable = (await ethers.getContractAt("AlgebraVaultStable", algebraVaultStableAddress)) as AlgebraVaultStable;

    await expect(
      algebraVaultStable.connect(wallet).setDepositMax(ethers.utils.parseEther("100000"), ethers.utils.parseEther("100000")),
    )
      .to.emit(algebraVaultStable, "DepositMax")
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

  it("AlgebraVaultStable", async () => {
    const msg1 = "AV.onlyRebalancerOrRebalanceManager not allowed";
    const msg2 = "AV.onlyManager not allowed";


    await expect(algebraVaultStable.connect(alice).rebalance(-1800, 1800, 0)).to.be.revertedWith(msg1);
    await expect(algebraVaultStable.connect(alice).setHysteresis(50)) // 5%
      .to.be.revertedWith(msg2);
    await expect(algebraVaultStable.connect(alice).setTwapPeriod(1800)).to.be.revertedWith(msg2);
  });
});

describe("Input Validation Checks", () => {
  let factory: IAlgebraFactory;
  let router: ISwapRouter;
  let nft: INonfungiblePositionManager;
  let oracle: TestOracle;
  let token0: TestERC20;
  let token1: TestERC20;
  let token2: TestERC20;
  let uniswapPool: IAlgebraPool;
  let algebraVaultStableFactory: AlgebraVaultStableFactory;
  let algebraVaultStable: AlgebraVaultStable;
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
    [wallet, alice, bob, carol, other, user0, user1, user2, user3, user4] = await (ethers as any).getSigners();
  });

  beforeEach("deploy contracts", async () => {
    ({ token0, token1, token2, factory, router, nft, oracle, algebraVaultStableFactory } = await loadFixture(
      algebraVaultStableTestFixture,
    ));

    await factory.createPool(token0.address, token1.address, '0x');
    let poolAddress = await factory.poolByPair(token0.address, token1.address);
    uniswapPool = (await ethers.getContractAt("IAlgebraPool", poolAddress)) as IAlgebraPool;
    await uniswapPool.initialize(encodePriceSqrt("1", "1"));

    const tx = await algebraVaultStableFactory.connect(wallet).createAlgebraVault(token0.address, token1.address);

    const algebraVaultStableAddress = await algebraVaultStableFactory.allVaults(0);
    algebraVaultStable = (await ethers.getContractAt("AlgebraVaultStable", algebraVaultStableAddress)) as AlgebraVaultStable;

    await expect(tx)
      .to.emit(algebraVaultStableFactory, "AlgebraVaultStableCreated")
      .withArgs(wallet.address, algebraVaultStable.address, token0.address, token1.address, 1);
    poolAddress = await algebraVaultStable.pool();
    await expect(tx)
      .to.emit(algebraVaultStable, "DeployAlgebraVaultStable")
      .withArgs(algebraVaultStableFactory.address, poolAddress, 3600);

    await algebraVaultStable.connect(wallet).setDepositMax(ethers.utils.parseEther("100000"), ethers.utils.parseEther("100000"));

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
      tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
      tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
      recipient: carol.address,
      amount0Desired: veryLargeTokenAmount,
      amount1Desired: veryLargeTokenAmount,
      amount0Min: 0,
      amount1Min: 0,
      deadline: 2000000000,
    });

    await network.provider.send("evm_increaseTime", [3600]);
  });

  it("algebraVaultStableFactory - misc", async () => {
    const msg1 = "AVF.constructor: zero address",
      msg2 = "AVF.setFeeRecipient: zero address",
      msg3 = "AVF.setBaseFee: fees must be <= 10**18",
      msg4 = "AVF.setAmmFee: fees must be <= 10**18",
      msg5 = "AVF.setBaseFeeSplit: must be <= 10**18";

    const uV3MathFactory = await ethers.getContractFactory("UV3Math");
    const uV3Math = (await uV3MathFactory.deploy()) as UV3Math;

    const algebraVaultStableDeployer = await ethers.getContractFactory("AlgebraVaultStableDeployer", {
      libraries: {
        UV3Math: uV3Math.address,
      },
    });
    //const libalgebraVaultStableDeployer = (await algebraVaultStableDeployer.deploy()) as algebraVaultStableDeployer
    const libalgebraVaultStableDeployer = await algebraVaultStableDeployer.deploy();

    const algebraVaultStableFactoryFactory = await ethers.getContractFactory("AlgebraVaultStableFactory", {
      libraries: {
        AlgebraVaultStableDeployer: libalgebraVaultStableDeployer.address,
      },
    });

    await expect(algebraVaultStableFactoryFactory.deploy(NULL_ADDRESS, NULL_ADDRESS, NULL_ADDRESS, "VEL")).to.be.revertedWith(msg1);

    await expect(algebraVaultStableFactory.connect(wallet).setFeeRecipient(NULL_ADDRESS)).to.be.revertedWith(msg2);
    await expect(algebraVaultStableFactory.connect(wallet).setBaseFee(PERCENT_101)).to.be.revertedWith(msg3);
    await expect(algebraVaultStableFactory.connect(wallet).setAmmFee(PERCENT_101)).to.be.revertedWith(msg4);
    await expect(algebraVaultStableFactory.connect(wallet).setBaseFeeSplit(PERCENT_101)).to.be.revertedWith(msg5);
    await algebraVaultStableFactory.connect(wallet).setAmmFee(PERCENT_10);
    await algebraVaultStableFactory.connect(wallet).setAmmFee(0);

    await expect(algebraVaultStableFactory.connect(wallet).setAmmFee(PERCENT_81)).to.be.revertedWith(msg4);
  });

  it("algebraVaultStableFactory - createAlgebraVault", async () => {
    const msg1 = "AVF.createAlgebraVault: identical tokens",
      msg2 = "AVF.createAlgebraVault: zero address",
      msg4 = "AVF.createAlgebraVault: vault exists",
      msg6 = "AVF.createAlgebraVault: pool must exist";

    await expect(
      algebraVaultStableFactory.connect(wallet).createAlgebraVault(token0.address, token0.address),
    ).to.be.revertedWith(msg1);
    await expect(
      algebraVaultStableFactory.connect(wallet).createAlgebraVault(NULL_ADDRESS, token1.address),
    ).to.be.revertedWith(msg2);
    await expect(
      algebraVaultStableFactory.connect(wallet).createAlgebraVault(token0.address, NULL_ADDRESS),
    ).to.be.revertedWith(msg2);
    await expect(
      algebraVaultStableFactory.connect(wallet).createAlgebraVault(token0.address, token1.address),
    ).to.be.revertedWith(msg4);
    await expect(
      algebraVaultStableFactory.connect(wallet).createAlgebraVault(token0.address, token1.address),
    ).to.be.revertedWith(msg4);
    await expect(
      algebraVaultStableFactory.connect(wallet).createAlgebraVault(token0.address, token2.address),
    ).to.be.revertedWith(msg6);

    await factory.createPool(token0.address, token2.address, '0x');
    const poolAddress = await factory.poolByPair(token0.address, token2.address);
    uniswapPool = (await ethers.getContractAt("IAlgebraPool", poolAddress)) as IAlgebraPool;
    await uniswapPool.initialize(encodePriceSqrt("1", "1"));

    await algebraVaultStableFactory.connect(wallet).createAlgebraVault(token0.address, token2.address);
  });

  function msg(text: string) {
    return "VM Exception while processing transaction: reverted with reason string '" + text + "'";
  }

  it("algebraVaultStable - manual calls", async () => {
    const msg1 = "AV.constructor: zero address";

    const uV3MathFactory = await ethers.getContractFactory("UV3Math");
    const uV3Math = (await uV3MathFactory.deploy()) as UV3Math;

    const algebraVaultStableFactory = await ethers.getContractFactory("AlgebraVaultStable", {
      libraries: {
        UV3Math: uV3Math.address,
      },
    });

    await expect(algebraVaultStableFactory.deploy(NULL_ADDRESS, 3600, 0)).to.be.reverted;

    //await expect(algebraVaultStable.algebraMintCallback(1, 1, [])).to.be.reverted;
    await expect(algebraVaultStable.algebraSwapCallback(1, 1, [])).to.be.reverted;
  });

  it("algebraVaultStable - disconnected plugin", async () => {
    const msg1 = "AV: diconnected plugin",
          msg2 = "AV.deposit: to";

    await factory.createPool(token0.address, token2.address, '0x');
    let poolAddress = await factory.poolByPair(token0.address, token2.address);
    let uniswapPool = (await ethers.getContractAt("IAlgebraPool", poolAddress)) as IAlgebraPool;

    await algebraVaultStableFactory.connect(wallet).createAlgebraVault(token0.address, token2.address);

    const vaultKey = await algebraVaultStableFactory.genKey(wallet.address, token0.address, token2.address);
    const algebraVaultStableAddress = await algebraVaultStableFactory.getAlgebraVault(vaultKey);
    algebraVaultStable = (await ethers.getContractAt("AlgebraVaultStable", algebraVaultStableAddress)) as AlgebraVaultStable;

    const pluginAddress = await uniswapPool.plugin()
    //console.log("default plugin: " + pluginAddress);

    // plugin isn't connected yet
    await uniswapPool.setPlugin(NULL_ADDRESS);
    await expect(
        algebraVaultStable.deposit(ethers.utils.parseEther("4000"), ethers.utils.parseEther("4000"), alice.address),
      ).to.be.revertedWith(msg1);

    // connect plugin here
    await uniswapPool.setPlugin(pluginAddress);

    //check 'to' address
    await expect(
      algebraVaultStable.connect(alice).deposit(ethers.utils.parseEther("4000"), ethers.utils.parseEther("4000"), NULL_ADDRESS),
    ).to.be.revertedWith(msg2);
  });

  it("algebraVaultStable - deposit", async () => {
    const
      msg3 = "AV.deposit: deposits must be > 0",
      msg4 = "AV.deposit: deposits too large",
      msg5 = "AV.deposit: to",
      msg6 = "AV.deposit: maxTotalSupply";

    // pool already exists and initialized
    //await factory.createPool(token0.address, token1.address)

    let poolAddress = await factory.poolByPair(token0.address, token1.address);
    let uniswapPool = (await ethers.getContractAt("IAlgebraPool", poolAddress)) as IAlgebraPool;
    // pool already exists and initialized
    //await uniswapPool.initialize(encodePriceSqrt('1', '1'))

    await factory.createPool(token1.address, token2.address, '0x');
    await factory.createPool(token0.address, token2.address, '0x');
    let pool12Address = await factory.poolByPair(token1.address, token2.address);
    poolAddress = await factory.poolByPair(token0.address, token2.address);
    let uniswapPool12 = (await ethers.getContractAt("IAlgebraPool", pool12Address)) as IAlgebraPool;
    uniswapPool = (await ethers.getContractAt("IAlgebraPool", poolAddress)) as IAlgebraPool;
    await uniswapPool12.initialize(encodePriceSqrt("1", "1"));
    await uniswapPool.initialize(encodePriceSqrt("1", "1"));

    await algebraVaultStableFactory.connect(wallet).createAlgebraVault(token1.address, token2.address);
    await algebraVaultStableFactory.connect(wallet).createAlgebraVault(token0.address, token2.address);

    // check allowToken policy
    let vaultKey = await algebraVaultStableFactory.genKey(wallet.address, token1.address, token2.address);
    let algebraVaultStableAddress = await algebraVaultStableFactory.getAlgebraVault(vaultKey);
    algebraVaultStable = (await ethers.getContractAt("AlgebraVaultStable", algebraVaultStableAddress)) as AlgebraVaultStable;

    await expect(
      algebraVaultStable.deposit(smallTokenAmount, ethers.utils.parseEther("4000"), NULL_ADDRESS),
    ).to.be.revertedWith(msg5);

    vaultKey = await algebraVaultStableFactory.genKey(wallet.address, token0.address, token2.address);
    algebraVaultStableAddress = await algebraVaultStableFactory.getAlgebraVault(vaultKey);
    algebraVaultStable = (await ethers.getContractAt("AlgebraVaultStable", algebraVaultStableAddress)) as AlgebraVaultStable;

    // Skip this test since we now don't have allowToken0
    // await expect(algebraVaultStable.deposit(smallTokenAmount, ethers.utils.parseEther("4000"), alice.address)).to.be.revertedWith(msg1);

    // check deposit values
    vaultKey = await algebraVaultStableFactory.genKey(wallet.address, token0.address, token1.address);
    algebraVaultStableAddress = await algebraVaultStableFactory.getAlgebraVault(vaultKey);
    algebraVaultStable = (await ethers.getContractAt("AlgebraVaultStable", algebraVaultStableAddress)) as AlgebraVaultStable;
    await expect(algebraVaultStable.deposit(0, 0, alice.address)).to.be.revertedWith(msg3);

    vaultKey = await algebraVaultStableFactory.genKey(wallet.address, token0.address, token2.address);
    algebraVaultStableAddress = await algebraVaultStableFactory.getAlgebraVault(vaultKey);
    algebraVaultStable = (await ethers.getContractAt("AlgebraVaultStable", algebraVaultStableAddress)) as AlgebraVaultStable;
    await expect(algebraVaultStable.deposit(0, 0, alice.address)).to.be.revertedWith(msg3);

    // check against max deposit amounts
    vaultKey = await algebraVaultStableFactory.genKey(wallet.address, token0.address, token1.address);
    algebraVaultStableAddress = await algebraVaultStableFactory.getAlgebraVault(vaultKey);
    algebraVaultStable = (await ethers.getContractAt("AlgebraVaultStable", algebraVaultStableAddress)) as AlgebraVaultStable;
    await expect(
      algebraVaultStable.deposit(ethers.utils.parseEther("200000"), ethers.utils.parseEther("4000"), alice.address),
    ).to.be.revertedWith(msg4);
    await expect(
      algebraVaultStable.deposit(ethers.utils.parseEther("4000"), ethers.utils.parseEther("200000"), alice.address),
    ).to.be.revertedWith(msg4);

    // alice approves the algebraVaultStable to transfer her tokens
    await token0.connect(alice).approve(algebraVaultStable.address, largeTokenAmount);
    await token1.connect(alice).approve(algebraVaultStable.address, largeTokenAmount);
    // mint tokens to alice
    await token0.mint(alice.address, largeTokenAmount);
    await token1.mint(alice.address, largeTokenAmount);

    //check 'to' address
    await expect(
      algebraVaultStable.connect(alice).deposit(ethers.utils.parseEther("4000"), ethers.utils.parseEther("4000"), NULL_ADDRESS),
    ).to.be.revertedWith(msg5);
    await expect(
      algebraVaultStable
        .connect(alice)
        .deposit(ethers.utils.parseEther("4000"), ethers.utils.parseEther("4000"), algebraVaultStableAddress),
    ).to.be.revertedWith(msg5);
  });

  it("algebraVaultStable - withdraw", async () => {
    const msg1 = "AV.withdraw: to",
      msg2 = "AV.withdraw: shares";

    // alice approves the algebraVaultStable to transfer her tokens
    await token0.connect(alice).approve(algebraVaultStable.address, largeTokenAmount);
    await token1.connect(alice).approve(algebraVaultStable.address, largeTokenAmount);
    // mint tokens to alice
    await token0.mint(alice.address, largeTokenAmount);
    await token1.mint(alice.address, largeTokenAmount);

    await algebraVaultStable
      .connect(alice)
      .deposit(ethers.utils.parseEther("4000"), ethers.utils.parseEther("4000"), alice.address);

    //check 'to' address
    await expect(algebraVaultStable.connect(alice).withdraw(ethers.utils.parseEther("4000"), NULL_ADDRESS)).to.be.revertedWith(
      msg1,
    );
    //check shares
    await expect(algebraVaultStable.connect(alice).withdraw(0, alice.address)).to.be.revertedWith(msg2);
  });

  it("AlgebraVault - rebalance", async () => {
    const msg1 = "AV.rebalance: base position invalid",
      msg3 = "AV.rebalance: identical positions",
      msg2 = "AV.rebalance: limit position invalid";

    // alice approves the AlgebraVault to transfer her tokens
    await token0.connect(alice).approve(algebraVaultStable.address, largeTokenAmount);
    await token1.connect(alice).approve(algebraVaultStable.address, largeTokenAmount);
    // mint tokens to alice
    await token0.mint(alice.address, largeTokenAmount);
    await token1.mint(alice.address, largeTokenAmount);

    const tickSpacing = await algebraVaultStable.tickSpacing();
    console.log(tickSpacing.toString());
    const fee = await algebraVaultStable.fee();
    //console.log(fee.toString());

    await algebraVaultStable
      .connect(alice)
      .deposit(ethers.utils.parseEther("4000"), ethers.utils.parseEther("4000"), alice.address);

    // await expect(algebraVaultStable.connect(wallet).rebalance(-1800, -1200, 0)).to.be.revertedWith(msg3); // there's no more such an error
    await expect(algebraVaultStable.connect(wallet).rebalance(1800, 1200, 0)).to.be.revertedWith(msg1);
    // await expect(algebraVaultStable.connect(wallet).rebalance(-1800, -1200, 0)).to.be.revertedWith(msg2); // there's no more such an error

    //let afee = await algebraVaultFactory.connect(wallet).ammFee()
    //let bfee = await algebraVaultFactory.connect(wallet).baseFee()
    //console.log(afee.toString());
    //console.log(bfee.toString());
    // const balance0before = await token0.balanceOf(algebraVaultStable.address);
    // const balance1before = await token1.balanceOf(algebraVaultStable.address);

    await algebraVaultStable.connect(wallet).rebalance(-120, 120, 0);
    const balance0 = await token0.balanceOf(algebraVaultStable.address);
    const balance1 = await token1.balanceOf(algebraVaultStable.address);
    expect(balance0).to.be.equal(0);
    expect(balance1).to.be.equal(0);

    const rebalanceSwapAmount = ethers.utils.parseEther("4000");
    await expect(algebraVaultStable.connect(wallet).rebalance(1800, 1000, rebalanceSwapAmount)).to.be.revertedWith(
      msg1,
    );
    await expect(algebraVaultStable.connect(wallet).rebalance(-1800, 1000, rebalanceSwapAmount)).to.be.revertedWith(
      msg1,
    );
    await expect(algebraVaultStable.connect(wallet).rebalance(-1000, 1800, rebalanceSwapAmount)).to.be.revertedWith(
      msg1,
    );

    // there's no more such an errors
    // await expect(algebraVaultStable.connect(wallet).rebalance(-1800, 1200, rebalanceSwapAmount)).to.be.revertedWith(
    //   msg2,
    // );
    // await expect(algebraVaultStable.connect(wallet).rebalance(-1800, 1200, rebalanceSwapAmount)).to.be.revertedWith(
    //   msg2,
    // );
    // await expect(algebraVaultStable.connect(wallet).rebalance(-1800, 1200, rebalanceSwapAmount)).to.be.revertedWith(
    //   msg2,
    // );
  });

  it("algebraVaultStable - setTwapPeriod", async () => {
    const msg1 = "AV.setTwapPeriod: missing period";

    await expect(algebraVaultStable.connect(wallet).setTwapPeriod(0)).to.be.revertedWith(msg1);

    await expect(algebraVaultStable.connect(wallet).setTwapPeriod(1800))
      .to.emit(algebraVaultStable, "SetTwapPeriod")
      .withArgs(wallet.address, 1800);
  });

  it("algebraVaultStable - setHysteresis", async () => {
    await expect(algebraVaultStable.connect(wallet).setHysteresis(50)) // 5%
      .to.emit(algebraVaultStable, "Hysteresis")
      .withArgs(wallet.address, 50);
  });

  it("algebraVaultStable - setAmmFeeRecipient", async () => {
    await expect(algebraVaultStable.connect(wallet).setAmmFeeRecipient(NULL_ADDRESS))
      .to.emit(algebraVaultStable, "AmmFeeRecipient")
      .withArgs(wallet.address, NULL_ADDRESS);
  });

  it("AlgebraVault - symbol", async () => {
    await factory.createPool(token1.address, token2.address, '0x');
    await algebraVaultStableFactory.connect(wallet).createAlgebraVault(token1.address, token2.address);

    let algebraVaultStableAddress = await algebraVaultStableFactory.allVaults(0);
    algebraVaultStable = (await ethers.getContractAt("AlgebraVaultStable", algebraVaultStableAddress)) as AlgebraVaultStable;

    let symbol = await algebraVaultStable.symbol();
    expect(symbol).to.equal("AV-VEL-0-symbol-symbol");

    algebraVaultStableAddress = await algebraVaultStableFactory.allVaults(1);
    algebraVaultStable = (await ethers.getContractAt("AlgebraVaultStable", algebraVaultStableAddress)) as AlgebraVaultStable;

    symbol = await algebraVaultStable.symbol();
    expect(symbol).to.equal("AV-VEL-1-symbol-symbol");
  });

  // it("algebraVaultStable - symbol", async () => {
  //   await factory.createPool(token1.address, token2.address, '0x');
  //   const pool12Address = await factory.poolByPair(token1.address, token2.address);
  //   const uniswapPool12 = (await ethers.getContractAt("IAlgebraPool", pool12Address)) as IAlgebraPool;
  //   await uniswapPool12.initialize(encodePriceSqrt("1", "1"));
    
  //   const tx = await algebraVaultStableFactory.connect(wallet).createAlgebraVault(token1.address, token2.address);

  //   // Get the vault key for the newly created vault
  //   const vaultKey = await algebraVaultStableFactory.genKey(wallet.address, token1.address, token2.address);
  //   let algebraVaultStableAddress = await algebraVaultStableFactory.getAlgebraVault(vaultKey);
  //   algebraVaultStable = (await ethers.getContractAt("AlgebraVaultStable", algebraVaultStableAddress)) as AlgebraVaultStable;

  //   let symbol = await algebraVaultStable.symbol();
  //   expect(symbol).to.include("AV-VEL"); // Just check it contains the expected prefix
  // });
});

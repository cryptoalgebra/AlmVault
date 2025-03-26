import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network } from "hardhat";

import { IAlgebraFactory, IBasePluginV1Factory, INonfungiblePositionManager, ISwapRouter } from "../types";
import { IAlgebraPool } from "../types/@cryptoalgebra/integral-core/contracts/interfaces/IAlgebraPool";
import { AlgebraVault } from "../types/contracts/AlgebraVault";
import { AlgebraVaultFactory } from "../types/contracts/AlgebraVaultFactory";
import { UV3Math } from "../types/contracts/lib/UV3Math";
import { TestERC20 } from "../types/contracts/mocks/TestERC20";
import { TestOracle } from "../types/contracts/mocks/TestOracle";
import { algebraVaultTestFixture } from "./shared/fixtures";
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
  let algebraVaultFactory: AlgebraVaultFactory;
  let algebraVault: AlgebraVault;
  let pluginFactory: IBasePluginV1Factory;

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
    ({ token0, token1, token2, factory, router, nft, pluginFactory, oracle, algebraVaultFactory } = await loadFixture(
      algebraVaultTestFixture,
    ));
    await factory.createPool(token0.address, token1.address, '0x');
    const poolAddress = await factory.poolByPair(token0.address, token1.address);
    // console.log(poolAddress);
    uniswapPool = (await ethers.getContractAt("IAlgebraPool", poolAddress)) as IAlgebraPool;
    await uniswapPool.initialize(encodePriceSqrt("1", "1"));

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

  it("AlgebraVault", async () => {
    const msg1 = "Ownable: caller is not the owner";

    await expect(algebraVault.connect(alice).rebalance(-1800, 1800, -600, 0, 0)).to.be.revertedWith(msg1);
    await expect(
      algebraVault.connect(alice).setDepositMax(ethers.utils.parseEther("100000"), ethers.utils.parseEther("100000")),
    ).to.be.revertedWith(msg1);
    await expect(algebraVault.connect(alice).setHysteresis(50)) // 5%
      .to.be.revertedWith(msg1);
    await expect(algebraVault.connect(alice).setTwapPeriod(1800)).to.be.revertedWith(msg1);
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
  let algebraVaultFactory: AlgebraVaultFactory;
  let algebraVault: AlgebraVault;
  let pluginFactory: IBasePluginV1Factory;
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
    ({ token0, token1, token2, factory, router, nft, pluginFactory, oracle, algebraVaultFactory } = await loadFixture(
      algebraVaultTestFixture,
    ));

    await factory.createPool(token0.address, token1.address, '0x');
    let poolAddress = await factory.poolByPair(token0.address, token1.address);
    uniswapPool = (await ethers.getContractAt("IAlgebraPool", poolAddress)) as IAlgebraPool;
    await uniswapPool.initialize(encodePriceSqrt("1", "1"));

    const tx = await algebraVaultFactory.connect(wallet).createAlgebraVault(token0.address, true, token1.address, false);

    const algebraVaultAddress = await algebraVaultFactory.allVaults(0);
    algebraVault = (await ethers.getContractAt("AlgebraVault", algebraVaultAddress)) as AlgebraVault;

    await expect(tx)
      .to.emit(algebraVaultFactory, "AlgebraVaultCreated")
      .withArgs(wallet.address, algebraVault.address, token0.address, true, token1.address, false, 1);
    poolAddress = await algebraVault.pool();
    await expect(tx)
      .to.emit(algebraVault, "DeployAlgebraVault")
      .withArgs(algebraVaultFactory.address, poolAddress, true, false, wallet.address, 3600);

    await algebraVault.connect(wallet).setDepositMax(ethers.utils.parseEther("100000"), ethers.utils.parseEther("100000"));

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

  it("AlgebraVaultFactory - misc", async () => {
    const msg1 = "AVF.constructor: zero address",
      msg2 = "AVF.setFeeRecipient: zero address",
      msg3 = "AVF.setBaseFee: fees must be <= 10**18",
      msg4 = "AVF.setAmmFee: fees must be <= 10**18",
      msg5 = "AVF.setBaseFeeSplit: must be <= 10**18";

    const uV3MathFactory = await ethers.getContractFactory("UV3Math");
    const uV3Math = (await uV3MathFactory.deploy()) as UV3Math;

    const algebraVaultDeployer = await ethers.getContractFactory("AlgebraVaultDeployer", {
      libraries: {
        UV3Math: uV3Math.address,
      },
    });
    //const libAlgebraVaultDeployer = (await algebraVaultDeployer.deploy()) as AlgebraVaultDeployer
    const libAlgebraVaultDeployer = await algebraVaultDeployer.deploy();

    const algebraVaultFactoryFactory = await ethers.getContractFactory("AlgebraVaultFactory", {
      libraries: {
        AlgebraVaultDeployer: libAlgebraVaultDeployer.address,
      },
    });

    await expect(algebraVaultFactoryFactory.deploy(NULL_ADDRESS, NULL_ADDRESS, "VEL")).to.be.revertedWith(msg1);

    await expect(algebraVaultFactory.connect(wallet).setFeeRecipient(NULL_ADDRESS)).to.be.revertedWith(msg2);
    await expect(algebraVaultFactory.connect(wallet).setBaseFee(PERCENT_101)).to.be.revertedWith(msg3);
    await expect(algebraVaultFactory.connect(wallet).setAmmFee(PERCENT_101)).to.be.revertedWith(msg4);
    await expect(algebraVaultFactory.connect(wallet).setBaseFeeSplit(PERCENT_101)).to.be.revertedWith(msg5);
    await algebraVaultFactory.connect(wallet).setAmmFee(PERCENT_10);
    await algebraVaultFactory.connect(wallet).setAmmFee(0);

    await expect(algebraVaultFactory.connect(wallet).setAmmFee(PERCENT_81)).to.be.revertedWith(msg4);
  });

  it("AlgebraVaultFactory - createAlgebraVault", async () => {
    const msg1 = "AVF.createAlgebraVault: identical tokens",
      msg2 = "AVF.createAlgebraVault: zero address",
      msg3 = "AVF.createAlgebraVault: no allowed tokens",
      msg4 = "AVF.createAlgebraVault: vault exists",
      msg6 = "AVF.createAlgebraVault: pool must exist";

    await expect(
      algebraVaultFactory.connect(wallet).createAlgebraVault(token0.address, true, token0.address, false),
    ).to.be.revertedWith(msg1);
    await expect(
      algebraVaultFactory.connect(wallet).createAlgebraVault(NULL_ADDRESS, true, token1.address, false),
    ).to.be.revertedWith(msg2);
    await expect(
      algebraVaultFactory.connect(wallet).createAlgebraVault(token0.address, true, NULL_ADDRESS, false),
    ).to.be.revertedWith(msg2);
    await expect(
      algebraVaultFactory.connect(wallet).createAlgebraVault(token0.address, false, token1.address, false),
    ).to.be.revertedWith(msg3);
    await expect(
      algebraVaultFactory.connect(wallet).createAlgebraVault(token0.address, true, token1.address, false),
    ).to.be.revertedWith(msg4);
    await expect(
      algebraVaultFactory.connect(wallet).createAlgebraVault(token0.address, true, token2.address, false),
    ).to.be.revertedWith(msg6);

    await factory.createPool(token0.address, token2.address, '0x');
    const poolAddress = await factory.poolByPair(token0.address, token2.address);
    uniswapPool = (await ethers.getContractAt("IAlgebraPool", poolAddress)) as IAlgebraPool;
    await uniswapPool.initialize(encodePriceSqrt("1", "1"));

    await algebraVaultFactory.connect(wallet).createAlgebraVault(token0.address, true, token2.address, false);
  });

  function msg(text: string) {
    return "VM Exception while processing transaction: reverted with reason string '" + text + "'";
  }

  it("AlgebraVault - manual calls", async () => {
    const msg1 = "AV.constructor: zero address";

    const uV3MathFactory = await ethers.getContractFactory("UV3Math");
    const uV3Math = (await uV3MathFactory.deploy()) as UV3Math;

    const algebraVaultFactory = await ethers.getContractFactory("AlgebraVault", {
      libraries: {
        UV3Math: uV3Math.address,
      },
    });

    // const algebraVaultFactory = await ethers.getContractFactory('AlgebraVault')
    await expect(algebraVaultFactory.deploy(NULL_ADDRESS, true, true, wallet.address, 3600, 1)).to.be.reverted;

    //await expect(algebraVault.algebraMintCallback(1, 1, [])).to.be.reverted;
    await expect(algebraVault.algebraSwapCallback(1, 1, [])).to.be.reverted;
  });

  it("AlgebraVault - disconnected plugin", async () => {
    const msg1 = "AV.checkHysteresis: diconnected plugin",
          msg2 = "AV.deposit: to";

    let poolAddress = await factory.poolByPair(token0.address, token1.address);
    let uniswapPool = (await ethers.getContractAt("IAlgebraPool", poolAddress)) as IAlgebraPool;

    await algebraVaultFactory.connect(wallet).createAlgebraVault(token0.address, true, token1.address, false);

    const pluginAddress = await pluginFactory.pluginByPool(uniswapPool.address);
    //console.log("default plugin: " + pluginAddress);

    // plugin isn't connected yet
    await uniswapPool.setPlugin(NULL_ADDRESS);
    await expect(
        algebraVault.deposit(ethers.utils.parseEther("4000"), ethers.utils.parseEther("4000"), alice.address),
      ).to.be.revertedWith(msg1);

    // connect plugin here
    await uniswapPool.setPlugin(pluginAddress);

    //check 'to' address
    await expect(
      algebraVault.connect(alice).deposit(ethers.utils.parseEther("4000"), ethers.utils.parseEther("4000"), NULL_ADDRESS),
    ).to.be.revertedWith(msg2);
  });

  it("AlgebraVault - deposit", async () => {
    const msg1 = "AV.deposit: token0 not allowed",
      msg2 = "AV.deposit: token1 not allowed",
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

    await factory.createPool(token0.address, token2.address, '0x');
    poolAddress = await factory.poolByPair(token0.address, token2.address);
    uniswapPool = (await ethers.getContractAt("IAlgebraPool", poolAddress)) as IAlgebraPool;
    await uniswapPool.initialize(encodePriceSqrt("1", "1"));

    await algebraVaultFactory.connect(wallet).createAlgebraVault(token0.address, true, token1.address, false);
    await algebraVaultFactory.connect(wallet).createAlgebraVault(token0.address, false, token2.address, true);

    // check allowToken policy
    let vaultKey = await algebraVaultFactory.genKey(wallet.address, token0.address, token1.address, true, false);
    let algebraVaultAddress = await algebraVaultFactory.getAlgebraVault(vaultKey);
    algebraVault = (await ethers.getContractAt("AlgebraVault", algebraVaultAddress)) as AlgebraVault;

    await expect(
      algebraVault.deposit(smallTokenAmount, ethers.utils.parseEther("4000"), alice.address),
    ).to.be.revertedWith(msg2);

    vaultKey = await algebraVaultFactory.genKey(wallet.address, token0.address, token2.address, false, true);
    algebraVaultAddress = await algebraVaultFactory.getAlgebraVault(vaultKey);
    algebraVault = (await ethers.getContractAt("AlgebraVault", algebraVaultAddress)) as AlgebraVault;

    await expect(
      algebraVault.deposit(smallTokenAmount, ethers.utils.parseEther("4000"), alice.address),
    ).to.be.revertedWith(msg1);

    // check deposit values
    vaultKey = await algebraVaultFactory.genKey(wallet.address, token0.address, token1.address, true, false);
    algebraVaultAddress = await algebraVaultFactory.getAlgebraVault(vaultKey);
    algebraVault = (await ethers.getContractAt("AlgebraVault", algebraVaultAddress)) as AlgebraVault;
    await expect(algebraVault.deposit(0, 0, alice.address)).to.be.revertedWith(msg3);

    vaultKey = await algebraVaultFactory.genKey(wallet.address, token0.address, token2.address, false, true);
    algebraVaultAddress = await algebraVaultFactory.getAlgebraVault(vaultKey);
    algebraVault = (await ethers.getContractAt("AlgebraVault", algebraVaultAddress)) as AlgebraVault;
    await expect(algebraVault.deposit(0, 0, alice.address)).to.be.revertedWith(msg3);

    // check against max deposit amounts
    vaultKey = await algebraVaultFactory.genKey(wallet.address, token0.address, token1.address, true, false);
    algebraVaultAddress = await algebraVaultFactory.getAlgebraVault(vaultKey);
    algebraVault = (await ethers.getContractAt("AlgebraVault", algebraVaultAddress)) as AlgebraVault;
    await expect(
      algebraVault.deposit(ethers.utils.parseEther("200000"), ethers.utils.parseEther("4000"), alice.address),
    ).to.be.revertedWith(msg4);
    await expect(
      algebraVault.deposit(ethers.utils.parseEther("4000"), ethers.utils.parseEther("200000"), alice.address),
    ).to.be.revertedWith(msg4);

    // alice approves the AlgebraVault to transfer her tokens
    await token0.connect(alice).approve(algebraVault.address, largeTokenAmount);
    await token1.connect(alice).approve(algebraVault.address, largeTokenAmount);
    // mint tokens to alice
    await token0.mint(alice.address, largeTokenAmount);
    await token1.mint(alice.address, largeTokenAmount);

    //check 'to' address
    await expect(
      algebraVault.connect(alice).deposit(ethers.utils.parseEther("4000"), ethers.utils.parseEther("4000"), NULL_ADDRESS),
    ).to.be.revertedWith(msg5);
    await expect(
      algebraVault
        .connect(alice)
        .deposit(ethers.utils.parseEther("4000"), ethers.utils.parseEther("4000"), algebraVaultAddress),
    ).to.be.revertedWith(msg5);
  });

  it("AlgebraVault - withdraw", async () => {
    const msg1 = "AV.withdraw: to",
      msg2 = "AV.withdraw: shares";

    // alice approves the AlgebraVault to transfer her tokens
    await token0.connect(alice).approve(algebraVault.address, largeTokenAmount);
    await token1.connect(alice).approve(algebraVault.address, largeTokenAmount);
    // mint tokens to alice
    await token0.mint(alice.address, largeTokenAmount);
    await token1.mint(alice.address, largeTokenAmount);

    await algebraVault
      .connect(alice)
      .deposit(ethers.utils.parseEther("4000"), ethers.utils.parseEther("4000"), alice.address);

    //check 'to' address
    await expect(algebraVault.connect(alice).withdraw(ethers.utils.parseEther("4000"), NULL_ADDRESS)).to.be.revertedWith(
      msg1,
    );
    //check shares
    await expect(algebraVault.connect(alice).withdraw(0, alice.address)).to.be.revertedWith(msg2);
  });

  it("AlgebraVault - rebalance", async () => {
    const msg1 = "AV.rebalance: base position invalid",
      msg3 = "AV.rebalance: identical positions",
      msg2 = "AV.rebalance: limit position invalid";

    // alice approves the AlgebraVault to transfer her tokens
    await token0.connect(alice).approve(algebraVault.address, largeTokenAmount);
    await token1.connect(alice).approve(algebraVault.address, largeTokenAmount);
    // mint tokens to alice
    await token0.mint(alice.address, largeTokenAmount);
    await token1.mint(alice.address, largeTokenAmount);

    const tickSpacing = await algebraVault.tickSpacing();
    //console.log(tickSpacing.toString());
    const fee = await algebraVault.fee();
    //console.log(fee.toString());

    await algebraVault
      .connect(alice)
      .deposit(ethers.utils.parseEther("4000"), ethers.utils.parseEther("4000"), alice.address);

    await expect(algebraVault.connect(wallet).rebalance(-1800, -1200, -1800, -1200, 0)).to.be.revertedWith(msg3);
    await expect(algebraVault.connect(wallet).rebalance(1800, 1200, 60, 600, 0)).to.be.revertedWith(msg1);
    await expect(algebraVault.connect(wallet).rebalance(-1800, -1200, -180, -600, 0)).to.be.revertedWith(msg2);

    //let afee = await algebraVaultFactory.connect(wallet).ammFee()
    //let bfee = await algebraVaultFactory.connect(wallet).baseFee()
    //console.log(afee.toString());
    //console.log(bfee.toString());

    await algebraVault.connect(wallet).rebalance(-1800, -1200, 180, 600, 0);
    const balance0 = await token0.balanceOf(algebraVault.address);
    const balance1 = await token1.balanceOf(algebraVault.address);
    expect(balance0).to.be.equal(0);
    expect(balance1).to.be.equal(0);

    const rebalanceSwapAmount = ethers.utils.parseEther("4000");
    await expect(algebraVault.connect(wallet).rebalance(1800, 1000, 50, 550, rebalanceSwapAmount)).to.be.revertedWith(
      msg1,
    );
    await expect(algebraVault.connect(wallet).rebalance(-1800, 1000, 50, 550, rebalanceSwapAmount)).to.be.revertedWith(
      msg1,
    );
    await expect(algebraVault.connect(wallet).rebalance(-1000, 1800, 50, 550, rebalanceSwapAmount)).to.be.revertedWith(
      msg1,
    );

    await expect(algebraVault.connect(wallet).rebalance(-1800, 1200, -50, -550, rebalanceSwapAmount)).to.be.revertedWith(
      msg2,
    );
    await expect(algebraVault.connect(wallet).rebalance(-1800, 1200, -600, -500, rebalanceSwapAmount)).to.be.revertedWith(
      msg2,
    );
    await expect(algebraVault.connect(wallet).rebalance(-1800, 1200, -600, -550, rebalanceSwapAmount)).to.be.revertedWith(
      msg2,
    );
  });

  it("AlgebraVault - setTwapPeriod", async () => {
    const msg1 = "AV.setTwapPeriod: missing period";

    await expect(algebraVault.connect(wallet).setTwapPeriod(0)).to.be.revertedWith(msg1);

    await expect(algebraVault.connect(wallet).setTwapPeriod(1800))
      .to.emit(algebraVault, "SetTwapPeriod")
      .withArgs(wallet.address, 1800);
  });

  it("AlgebraVault - setHysteresis", async () => {
    await expect(algebraVault.connect(wallet).setHysteresis(50)) // 5%
      .to.emit(algebraVault, "Hysteresis")
      .withArgs(wallet.address, 50);
  });

  it("AlgebraVault - setAmmFeeRecipient", async () => {
    await expect(algebraVault.connect(wallet).setAmmFeeRecipient(NULL_ADDRESS))
      .to.emit(algebraVault, "AmmFeeRecipient")
      .withArgs(wallet.address, NULL_ADDRESS);
  });

  it("AlgebraVault - symbol", async () => {
    const tx = await algebraVaultFactory.connect(wallet).createAlgebraVault(token0.address, false, token1.address, true);

    let algebraVaultAddress = await algebraVaultFactory.allVaults(0);
    algebraVault = (await ethers.getContractAt("AlgebraVault", algebraVaultAddress)) as AlgebraVault;

    let symbol = await algebraVault.symbol();
    expect(symbol).to.equal("AV-VEL-0-symbol-symbol");

    algebraVaultAddress = await algebraVaultFactory.allVaults(1);
    algebraVault = (await ethers.getContractAt("AlgebraVault", algebraVaultAddress)) as AlgebraVault;

    symbol = await algebraVault.symbol();
    expect(symbol).to.equal("AV-VEL-1-symbol-symbol");
  });
});

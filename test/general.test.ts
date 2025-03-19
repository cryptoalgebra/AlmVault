import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network } from "hardhat";

import { IAlgebraFactory, IBasePluginV1Factory, INonfungiblePositionManager, ISwapRouter } from "../types";
import { IAlgebraPool } from "../types/@cryptoalgebra/integral-core/contracts/interfaces/IAlgebraPool";
import { ICHIVault } from "../types/contracts/ICHIVault";
import { ICHIVaultFactory } from "../types/contracts/ICHIVaultFactory";
import { UV3Math } from "../types/contracts/lib/UV3Math";
import { TestERC20 } from "../types/contracts/mocks/TestERC20";
import { TestOracle } from "../types/contracts/mocks/TestOracle";
import { ichiVaultTestFixture } from "./shared/fixtures";
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
  let ichiVaultFactory: ICHIVaultFactory;
  let ichiVault: ICHIVault;
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
    ({ token0, token1, token2, factory, router, nft, pluginFactory, oracle, ichiVaultFactory } = await loadFixture(
      ichiVaultTestFixture,
    ));
    await factory.createPool(token0.address, token1.address);
    const poolAddress = await factory.poolByPair(token0.address, token1.address);
    // console.log(poolAddress);
    uniswapPool = (await ethers.getContractAt("IAlgebraPool", poolAddress)) as IAlgebraPool;
    await uniswapPool.initialize(encodePriceSqrt("1", "1"));

    await ichiVaultFactory.connect(wallet).createICHIVault(token0.address, true, token1.address, true);

    const ichiVaultAddress = await ichiVaultFactory.allVaults(0);
    ichiVault = (await ethers.getContractAt("ICHIVault", ichiVaultAddress)) as ICHIVault;

    await expect(
      ichiVault.connect(wallet).setDepositMax(ethers.utils.parseEther("100000"), ethers.utils.parseEther("100000")),
    )
      .to.emit(ichiVault, "DepositMax")
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

  it("ICHIVault", async () => {
    const msg1 = "Ownable: caller is not the owner";

    await expect(ichiVault.connect(alice).rebalance(-1800, 1800, -600, 0, 0)).to.be.revertedWith(msg1);
    await expect(
      ichiVault.connect(alice).setDepositMax(ethers.utils.parseEther("100000"), ethers.utils.parseEther("100000")),
    ).to.be.revertedWith(msg1);
    await expect(ichiVault.connect(alice).setHysteresis(50)) // 5%
      .to.be.revertedWith(msg1);
    await expect(ichiVault.connect(alice).setTwapPeriod(1800)).to.be.revertedWith(msg1);
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
  let ichiVaultFactory: ICHIVaultFactory;
  let ichiVault: ICHIVault;
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
    ({ token0, token1, token2, factory, router, nft, pluginFactory, oracle, ichiVaultFactory } = await loadFixture(
      ichiVaultTestFixture,
    ));

    await factory.createPool(token0.address, token1.address);
    let poolAddress = await factory.poolByPair(token0.address, token1.address);
    uniswapPool = (await ethers.getContractAt("IAlgebraPool", poolAddress)) as IAlgebraPool;
    await uniswapPool.initialize(encodePriceSqrt("1", "1"));

    const tx = await ichiVaultFactory.connect(wallet).createICHIVault(token0.address, true, token1.address, true);

    const ichiVaultAddress = await ichiVaultFactory.allVaults(0);
    ichiVault = (await ethers.getContractAt("ICHIVault", ichiVaultAddress)) as ICHIVault;

    await expect(tx)
      .to.emit(ichiVaultFactory, "ICHIVaultCreated")
      .withArgs(wallet.address, ichiVault.address, token0.address, true, token1.address, true, 1);
    poolAddress = await ichiVault.pool();
    await expect(tx)
      .to.emit(ichiVault, "DeployICHIVault")
      .withArgs(ichiVaultFactory.address, poolAddress, true, true, wallet.address, 3600);

    await ichiVault.connect(wallet).setDepositMax(ethers.utils.parseEther("100000"), ethers.utils.parseEther("100000"));

    // adding extra liquidity into pool to make sure there's always
    // someone to swap with
    await token0.mint(carol.address, giantTokenAmount);
    await token1.mint(carol.address, giantTokenAmount);

    await token0.connect(carol).approve(nft.address, veryLargeTokenAmount);
    await token1.connect(carol).approve(nft.address, veryLargeTokenAmount);

    await nft.connect(carol).mint({
      token0: token0.address,
      token1: token1.address,
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

  it("ICHIVaultFactory - misc", async () => {
    const msg1 = "IVF.constructor: zero address",
      msg2 = "IVF.setFeeRecipient: zero address",
      msg3 = "IVF.setBaseFee: fees must be <= 10**18",
      msg4 = "IVF.setAmmFee: fees must be <= 10**18",
      msg5 = "IVF.setBaseFeeSplit: must be <= 10**18";

    const uV3MathFactory = await ethers.getContractFactory("UV3Math");
    const uV3Math = (await uV3MathFactory.deploy()) as UV3Math;

    const ichiVaultDeployer = await ethers.getContractFactory("ICHIVaultDeployer", {
      libraries: {
        UV3Math: uV3Math.address,
      },
    });
    //const libICHIVaultDeployer = (await ichiVaultDeployer.deploy()) as ICHIVaultDeployer
    const libICHIVaultDeployer = await ichiVaultDeployer.deploy();

    const ichiVaultFactoryFactory = await ethers.getContractFactory("ICHIVaultFactory", {
      libraries: {
        ICHIVaultDeployer: libICHIVaultDeployer.address,
      },
    });

    await expect(ichiVaultFactoryFactory.deploy(NULL_ADDRESS, NULL_ADDRESS, "VEL")).to.be.revertedWith(msg1);

    await expect(ichiVaultFactory.connect(wallet).setFeeRecipient(NULL_ADDRESS)).to.be.revertedWith(msg2);
    await expect(ichiVaultFactory.connect(wallet).setBaseFee(PERCENT_101)).to.be.revertedWith(msg3);
    await expect(ichiVaultFactory.connect(wallet).setAmmFee(PERCENT_101)).to.be.revertedWith(msg4);
    await expect(ichiVaultFactory.connect(wallet).setBaseFeeSplit(PERCENT_101)).to.be.revertedWith(msg5);
    await ichiVaultFactory.connect(wallet).setAmmFee(PERCENT_10);
    await ichiVaultFactory.connect(wallet).setAmmFee(0);

    await expect(ichiVaultFactory.connect(wallet).setAmmFee(PERCENT_81)).to.be.revertedWith(msg4);
  });

  it("ICHIVaultFactory - createIchiVault", async () => {
    const msg1 = "IVF.createICHIVault: identical tokens",
      msg2 = "IVF.createICHIVault: zero address",
      msg3 = "IVF.createICHIVault: no allowed tokens",
      msg4 = "IVF.createICHIVault: vault exists",
      msg6 = "IVF.createICHIVault: pool must exist";

    await expect(
      ichiVaultFactory.connect(wallet).createICHIVault(token0.address, true, token0.address, true),
    ).to.be.revertedWith(msg1);
    await expect(
      ichiVaultFactory.connect(wallet).createICHIVault(NULL_ADDRESS, true, token1.address, true),
    ).to.be.revertedWith(msg2);
    await expect(
      ichiVaultFactory.connect(wallet).createICHIVault(token0.address, true, NULL_ADDRESS, true),
    ).to.be.revertedWith(msg2);
    await expect(
      ichiVaultFactory.connect(wallet).createICHIVault(token0.address, false, token1.address, false),
    ).to.be.revertedWith(msg3);
    await expect(
      ichiVaultFactory.connect(wallet).createICHIVault(token0.address, true, token1.address, true),
    ).to.be.revertedWith(msg4);
    await expect(
      ichiVaultFactory.connect(wallet).createICHIVault(token0.address, true, token2.address, true),
    ).to.be.revertedWith(msg6);

    await factory.createPool(token0.address, token2.address);
    const poolAddress = await factory.poolByPair(token0.address, token2.address);
    uniswapPool = (await ethers.getContractAt("IAlgebraPool", poolAddress)) as IAlgebraPool;
    await uniswapPool.initialize(encodePriceSqrt("1", "1"));

    await ichiVaultFactory.connect(wallet).createICHIVault(token0.address, true, token2.address, true);
  });

  function msg(text: string) {
    return "VM Exception while processing transaction: reverted with reason string '" + text + "'";
  }

  it("ICHIVault - manual calls", async () => {
    const msg1 = "IV.constructor: zero address";

    const uV3MathFactory = await ethers.getContractFactory("UV3Math");
    const uV3Math = (await uV3MathFactory.deploy()) as UV3Math;

    const ichiVaultFactory = await ethers.getContractFactory("ICHIVault", {
      libraries: {
        UV3Math: uV3Math.address,
      },
    });

    // const ichiVaultFactory = await ethers.getContractFactory('ICHIVault')
    await expect(ichiVaultFactory.deploy(NULL_ADDRESS, true, true, wallet.address, 3600, 1)).to.be.reverted;

    await expect(ichiVault.algebraMintCallback(1, 1, [])).to.be.reverted;
    await expect(ichiVault.algebraSwapCallback(1, 1, [])).to.be.reverted;
  });

  it("ICHIVault - disconnected plugin", async () => {
    const msg1 = "IV.checkHysteresis: diconnected plugin",
          msg2 = "IV.deposit: to";

    let poolAddress = await factory.poolByPair(token0.address, token1.address);
    let uniswapPool = (await ethers.getContractAt("IAlgebraPool", poolAddress)) as IAlgebraPool;

    await ichiVaultFactory.connect(wallet).createICHIVault(token0.address, true, token1.address, false);

    const pluginAddress = await pluginFactory.pluginByPool(uniswapPool.address);
    //console.log("default plugin: " + pluginAddress);

    // plugin isn't connected yet
    await uniswapPool.setPlugin(NULL_ADDRESS);
    await expect(
        ichiVault.deposit(ethers.utils.parseEther("4000"), ethers.utils.parseEther("4000"), alice.address),
      ).to.be.revertedWith(msg1);

    // connect plugin here
    await uniswapPool.setPlugin(pluginAddress);

    //check 'to' address
    await expect(
      ichiVault.connect(alice).deposit(ethers.utils.parseEther("4000"), ethers.utils.parseEther("4000"), NULL_ADDRESS),
    ).to.be.revertedWith(msg2);
  });

  it("ICHIVault - deposit", async () => {
    const msg1 = "IV.deposit: token0 not allowed",
      msg2 = "IV.deposit: token1 not allowed",
      msg3 = "IV.deposit: deposits must be > 0",
      msg4 = "IV.deposit: deposits too large",
      msg5 = "IV.deposit: to",
      msg6 = "IV.deposit: maxTotalSupply";

    // pool already exists and initialized
    //await factory.createPool(token0.address, token1.address)

    let poolAddress = await factory.poolByPair(token0.address, token1.address);
    let uniswapPool = (await ethers.getContractAt("IAlgebraPool", poolAddress)) as IAlgebraPool;
    // pool already exists and initialized
    //await uniswapPool.initialize(encodePriceSqrt('1', '1'))

    await factory.createPool(token0.address, token2.address);
    poolAddress = await factory.poolByPair(token0.address, token2.address);
    uniswapPool = (await ethers.getContractAt("IAlgebraPool", poolAddress)) as IAlgebraPool;
    await uniswapPool.initialize(encodePriceSqrt("1", "1"));

    await ichiVaultFactory.connect(wallet).createICHIVault(token0.address, true, token1.address, false);
    await ichiVaultFactory.connect(wallet).createICHIVault(token0.address, false, token2.address, true);

    // check allowToken policy
    let vaultKey = await ichiVaultFactory.genKey(wallet.address, token0.address, token1.address, true, false);
    let ichiVaultAddress = await ichiVaultFactory.getICHIVault(vaultKey);
    ichiVault = (await ethers.getContractAt("ICHIVault", ichiVaultAddress)) as ICHIVault;

    await expect(
      ichiVault.deposit(smallTokenAmount, ethers.utils.parseEther("4000"), alice.address),
    ).to.be.revertedWith(msg2);

    vaultKey = await ichiVaultFactory.genKey(wallet.address, token0.address, token2.address, false, true);
    ichiVaultAddress = await ichiVaultFactory.getICHIVault(vaultKey);
    ichiVault = (await ethers.getContractAt("ICHIVault", ichiVaultAddress)) as ICHIVault;

    await expect(
      ichiVault.deposit(smallTokenAmount, ethers.utils.parseEther("4000"), alice.address),
    ).to.be.revertedWith(msg1);

    // check deposit values
    vaultKey = await ichiVaultFactory.genKey(wallet.address, token0.address, token1.address, true, false);
    ichiVaultAddress = await ichiVaultFactory.getICHIVault(vaultKey);
    ichiVault = (await ethers.getContractAt("ICHIVault", ichiVaultAddress)) as ICHIVault;
    await expect(ichiVault.deposit(0, 0, alice.address)).to.be.revertedWith(msg3);

    vaultKey = await ichiVaultFactory.genKey(wallet.address, token0.address, token2.address, false, true);
    ichiVaultAddress = await ichiVaultFactory.getICHIVault(vaultKey);
    ichiVault = (await ethers.getContractAt("ICHIVault", ichiVaultAddress)) as ICHIVault;
    await expect(ichiVault.deposit(0, 0, alice.address)).to.be.revertedWith(msg3);

    // check against max deposit amounts
    vaultKey = await ichiVaultFactory.genKey(wallet.address, token0.address, token1.address, true, true);
    ichiVaultAddress = await ichiVaultFactory.getICHIVault(vaultKey);
    ichiVault = (await ethers.getContractAt("ICHIVault", ichiVaultAddress)) as ICHIVault;
    await expect(
      ichiVault.deposit(ethers.utils.parseEther("200000"), ethers.utils.parseEther("4000"), alice.address),
    ).to.be.revertedWith(msg4);
    await expect(
      ichiVault.deposit(ethers.utils.parseEther("4000"), ethers.utils.parseEther("200000"), alice.address),
    ).to.be.revertedWith(msg4);

    // alice approves the ICHIVault to transfer her tokens
    await token0.connect(alice).approve(ichiVault.address, largeTokenAmount);
    await token1.connect(alice).approve(ichiVault.address, largeTokenAmount);
    // mint tokens to alice
    await token0.mint(alice.address, largeTokenAmount);
    await token1.mint(alice.address, largeTokenAmount);

    //check 'to' address
    await expect(
      ichiVault.connect(alice).deposit(ethers.utils.parseEther("4000"), ethers.utils.parseEther("4000"), NULL_ADDRESS),
    ).to.be.revertedWith(msg5);
    await expect(
      ichiVault
        .connect(alice)
        .deposit(ethers.utils.parseEther("4000"), ethers.utils.parseEther("4000"), ichiVaultAddress),
    ).to.be.revertedWith(msg5);
  });

  it("ICHIVault - withdraw", async () => {
    const msg1 = "IV.withdraw: to",
      msg2 = "IV.withdraw: shares";

    // alice approves the ICHIVault to transfer her tokens
    await token0.connect(alice).approve(ichiVault.address, largeTokenAmount);
    await token1.connect(alice).approve(ichiVault.address, largeTokenAmount);
    // mint tokens to alice
    await token0.mint(alice.address, largeTokenAmount);
    await token1.mint(alice.address, largeTokenAmount);

    await ichiVault
      .connect(alice)
      .deposit(ethers.utils.parseEther("4000"), ethers.utils.parseEther("4000"), alice.address);

    //check 'to' address
    await expect(ichiVault.connect(alice).withdraw(ethers.utils.parseEther("4000"), NULL_ADDRESS)).to.be.revertedWith(
      msg1,
    );
    //check shares
    await expect(ichiVault.connect(alice).withdraw(0, alice.address)).to.be.revertedWith(msg2);
  });

  it("ICHIVault - rebalance", async () => {
    const msg1 = "IV.rebalance: base position invalid",
      msg3 = "IV.rebalance: identical positions",
      msg2 = "IV.rebalance: limit position invalid";

    // alice approves the ICHIVault to transfer her tokens
    await token0.connect(alice).approve(ichiVault.address, largeTokenAmount);
    await token1.connect(alice).approve(ichiVault.address, largeTokenAmount);
    // mint tokens to alice
    await token0.mint(alice.address, largeTokenAmount);
    await token1.mint(alice.address, largeTokenAmount);

    const tickSpacing = await ichiVault.tickSpacing();
    //console.log(tickSpacing.toString());
    const fee = await ichiVault.fee();
    //console.log(fee.toString());

    await ichiVault
      .connect(alice)
      .deposit(ethers.utils.parseEther("4000"), ethers.utils.parseEther("4000"), alice.address);

    await expect(ichiVault.connect(wallet).rebalance(-1800, -1200, -1800, -1200, 0)).to.be.revertedWith(msg3);
    await expect(ichiVault.connect(wallet).rebalance(1800, 1200, 60, 600, 0)).to.be.revertedWith(msg1);
    await expect(ichiVault.connect(wallet).rebalance(-1800, -1200, -180, -600, 0)).to.be.revertedWith(msg2);

    //let afee = await ichiVaultFactory.connect(wallet).ammFee()
    //let bfee = await ichiVaultFactory.connect(wallet).baseFee()
    //console.log(afee.toString());
    //console.log(bfee.toString());

    await ichiVault.connect(wallet).rebalance(-1800, -1200, 180, 600, 0);
    const balance0 = await token0.balanceOf(ichiVault.address);
    const balance1 = await token1.balanceOf(ichiVault.address);
    expect(balance0).to.be.equal(0);
    expect(balance1).to.be.equal(0);

    const rebalanceSwapAmount = ethers.utils.parseEther("4000");
    await expect(ichiVault.connect(wallet).rebalance(1800, 1000, 50, 550, rebalanceSwapAmount)).to.be.revertedWith(
      msg1,
    );
    await expect(ichiVault.connect(wallet).rebalance(-1800, 1000, 50, 550, rebalanceSwapAmount)).to.be.revertedWith(
      msg1,
    );
    await expect(ichiVault.connect(wallet).rebalance(-1000, 1800, 50, 550, rebalanceSwapAmount)).to.be.revertedWith(
      msg1,
    );

    await expect(ichiVault.connect(wallet).rebalance(-1800, 1200, -50, -550, rebalanceSwapAmount)).to.be.revertedWith(
      msg2,
    );
    await expect(ichiVault.connect(wallet).rebalance(-1800, 1200, -600, -500, rebalanceSwapAmount)).to.be.revertedWith(
      msg2,
    );
    await expect(ichiVault.connect(wallet).rebalance(-1800, 1200, -600, -550, rebalanceSwapAmount)).to.be.revertedWith(
      msg2,
    );
  });

  it("ICHIVault - setTwapPeriod", async () => {
    const msg1 = "IV.setTwapPeriod: missing period";

    await expect(ichiVault.connect(wallet).setTwapPeriod(0)).to.be.revertedWith(msg1);

    await expect(ichiVault.connect(wallet).setTwapPeriod(1800))
      .to.emit(ichiVault, "SetTwapPeriod")
      .withArgs(wallet.address, 1800);
  });

  it("ICHIVault - setHysteresis", async () => {
    await expect(ichiVault.connect(wallet).setHysteresis(50)) // 5%
      .to.emit(ichiVault, "Hysteresis")
      .withArgs(wallet.address, 50);
  });

  it("ICHIVault - setAmmFeeRecipient", async () => {
    await expect(ichiVault.connect(wallet).setAmmFeeRecipient(NULL_ADDRESS))
      .to.emit(ichiVault, "AmmFeeRecipient")
      .withArgs(wallet.address, NULL_ADDRESS);
  });

  it("ICHIVault - symbol", async () => {
    const tx = await ichiVaultFactory.connect(wallet).createICHIVault(token0.address, false, token1.address, true);

    let ichiVaultAddress = await ichiVaultFactory.allVaults(0);
    ichiVault = (await ethers.getContractAt("ICHIVault", ichiVaultAddress)) as ICHIVault;

    let symbol = await ichiVault.symbol();
    expect(symbol).to.equal("IV-VEL-0-symbol-symbol");

    ichiVaultAddress = await ichiVaultFactory.allVaults(1);
    ichiVault = (await ethers.getContractAt("ICHIVault", ichiVaultAddress)) as ICHIVault;

    symbol = await ichiVault.symbol();
    expect(symbol).to.equal("IV-VEL-1-symbol-symbol");
  });
});

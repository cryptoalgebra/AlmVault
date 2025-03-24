import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network } from "hardhat";

import {
  IAlgebraFactory,
  IAlgebraPool,
  AlgebraVault,
  AlgebraVaultFactory,
  INonfungiblePositionManager,
  ISwapRouter,
  TestERC20,
  TestOracle,
} from "../types";
import { algebraVaultTestFixture } from "./shared/fixtures";
import { FeeAmount, TICK_SPACINGS, encodePriceSqrt, getMaxTick, getMinTick } from "./shared/utilities";

const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";
const PERCENT_100 = "1000000000000000000";
const PERCENT_50 = "500000000000000000";
const PERCENT_40 = "400000000000000000";
const PERCENT_20 = "200000000000000000";
const PERCENT_10 = "100000000000000000";

const MIN_SHARES = 1000;

const smallTokenAmount = ethers.utils.parseEther("1000");
const largeTokenAmount = ethers.utils.parseEther("1000000");
const veryLargeTokenAmount = ethers.utils.parseEther("10000000000");
const giantTokenAmount = ethers.utils.parseEther("1000000000000");

describe("AlgebraVault General Functionality", () => {
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

  let factory: IAlgebraFactory;
  let router: ISwapRouter;
  let nft: INonfungiblePositionManager;
  let oracle: TestOracle;
  let token0: TestERC20;
  let token1: TestERC20;
  let token2: TestERC20;
  let algebraPool: IAlgebraPool;
  let algebraVaultFactory: AlgebraVaultFactory;
  let algebraVault: AlgebraVault;

  before("create fixture loader", async () => {
    [wallet, alice, bob, carol, other, user0, user1, user2, user3, user4] = await ethers.getSigners();
  });

  beforeEach("deploy contracts", async () => {
    ({ token0, token1, token2, factory, router, nft, oracle, algebraVaultFactory } = await loadFixture(
      algebraVaultTestFixture,
    ));
    // console.log("AlgebraVault Factory " + algebraVaultFactory.address);
    // console.log("AlgebraVault factory owner " + await algebraVaultFactory.owner());
    // console.log("wallet used to create new AlgebraVaults " + wallet.address);
    await algebraVaultFactory.connect(wallet).setFeeRecipient(other.address);

    await factory.createPool(token0.address, token1.address, '0x');
    const poolAddress = await factory.poolByPair(token0.address, token1.address);
    algebraPool = (await ethers.getContractAt("IAlgebraPool", poolAddress)) as IAlgebraPool;
    await algebraPool.initialize(encodePriceSqrt("1", "1"));

    await algebraVaultFactory.connect(wallet).createAlgebraVault(token0.address, true, token1.address, false);

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

    const vaultKey = await algebraVaultFactory.genKey(wallet.address, token0.address, token1.address, true, false);
    const algebraVaultAddress = await algebraVaultFactory.getAlgebraVault(vaultKey);
    algebraVault = (await ethers.getContractAt("AlgebraVault", algebraVaultAddress)) as AlgebraVault;
    await algebraVault.connect(wallet).setAffiliate(bob.address);
    // console.log("AlgebraVault address " + algebraVault.address);

    //let state = await algebraPool.globalState()
    //console.log(state)

    await algebraVault.connect(wallet).setDepositMax(ethers.utils.parseEther("100000"), ethers.utils.parseEther("100000"));
  });

  function msg(text: string) {
    return "VM Exception while processing transaction: reverted with reason string '" + text + "'";
  }

  it("multiple deposits and total withdrawal", async () => {
    const msg1 = "allowance insufficient",
      msg2 = "underflow balance sender",
      msg3 = "AV.withdraw: min shares";

    await expect(
      algebraVault.connect(alice).deposit(ethers.utils.parseEther("4000"), ethers.utils.parseEther("4000"), alice.address),
    ).to.be.revertedWith(msg1);

    // alice approves the AlgebraVault to transfer her tokens
    await token0.connect(alice).approve(algebraVault.address, largeTokenAmount);
    await token1.connect(alice).approve(algebraVault.address, largeTokenAmount);

    await expect(
      algebraVault.connect(alice).deposit(ethers.utils.parseEther("4000"), ethers.utils.parseEther("4000"), alice.address),
    ).to.be.revertedWith(msg2);

    // mint tokens to alice
    await token0.mint(alice.address, largeTokenAmount);
    await token1.mint(alice.address, largeTokenAmount);

    // alice should start with 0 AlgebraVault tokens
    let alice_liq_balance = await algebraVault.balanceOf(alice.address);
    expect(alice_liq_balance).to.equal(0);

    // expect that alice's deposits which exceed the deposit maximums to be reverted
    await expect(algebraVault.connect(alice).deposit(ethers.utils.parseEther("100000"), 0, alice.address)).to.be.reverted;
    await expect(algebraVault.connect(alice).deposit(0, ethers.utils.parseEther("200000"), alice.address)).to.be.reverted;
    await expect(
      algebraVault
        .connect(alice)
        .deposit(ethers.utils.parseEther("100000"), ethers.utils.parseEther("100000"), alice.address),
    ).to.be.reverted;

    // expect alice's deposit smaller than deposit maximums to be accepted
    await algebraVault.connect(alice).deposit(smallTokenAmount, smallTokenAmount, alice.address);

    // should fail with insufficient funds message
    await expect(algebraVault.connect(alice).withdraw(ethers.utils.parseEther("40000").mul(MIN_SHARES), alice.address)).to.be.revertedWith(
      msg3,
    );

    let token0vault = await token0.balanceOf(algebraVault.address);
    let token1vault = await token1.balanceOf(algebraVault.address);
    // check that all the tokens alice depostied ended up in the vault
    expect(token0vault).to.equal(smallTokenAmount);
    expect(token1vault).to.equal(smallTokenAmount);

    alice_liq_balance = await algebraVault.balanceOf(alice.address);
    //console.log(alice_liq_balance.toString())
    //let currentTick = await algebraVault.currentTick()
    //console.log(currentTick)

    // check that alice has been awarded liquidity tokens in AlgebraVault equal the
    // quantity of tokens deposited since their price is the same
    expect(alice_liq_balance).to.equal(ethers.utils.parseEther("2000").mul(MIN_SHARES));

    // liquidity positions will only be created once rebalance is called
    await algebraVault.rebalance(-1800, 1800, -600, 0, 0);

    //alice_liq_balance = await algebraVault.balanceOf(alice.address)
    //console.log(alice_liq_balance.toString())
    await expect(algebraVault.connect(alice).withdraw(ethers.utils.parseEther("40000").mul(MIN_SHARES), alice.address)).to.be.reverted;

    token0vault = await token0.balanceOf(algebraVault.address);
    token1vault = await token1.balanceOf(algebraVault.address);
    // all of the vault assets should have been deployed in v3 lp positions
    expect(token0vault).to.equal(0);
    expect(token1vault).to.equal(0);

    //let pos = await algebraVault._position(-1800,1800)
    //console.log(pos);

    let basePosition = await algebraVault.getBasePosition();
    let limitPosition = await algebraVault.getLimitPosition();
    //console.log(basePosition);
    //console.log(limitPosition);
    expect(basePosition[0]).to.be.gt(0);
    expect(limitPosition[0]).to.be.equal(0);

    await algebraVault.connect(alice).deposit(smallTokenAmount, ethers.utils.parseEther("4000"), alice.address);
    token0vault = await token0.balanceOf(algebraVault.address);
    token1vault = await token1.balanceOf(algebraVault.address);
    expect(token0vault).to.equal(smallTokenAmount);
    expect(token1vault).to.equal(ethers.utils.parseEther("4000"));
    alice_liq_balance = await algebraVault.balanceOf(alice.address);

    expect(alice_liq_balance).to.lt(ethers.utils.parseEther("7000").add(15).mul(MIN_SHARES));
    expect(alice_liq_balance).to.gt(ethers.utils.parseEther("7000").sub(15).mul(MIN_SHARES));

    await algebraVault.connect(alice).deposit(ethers.utils.parseEther("2000"), smallTokenAmount, alice.address);

    // do a test swap
    await token0.connect(carol).approve(router.address, veryLargeTokenAmount);
    await token1.connect(carol).approve(router.address, veryLargeTokenAmount);
    await router.connect(carol).exactInputSingle({
      tokenIn: token0.address,
      tokenOut: token1.address,
      recipient: carol.address,
      deadline: 2000000000, // Wed May 18 2033 03:33:20 GMT+0000
      amountIn: largeTokenAmount,
      amountOutMinimum: ethers.utils.parseEther("0"),
      limitSqrtPrice: 0,
    });

    let spot = await oracle.spotPrice(algebraPool.address, token0.address, token1.address);
    let twap = await oracle.twapPrice(algebraVaultFactory.address, algebraPool.address, token0.address, token1.address);
    //console.log("spot = "+spot.toString())
    //console.log("twap = "+twap.toString())

    const limitUpper = -60;
    const limitLower = -540;
    let tokenAmounts = await algebraVault.getTotalAmounts();
    const token0BeforeRebalanceSwap = tokenAmounts[0];
    const token1BeforeRebalanceSwap = tokenAmounts[1];
    let fees0main = await token0.balanceOf(other.address);
    let fees1main = await token1.balanceOf(other.address);
    let fees0aff = await token0.balanceOf(bob.address);
    let fees1aff = await token1.balanceOf(bob.address);
    expect(fees0main).to.equal(0);
    expect(fees1main).to.equal(0);
    expect(fees0aff).to.equal(0);
    expect(fees1aff).to.equal(0);
    const rebalanceSwapAmount = ethers.utils.parseEther("4000");
    await algebraVault.rebalance(-1800, 1920, limitLower, limitUpper, rebalanceSwapAmount);
    tokenAmounts = await algebraVault.getTotalAmounts();
    const token0AfterRebalanceSwap = tokenAmounts[0];
    expect(token0BeforeRebalanceSwap.sub(token0AfterRebalanceSwap).sub(rebalanceSwapAmount).abs()).to.be.lt(
      ethers.utils.parseEther("1"),
    );
    token0vault = await token0.balanceOf(algebraVault.address);
    token1vault = await token1.balanceOf(algebraVault.address);
    expect(token0vault).to.equal(0);
    expect(token1vault).to.equal(0);
    fees0main = await token0.balanceOf(other.address);
    fees1main = await token1.balanceOf(other.address);
    fees0aff = await token0.balanceOf(bob.address);
    fees1aff = await token1.balanceOf(bob.address);
    if (fees0main > fees0aff) expect(fees0main.sub(fees0aff)).to.lt(10);
    if (fees0main <= fees0aff) expect(fees0aff.sub(fees0main)).to.lt(10);
    expect(fees0aff).to.gt(0);
    expect(fees1aff).to.equal(0);
    expect(fees1main).to.equal(0);

    spot = await oracle.spotPrice(algebraPool.address, token0.address, token1.address);
    twap = await oracle.twapPrice(algebraVaultFactory.address, algebraPool.address, token0.address, token1.address);
    //console.log("spot = "+spot.toString())
    //console.log("twap = "+twap.toString())

    // have the positions been updated? Are the token amounts unchanged?
    basePosition = await algebraVault.getBasePosition();
    limitPosition = await algebraVault.getLimitPosition();
    expect(basePosition[0]).to.be.gt(0);
    expect(limitPosition[0]).to.be.gt(0);

    await algebraVault.rebalance(-1800, 1920, limitLower, limitUpper, rebalanceSwapAmount.mul(-1));
    tokenAmounts = await algebraVault.getTotalAmounts();
    let token0AfterSecondRebalance = tokenAmounts[0];
    let token1AfterSecondRebalance = tokenAmounts[1];
    expect(token0AfterSecondRebalance.sub(token0BeforeRebalanceSwap).abs()).to.be.lt(ethers.utils.parseEther("15"));
    expect(token1AfterSecondRebalance.sub(token1BeforeRebalanceSwap).abs()).to.be.lt(ethers.utils.parseEther("15"));

    // try depositing when there is some liquidity in both base and limit positions
    await algebraVault.connect(alice).deposit(smallTokenAmount, smallTokenAmount, alice.address);

    // test withdrawal of liquidity
    alice_liq_balance = await algebraVault.balanceOf(alice.address);
    tokenAmounts = await algebraVault.getTotalAmounts();
    token0AfterSecondRebalance = tokenAmounts[0];
    token1AfterSecondRebalance = tokenAmounts[1];
    await expect(algebraVault.connect(alice).withdraw(alice_liq_balance, alice.address))
      .to.emit(algebraVault, "Withdraw")
      .withArgs(
        alice.address,
        alice.address,
        alice_liq_balance,
        token0AfterSecondRebalance,
        token1AfterSecondRebalance,
      );
    tokenAmounts = await algebraVault.getTotalAmounts();
    // verify that all liquidity has been removed from the pool
    expect(tokenAmounts[0]).to.equal(0);
    expect(tokenAmounts[1]).to.equal(0);
  });

  it("calculates fees properly & rebalances to limit-only after large swap (100/0)", async () => {
    // remove affiliate, so all fees would go to the main recipient (100/0 split)
    await algebraVault.connect(wallet).setAffiliate(NULL_ADDRESS);

    await token0.mint(alice.address, largeTokenAmount);
    await token1.mint(alice.address, largeTokenAmount);

    await token0.connect(alice).approve(algebraVault.address, largeTokenAmount);
    await token1.connect(alice).approve(algebraVault.address, largeTokenAmount);

    // alice should start with 0 AlgebraVault tokens
    let alice_liq_balance = await algebraVault.balanceOf(alice.address);
    expect(alice_liq_balance).to.equal(0);

    await expect(algebraVault.connect(alice).deposit(smallTokenAmount, smallTokenAmount, alice.address))
      .to.emit(algebraVault, "Deposit")
      .withArgs(alice.address, alice.address,
        ethers.utils.parseEther("2000").mul(MIN_SHARES), smallTokenAmount, smallTokenAmount);

    let token0vault = await token0.balanceOf(algebraVault.address);
    let token1vault = await token1.balanceOf(algebraVault.address);
    expect(token0vault).to.equal(smallTokenAmount);
    expect(token1vault).to.equal(smallTokenAmount);
    alice_liq_balance = await algebraVault.balanceOf(alice.address);

    // check that alice has been awarded liquidity tokens equal the
    // quantity of tokens deposited since their price is the same
    expect(alice_liq_balance).to.equal(ethers.utils.parseEther("2000").mul(MIN_SHARES));

    // liquidity positions will only be created once rebalance is called
    await algebraVault.rebalance(-120, 120, -60, 0, 0);
    token0vault = await token0.balanceOf(algebraVault.address);
    token1vault = await token1.balanceOf(algebraVault.address);
    expect(token0vault).to.equal(0);
    expect(token1vault).to.equal(0);

    let basePosition = await algebraVault.getBasePosition();
    let limitPosition = await algebraVault.getLimitPosition();
    expect(basePosition[0]).to.be.gt(0);
    expect(limitPosition[0]).to.be.equal(0);

    let tokenAmounts = await algebraVault.getTotalAmounts();
    expect(tokenAmounts[0] === tokenAmounts[1]);

    // do a test swap
    await token0.connect(carol).approve(router.address, veryLargeTokenAmount);
    await token1.connect(carol).approve(router.address, veryLargeTokenAmount);
    await router.connect(carol).exactInputSingle({
      tokenIn: token0.address,
      tokenOut: token1.address,
      recipient: carol.address,
      deadline: 2000000000, // Wed May 18 2033 03:33:20 GMT+0000
      amountIn: ethers.utils.parseEther("100000000"),
      amountOutMinimum: ethers.utils.parseEther("0"),
      limitSqrtPrice: 0,
    });

    let limitUpper = 0;
    let limitLower = -180;
    tokenAmounts = await algebraVault.getTotalAmounts();
    expect(tokenAmounts[0] > tokenAmounts[1]);
    let currentTick = await algebraVault.currentTick();
    // this is beyond the bounds of the original base position
    expect(currentTick).to.equal(-199);

    let fees0 = await token0.balanceOf(other.address);
    let fees1 = await token1.balanceOf(other.address);
    expect(fees0).to.equal(0);
    expect(fees1).to.equal(0);
    await algebraVault.rebalance(-1800, 1800, limitLower, limitUpper, 0);
    token0vault = await token0.balanceOf(algebraVault.address);
    token1vault = await token1.balanceOf(algebraVault.address);
    expect(token0vault).to.equal(0);
    expect(token1vault).to.equal(0);
    fees0 = await token0.balanceOf(other.address);
    fees1 = await token1.balanceOf(other.address);
    //console.log(fees0)
    //console.log(fees1)
    expect(fees0).to.gt(ethers.utils.parseEther("0.02"));
    expect(fees0).to.lt(ethers.utils.parseEther("0.025"));
    // have the positions been updated? Are the token amounts unchanged?
    basePosition = await algebraVault.getBasePosition();
    limitPosition = await algebraVault.getLimitPosition();
    // the base position should have 0 liquidity because we are left with
    // only a single asset after carol's big swap
    expect(basePosition[0]).to.equal(0);
    expect(limitPosition[0]).to.be.gt(0);

    // restore affiliate but set the split to 100/0, so it'll have the same effect
    await algebraVault.connect(wallet).setAffiliate(bob.address);
    await algebraVaultFactory.connect(wallet).setBaseFeeSplit(PERCENT_100);
    // also set baseFee to 20%
    await algebraVaultFactory.connect(wallet).setBaseFee(PERCENT_20);

    // swap everything back and check fees in the other token have
    // been earned
    await router.connect(carol).exactInputSingle({
      tokenIn: token1.address,
      tokenOut: token0.address,
      recipient: carol.address,
      deadline: 2000000000, // Wed May 18 2033 03:33:20 GMT+0000
      amountIn: ethers.utils.parseEther("200000000"),
      amountOutMinimum: ethers.utils.parseEther("0"),
      limitSqrtPrice: 0,
    });
    currentTick = await algebraVault.currentTick();
    // this is beyond the bounds of the original base position
    expect(currentTick).to.equal(200);
    limitUpper = 180;
    limitLower = 0;
    await expect(algebraVault.rebalance(-1800, 1800, limitLower, limitUpper, 0)).to.emit(algebraVault, "Rebalance");
    token0vault = await token0.balanceOf(algebraVault.address);
    token1vault = await token1.balanceOf(algebraVault.address);
    expect(token0vault).to.equal(0);
    expect(token1vault).to.equal(0);
    fees1 = await token1.balanceOf(other.address);
    //console.log(fees1)
    // we are expecting fees of approximately 3 bips (10% of 30bips, which is total fees)
    expect(fees1).to.gt(ethers.utils.parseEther("0.038"));
    expect(fees1).to.lt(ethers.utils.parseEther("0.041"));

    // have the positions been updated? Are the token amounts unchanged?
    basePosition = await algebraVault.getBasePosition();
    limitPosition = await algebraVault.getLimitPosition();
    // the base position should have 0 liquidity because we are left with
    // only a single asset after carol's big swap
    expect(basePosition[0]).to.equal(0);
    expect(limitPosition[0]).to.be.gt(0);

    await algebraVaultFactory.connect(wallet).setBaseFee(0);
    await algebraVault.rebalance(-1800, 1800, limitLower, limitUpper, 0);

    // restore affiliate and split
    await expect(algebraVault.connect(wallet).setAffiliate(bob.address))
      .to.emit(algebraVault, "Affiliate")
      .withArgs(wallet.address, bob.address);
    await algebraVaultFactory.connect(wallet).setBaseFeeSplit(PERCENT_50);
    await algebraVaultFactory.connect(wallet).setBaseFee(PERCENT_10);
  });

  it("calculates fees properly & rebalances to limit-only after large swap (40/60, 0/100)", async () => {
    // restore affiliate but set the split to 0/100
    await algebraVault.connect(wallet).setAffiliate(bob.address);
    await algebraVaultFactory.connect(wallet).setBaseFeeSplit(0);

    await token0.mint(alice.address, largeTokenAmount);
    await token1.mint(alice.address, largeTokenAmount);

    await token0.connect(alice).approve(algebraVault.address, largeTokenAmount);
    await token1.connect(alice).approve(algebraVault.address, largeTokenAmount);

    // alice should start with 0 AlgebraVault tokens
    let alice_liq_balance = await algebraVault.balanceOf(alice.address);
    expect(alice_liq_balance).to.equal(0);

    await algebraVault.connect(alice).deposit(smallTokenAmount, smallTokenAmount, alice.address);

    let token0vault = await token0.balanceOf(algebraVault.address);
    let token1vault = await token1.balanceOf(algebraVault.address);
    expect(token0vault).to.equal(smallTokenAmount);
    expect(token1vault).to.equal(smallTokenAmount);
    alice_liq_balance = await algebraVault.balanceOf(alice.address);

    // check that alice has been awarded liquidity tokens equal the
    // quantity of tokens deposited since their price is the same
    expect(alice_liq_balance).to.equal(ethers.utils.parseEther("2000").mul(MIN_SHARES));

    // liquidity positions will only be created once rebalance is called
    await algebraVault.rebalance(-120, 120, -60, 0, 0);
    token0vault = await token0.balanceOf(algebraVault.address);
    token1vault = await token1.balanceOf(algebraVault.address);
    expect(token0vault).to.equal(0);
    expect(token1vault).to.equal(0);

    let basePosition = await algebraVault.getBasePosition();
    let limitPosition = await algebraVault.getLimitPosition();
    expect(basePosition[0]).to.be.gt(0);
    expect(limitPosition[0]).to.be.equal(0);

    let tokenAmounts = await algebraVault.getTotalAmounts();
    expect(tokenAmounts[0] === tokenAmounts[1]);

    // do a test swap
    await token0.connect(carol).approve(router.address, veryLargeTokenAmount);
    await token1.connect(carol).approve(router.address, veryLargeTokenAmount);
    await router.connect(carol).exactInputSingle({
      tokenIn: token0.address,
      tokenOut: token1.address,
      recipient: carol.address,
      deadline: 2000000000, // Wed May 18 2033 03:33:20 GMT+0000
      amountIn: ethers.utils.parseEther("100000000"),
      amountOutMinimum: ethers.utils.parseEther("0"),
      limitSqrtPrice: 0,
    });

    let limitUpper = 0;
    let limitLower = -180;
    tokenAmounts = await algebraVault.getTotalAmounts();
    expect(tokenAmounts[0] > tokenAmounts[1]);
    let currentTick = await algebraVault.currentTick();
    // this is beyond the bounds of the original base position
    expect(currentTick).to.equal(-199);

    let fees0main = await token0.balanceOf(other.address);
    let fees1main = await token1.balanceOf(other.address);
    let fees0aff = await token0.balanceOf(bob.address);
    let fees1aff = await token1.balanceOf(bob.address);
    expect(fees0aff).to.equal(0);
    expect(fees1aff).to.equal(0);

    await algebraVault.rebalance(-1800, 1800, limitLower, limitUpper, 0);
    token0vault = await token0.balanceOf(algebraVault.address);
    token1vault = await token1.balanceOf(algebraVault.address);
    expect(token0vault).to.equal(0);
    expect(token1vault).to.equal(0);
    fees0main = await token0.balanceOf(other.address);
    fees1main = await token1.balanceOf(other.address);
    fees0aff = await token0.balanceOf(bob.address);
    fees1aff = await token1.balanceOf(bob.address);
    expect(fees0main).to.equal(0);
    expect(fees1main).to.equal(0);
    //console.log(fees0aff)
    expect(fees0aff).to.gt(ethers.utils.parseEther("0.02"));
    expect(fees0aff).to.lt(ethers.utils.parseEther("0.025"));
    // have the positions been updated? Are the token amounts unchanged?
    basePosition = await algebraVault.getBasePosition();
    limitPosition = await algebraVault.getLimitPosition();
    // the base position should have 0 liquidity because we are left with
    // only a single asset after carol's big swap
    expect(basePosition[0]).to.equal(0);
    expect(limitPosition[0]).to.be.gt(0);

    // swap everything back and check fees in the other token have
    // been earned
    await router.connect(carol).exactInputSingle({
      tokenIn: token1.address,
      tokenOut: token0.address,
      recipient: carol.address,
      deadline: 2000000000, // Wed May 18 2033 03:33:20 GMT+0000
      amountIn: ethers.utils.parseEther("200000000"),
      amountOutMinimum: ethers.utils.parseEther("0"),
      limitSqrtPrice: 0,
    });
    currentTick = await algebraVault.currentTick();

    // set split as 40/60
    await algebraVaultFactory.connect(wallet).setBaseFeeSplit(PERCENT_40);

    // this is beyond the bounds of the original base position
    expect(currentTick).to.equal(200);
    limitUpper = 180;
    limitLower = 0;
    await algebraVault.rebalance(-1800, 1800, limitLower, limitUpper, 0);
    token0vault = await token0.balanceOf(algebraVault.address);
    token1vault = await token1.balanceOf(algebraVault.address);
    expect(token0vault).to.equal(0);
    expect(token1vault).to.equal(0);
    fees1main = await token1.balanceOf(other.address);
    fees1aff = await token1.balanceOf(bob.address);
    // we are expecting fees of approximately 3 bips (10% of 30bips, which is total fees)
    // and adjust for 40/60
    //console.log(fees1main)
    //console.log(fees1aff)
    expect(fees1main).to.gt(ethers.utils.parseEther("0.015"));
    expect(fees1main).to.lt(ethers.utils.parseEther("0.016"));
    expect(fees1aff).to.gt(ethers.utils.parseEther("0.023"));
    expect(fees1aff).to.lt(ethers.utils.parseEther("0.024"));

    // have the positions been updated? Are the token amounts unchanged?
    basePosition = await algebraVault.getBasePosition();
    limitPosition = await algebraVault.getLimitPosition();
    // the base position should have 0 liquidity because we are left with
    // only a single asset after carol's big swap
    expect(basePosition[0]).to.equal(0);
    expect(limitPosition[0]).to.be.gt(0);

    // restore affiliate and 50/50 split
    await algebraVault.connect(wallet).setAffiliate(bob.address);
    await algebraVaultFactory.connect(wallet).setBaseFeeSplit(PERCENT_50);
  });

  it("calculates amm fees properly", async () => {
    // restore affiliate but set the split to 0/100
    await algebraVault.connect(wallet).setAffiliate(bob.address);
    await algebraVaultFactory.connect(wallet).setBaseFeeSplit(0);

    await algebraVaultFactory.connect(wallet).setAmmFee(PERCENT_50);
    await algebraVault.connect(wallet).setAmmFeeRecipient(user0.address);

    await token0.mint(alice.address, largeTokenAmount);
    await token1.mint(alice.address, largeTokenAmount);

    await token0.connect(alice).approve(algebraVault.address, largeTokenAmount);
    await token1.connect(alice).approve(algebraVault.address, largeTokenAmount);

    // alice should start with 0 AlgebraVault tokens
    let alice_liq_balance = await algebraVault.balanceOf(alice.address);
    expect(alice_liq_balance).to.equal(0);

    await algebraVault.connect(alice).deposit(smallTokenAmount, smallTokenAmount, alice.address);

    let token0vault = await token0.balanceOf(algebraVault.address);
    let token1vault = await token1.balanceOf(algebraVault.address);
    expect(token0vault).to.equal(smallTokenAmount);
    expect(token1vault).to.equal(smallTokenAmount);
    alice_liq_balance = await algebraVault.balanceOf(alice.address);

    // check that alice has been awarded liquidity tokens equal the
    // quantity of tokens deposited since their price is the same
    expect(alice_liq_balance).to.equal(ethers.utils.parseEther("2000").mul(MIN_SHARES));

    // liquidity positions will only be created once rebalance is called
    await algebraVault.rebalance(-120, 120, -60, 0, 0);
    token0vault = await token0.balanceOf(algebraVault.address);
    token1vault = await token1.balanceOf(algebraVault.address);
    expect(token0vault).to.equal(0);
    expect(token1vault).to.equal(0);

    let basePosition = await algebraVault.getBasePosition();
    let limitPosition = await algebraVault.getLimitPosition();
    expect(basePosition[0]).to.be.gt(0);
    expect(limitPosition[0]).to.be.equal(0);

    let tokenAmounts = await algebraVault.getTotalAmounts();
    expect(tokenAmounts[0] === tokenAmounts[1]);

    // do a test swap
    await token0.connect(carol).approve(router.address, veryLargeTokenAmount);
    await token1.connect(carol).approve(router.address, veryLargeTokenAmount);
    await router.connect(carol).exactInputSingle({
      tokenIn: token0.address,
      tokenOut: token1.address,
      recipient: carol.address,
      deadline: 2000000000, // Wed May 18 2033 03:33:20 GMT+0000
      amountIn: ethers.utils.parseEther("100000000"),
      amountOutMinimum: ethers.utils.parseEther("0"),
      limitSqrtPrice: 0,
    });

    let limitUpper = 0;
    let limitLower = -180;
    tokenAmounts = await algebraVault.getTotalAmounts();
    expect(tokenAmounts[0] > tokenAmounts[1]);
    let currentTick = await algebraVault.currentTick();
    // this is beyond the bounds of the original base position
    expect(currentTick).to.equal(-199);

    let fees0main = await token0.balanceOf(other.address);
    let fees1main = await token1.balanceOf(other.address);
    let fees0aff = await token0.balanceOf(bob.address);
    let fees1aff = await token1.balanceOf(bob.address);
    let fees0amm = await token0.balanceOf(user0.address);
    let fees1amm = await token1.balanceOf(user0.address);
    expect(fees0aff).to.equal(0);
    expect(fees1aff).to.equal(0);
    expect(fees0amm).to.equal(0);
    expect(fees1amm).to.equal(0);

    await algebraVault.rebalance(-1800, 1800, limitLower, limitUpper, 0);
    token0vault = await token0.balanceOf(algebraVault.address);
    token1vault = await token1.balanceOf(algebraVault.address);
    expect(token0vault).to.equal(0);
    expect(token1vault).to.equal(0);
    fees0main = await token0.balanceOf(other.address);
    fees1main = await token1.balanceOf(other.address);
    fees0aff = await token0.balanceOf(bob.address);
    fees1aff = await token1.balanceOf(bob.address);
    fees0amm = await token0.balanceOf(user0.address);
    fees1amm = await token1.balanceOf(user0.address);
    expect(fees0main).to.equal(0);
    expect(fees1main).to.equal(0);
    //console.log(fees0aff)
    expect(fees0aff).to.gt(ethers.utils.parseEther("0.02"));
    expect(fees0aff).to.lt(ethers.utils.parseEther("0.025"));
    //console.log(fees0amm)
    expect(fees0amm).to.gt(ethers.utils.parseEther("0.05"));
    expect(fees0amm).to.lt(ethers.utils.parseEther("0.052"));
    // have the positions been updated? Are the token amounts unchanged?
    basePosition = await algebraVault.getBasePosition();
    limitPosition = await algebraVault.getLimitPosition();
    // the base position should have 0 liquidity because we are left with
    // only a single asset after carol's big swap
    expect(basePosition[0]).to.equal(0);
    expect(limitPosition[0]).to.be.gt(0);

    // swap everything back and check fees in the other token have
    // been earned
    await router.connect(carol).exactInputSingle({
      tokenIn: token1.address,
      tokenOut: token0.address,
      recipient: carol.address,
      deadline: 2000000000, // Wed May 18 2033 03:33:20 GMT+0000
      amountIn: ethers.utils.parseEther("200000000"),
      amountOutMinimum: ethers.utils.parseEther("0"),
      limitSqrtPrice: 0,
    });
    currentTick = await algebraVault.currentTick();

    // set split as 40/60
    await algebraVaultFactory.connect(wallet).setBaseFeeSplit(PERCENT_40);

    // this is beyond the bounds of the original base position
    expect(currentTick).to.equal(200);
    limitUpper = 180;
    limitLower = 0;
    await algebraVault.rebalance(-1800, 1800, limitLower, limitUpper, 0);
    token0vault = await token0.balanceOf(algebraVault.address);
    token1vault = await token1.balanceOf(algebraVault.address);
    expect(token0vault).to.equal(0);
    expect(token1vault).to.equal(0);
    fees1main = await token1.balanceOf(other.address);
    fees1aff = await token1.balanceOf(bob.address);
    fees1amm = await token1.balanceOf(user0.address);
    // we are expecting fees of approximately 3 bips (10% of 30bips, which is total fees)
    // and adjust for 40/60
    //console.log(fees1main)
    //console.log(fees1aff)
    expect(fees1main).to.gt(ethers.utils.parseEther("0.015"));
    expect(fees1main).to.lt(ethers.utils.parseEther("0.016"));
    expect(fees1aff).to.gt(ethers.utils.parseEther("0.023"));
    expect(fees1aff).to.lt(ethers.utils.parseEther("0.024"));
    expect(fees1amm).to.gt(ethers.utils.parseEther("0.09"));
    expect(fees1amm).to.lt(ethers.utils.parseEther("0.1"));

    // have the positions been updated? Are the token amounts unchanged?
    basePosition = await algebraVault.getBasePosition();
    limitPosition = await algebraVault.getLimitPosition();
    // the base position should have 0 liquidity because we are left with
    // only a single asset after carol's big swap
    expect(basePosition[0]).to.equal(0);
    expect(limitPosition[0]).to.be.gt(0);

    // restore affiliate and 50/50 split
    await algebraVault.connect(wallet).setAffiliate(bob.address);
    await algebraVaultFactory.connect(wallet).setBaseFeeSplit(PERCENT_50);
  });

  it("calculates amm fees properly (with changing tickSpacing)", async () => {
    // restore affiliate but set the split to 0/100
    await algebraVault.connect(wallet).setAffiliate(bob.address);
    await algebraVaultFactory.connect(wallet).setBaseFeeSplit(0);

    await algebraVaultFactory.connect(wallet).setAmmFee(PERCENT_50);
    await algebraVault.connect(wallet).setAmmFeeRecipient(user0.address);

    await token0.mint(alice.address, largeTokenAmount);
    await token1.mint(alice.address, largeTokenAmount);

    await token0.connect(alice).approve(algebraVault.address, largeTokenAmount);
    await token1.connect(alice).approve(algebraVault.address, largeTokenAmount);

    // alice should start with 0 AlgebraVault tokens
    let alice_liq_balance = await algebraVault.balanceOf(alice.address);
    expect(alice_liq_balance).to.equal(0);

    await algebraVault.connect(alice).deposit(smallTokenAmount, smallTokenAmount, alice.address);

    let token0vault = await token0.balanceOf(algebraVault.address);
    let token1vault = await token1.balanceOf(algebraVault.address);
    expect(token0vault).to.equal(smallTokenAmount);
    expect(token1vault).to.equal(smallTokenAmount);
    alice_liq_balance = await algebraVault.balanceOf(alice.address);

    // check that alice has been awarded liquidity tokens equal the
    // quantity of tokens deposited since their price is the same
    expect(alice_liq_balance).to.equal(ethers.utils.parseEther("2000").mul(MIN_SHARES));

    // liquidity positions will only be created once rebalance is called
    await algebraVault.rebalance(-120, 120, -60, 0, 0);
    token0vault = await token0.balanceOf(algebraVault.address);
    token1vault = await token1.balanceOf(algebraVault.address);
    expect(token0vault).to.equal(0);
    expect(token1vault).to.equal(0);

    let basePosition = await algebraVault.getBasePosition();
    let limitPosition = await algebraVault.getLimitPosition();
    expect(basePosition[0]).to.be.gt(0);
    expect(limitPosition[0]).to.be.equal(0);

    let tokenAmounts = await algebraVault.getTotalAmounts();
    expect(tokenAmounts[0] === tokenAmounts[1]);

    // do a test swap
    await token0.connect(carol).approve(router.address, veryLargeTokenAmount);
    await token1.connect(carol).approve(router.address, veryLargeTokenAmount);
    await router.connect(carol).exactInputSingle({
      tokenIn: token0.address,
      tokenOut: token1.address,
      recipient: carol.address,
      deadline: 2000000000, // Wed May 18 2033 03:33:20 GMT+0000
      amountIn: ethers.utils.parseEther("100000000"),
      amountOutMinimum: ethers.utils.parseEther("0"),
      limitSqrtPrice: 0,
    });

    let limitUpper = 0;
    let limitLower = -180;
    tokenAmounts = await algebraVault.getTotalAmounts();
    expect(tokenAmounts[0] > tokenAmounts[1]);
    let currentTick = await algebraVault.currentTick();
    // this is beyond the bounds of the original base position
    expect(currentTick).to.equal(-199);

    let fees0main = await token0.balanceOf(other.address);
    let fees1main = await token1.balanceOf(other.address);
    let fees0aff = await token0.balanceOf(bob.address);
    let fees1aff = await token1.balanceOf(bob.address);
    let fees0amm = await token0.balanceOf(user0.address);
    let fees1amm = await token1.balanceOf(user0.address);
    expect(fees0aff).to.equal(0);
    expect(fees1aff).to.equal(0);
    expect(fees0amm).to.equal(0);
    expect(fees1amm).to.equal(0);

    await algebraPool.setTickSpacing(9);

    await expect(algebraVault.rebalance(-1801, 1801, limitLower, limitUpper, 0)).to.be.revertedWith(
      "AV.rebalance: base position invalid",
    );

    await algebraVault.rebalance(-1809, 1809, limitLower, limitUpper, 0);
    token0vault = await token0.balanceOf(algebraVault.address);
    token1vault = await token1.balanceOf(algebraVault.address);
    expect(token0vault).to.equal(0);
    expect(token1vault).to.equal(0);
    fees0main = await token0.balanceOf(other.address);
    fees1main = await token1.balanceOf(other.address);
    fees0aff = await token0.balanceOf(bob.address);
    fees1aff = await token1.balanceOf(bob.address);
    fees0amm = await token0.balanceOf(user0.address);
    fees1amm = await token1.balanceOf(user0.address);
    expect(fees0main).to.equal(0);
    expect(fees1main).to.equal(0);
    //console.log(fees0aff)
    expect(fees0aff).to.gt(ethers.utils.parseEther("0.02"));
    expect(fees0aff).to.lt(ethers.utils.parseEther("0.025"));
    //console.log(fees0amm)
    expect(fees0amm).to.gt(ethers.utils.parseEther("0.05"));
    expect(fees0amm).to.lt(ethers.utils.parseEther("0.052"));
    // have the positions been updated? Are the token amounts unchanged?
    basePosition = await algebraVault.getBasePosition();
    limitPosition = await algebraVault.getLimitPosition();
    // the base position should have 0 liquidity because we are left with
    // only a single asset after carol's big swap
    expect(basePosition[0]).to.equal(0);
    expect(limitPosition[0]).to.be.gt(0);

    // swap everything back and check fees in the other token have
    // been earned
    await router.connect(carol).exactInputSingle({
      tokenIn: token1.address,
      tokenOut: token0.address,
      recipient: carol.address,
      deadline: 2000000000, // Wed May 18 2033 03:33:20 GMT+0000
      amountIn: ethers.utils.parseEther("200000000"),
      amountOutMinimum: ethers.utils.parseEther("0"),
      limitSqrtPrice: 0,
    });
    currentTick = await algebraVault.currentTick();

    // set split as 40/60
    await algebraVaultFactory.connect(wallet).setBaseFeeSplit(PERCENT_40);

    // this is beyond the bounds of the original base position
    expect(currentTick).to.equal(200);
    limitUpper = 180;
    limitLower = 0;

    await algebraPool.setTickSpacing(20);

    await algebraVault.rebalance(-1800, 1800, limitLower, limitUpper, 0);
    token0vault = await token0.balanceOf(algebraVault.address);
    token1vault = await token1.balanceOf(algebraVault.address);
    expect(token0vault).to.equal(0);
    expect(token1vault).to.equal(0);
    fees1main = await token1.balanceOf(other.address);
    fees1aff = await token1.balanceOf(bob.address);
    fees1amm = await token1.balanceOf(user0.address);
    // we are expecting fees of approximately 3 bips (10% of 30bips, which is total fees)
    // and adjust for 40/60
    //console.log(fees1main)
    //console.log(fees1aff)
    expect(fees1main).to.gt(ethers.utils.parseEther("0.015"));
    expect(fees1main).to.lt(ethers.utils.parseEther("0.016"));
    expect(fees1aff).to.gt(ethers.utils.parseEther("0.023"));
    expect(fees1aff).to.lt(ethers.utils.parseEther("0.024"));
    expect(fees1amm).to.gt(ethers.utils.parseEther("0.09"));
    expect(fees1amm).to.lt(ethers.utils.parseEther("0.1"));

    // have the positions been updated? Are the token amounts unchanged?
    basePosition = await algebraVault.getBasePosition();
    limitPosition = await algebraVault.getLimitPosition();
    // the base position should have 0 liquidity because we are left with
    // only a single asset after carol's big swap
    expect(basePosition[0]).to.equal(0);
    expect(limitPosition[0]).to.be.gt(0);

    // restore affiliate and 50/50 split
    await algebraVault.connect(wallet).setAffiliate(bob.address);
    await algebraVaultFactory.connect(wallet).setBaseFeeSplit(PERCENT_50);
  });

  it("collectFees", async () => {
    // restore affiliate but set the split to 0/100
    await algebraVault.connect(wallet).setAffiliate(bob.address);
    await algebraVaultFactory.connect(wallet).setBaseFeeSplit(0);

    await algebraVaultFactory.connect(wallet).setAmmFee(PERCENT_50);
    await algebraVault.connect(wallet).setAmmFeeRecipient(user0.address);

    await token0.mint(alice.address, largeTokenAmount);
    await token1.mint(alice.address, largeTokenAmount);

    await token0.connect(alice).approve(algebraVault.address, largeTokenAmount);
    await token1.connect(alice).approve(algebraVault.address, largeTokenAmount);

    // alice should start with 0 AlgebraVault tokens
    let alice_liq_balance = await algebraVault.balanceOf(alice.address);
    expect(alice_liq_balance).to.equal(0);

    await algebraVault.connect(alice).deposit(smallTokenAmount, smallTokenAmount, alice.address);

    let token0vault = await token0.balanceOf(algebraVault.address);
    let token1vault = await token1.balanceOf(algebraVault.address);
    expect(token0vault).to.equal(smallTokenAmount);
    expect(token1vault).to.equal(smallTokenAmount);
    alice_liq_balance = await algebraVault.balanceOf(alice.address);

    // check that alice has been awarded liquidity tokens equal the
    // quantity of tokens deposited since their price is the same
    expect(alice_liq_balance).to.equal(ethers.utils.parseEther("2000").mul(MIN_SHARES));

    // liquidity positions will only be created once rebalance is called
    await algebraVault.rebalance(-120, 120, -60, 0, 0);
    token0vault = await token0.balanceOf(algebraVault.address);
    token1vault = await token1.balanceOf(algebraVault.address);
    expect(token0vault).to.equal(0);
    expect(token1vault).to.equal(0);

    let basePosition = await algebraVault.getBasePosition();
    let limitPosition = await algebraVault.getLimitPosition();
    expect(basePosition[0]).to.be.gt(0);
    expect(limitPosition[0]).to.be.equal(0);

    let tokenAmounts = await algebraVault.getTotalAmounts();
    expect(tokenAmounts[0] === tokenAmounts[1]);

    // do a test swap
    await token0.connect(carol).approve(router.address, veryLargeTokenAmount);
    await token1.connect(carol).approve(router.address, veryLargeTokenAmount);
    await router.connect(carol).exactInputSingle({
      tokenIn: token0.address,
      tokenOut: token1.address,
      recipient: carol.address,
      deadline: 2000000000, // Wed May 18 2033 03:33:20 GMT+0000
      amountIn: ethers.utils.parseEther("100000000"),
      amountOutMinimum: ethers.utils.parseEther("0"),
      limitSqrtPrice: 0,
    });

    tokenAmounts = await algebraVault.getTotalAmounts();
    expect(tokenAmounts[0] > tokenAmounts[1]);
    let currentTick = await algebraVault.currentTick();
    // this is beyond the bounds of the original base position
    expect(currentTick).to.equal(-199);

    let fees0main = await token0.balanceOf(other.address);
    let fees1main = await token1.balanceOf(other.address);
    let fees0aff = await token0.balanceOf(bob.address);
    let fees1aff = await token1.balanceOf(bob.address);
    let fees0amm = await token0.balanceOf(user0.address);
    let fees1amm = await token1.balanceOf(user0.address);
    expect(fees0aff).to.equal(0);
    expect(fees1aff).to.equal(0);
    expect(fees0amm).to.equal(0);
    expect(fees1amm).to.equal(0);

    let totals = await algebraVault.getTotalAmounts();
    //console.log(totals)

    await algebraVault.collectFees();
    //console.log(fees);
    token0vault = await token0.balanceOf(algebraVault.address);
    token1vault = await token1.balanceOf(algebraVault.address);
    // some fees are left in the vault
    expect(token0vault).to.gt(ethers.utils.parseEther("0.03"));
    expect(token0vault).to.lt(ethers.utils.parseEther("0.035"));
    expect(token1vault).to.equal(0);
    fees0main = await token0.balanceOf(other.address);
    fees1main = await token1.balanceOf(other.address);
    fees0aff = await token0.balanceOf(bob.address);
    fees1aff = await token1.balanceOf(bob.address);
    fees0amm = await token0.balanceOf(user0.address);
    fees1amm = await token1.balanceOf(user0.address);
    //console.log(fees0main)
    expect(fees0main).to.equal(0);
    expect(fees1main).to.equal(0);
    //console.log(fees0aff)
    // both aff and amm get some fees
    expect(fees0aff).to.gt(ethers.utils.parseEther("0.02"));
    expect(fees0aff).to.lt(ethers.utils.parseEther("0.025"));
    //console.log(fees0amm)
    expect(fees0amm).to.gt(ethers.utils.parseEther("0.05"));
    expect(fees0amm).to.lt(ethers.utils.parseEther("0.052"));
    // have the positions been updated? Are the token amounts unchanged?
    totals = await algebraVault.getTotalAmounts();
    //console.log(totals)

    // swap everything back and check fees in the other token have
    // been earned
    await router.connect(carol).exactInputSingle({
      tokenIn: token1.address,
      tokenOut: token0.address,
      recipient: carol.address,
      deadline: 2000000000, // Wed May 18 2033 03:33:20 GMT+0000
      amountIn: ethers.utils.parseEther("200000000"),
      amountOutMinimum: ethers.utils.parseEther("0"),
      limitSqrtPrice: 0,
    });
    currentTick = await algebraVault.currentTick();

    // set split as 40/60
    await algebraVaultFactory.connect(wallet).setBaseFeeSplit(PERCENT_40);

    // this is beyond the bounds of the original base position
    expect(currentTick).to.equal(200);

    await algebraVault.collectFees();

    token0vault = await token0.balanceOf(algebraVault.address);
    token1vault = await token1.balanceOf(algebraVault.address);
    fees1main = await token1.balanceOf(other.address);
    fees1aff = await token1.balanceOf(bob.address);
    fees1amm = await token1.balanceOf(user0.address);
    // we are expecting fees of approximately 3 bips (10% of 30bips, which is total fees)
    // and adjust for 40/60
    // token0 should remain in the vault and not distributed
    /*console.log(token0vault)
        console.log(token1vault)
        console.log(fees1main)
        console.log(fees1aff)
        console.log(fees1amm)*/
    expect(token0vault).to.gt(ethers.utils.parseEther("0.03"));
    expect(fees1main).to.gt(ethers.utils.parseEther("0.016"));
    expect(fees1main).to.lt(ethers.utils.parseEther("0.0165"));
    expect(fees1aff).to.gt(ethers.utils.parseEther("0.024"));
    expect(fees1aff).to.lt(ethers.utils.parseEther("0.0245"));
    expect(fees1amm).to.gt(ethers.utils.parseEther("0.1"));
    expect(fees1amm).to.lt(ethers.utils.parseEther("0.11"));

    await algebraVault.collectFees();
    // nothing should change
    token0vault = await token0.balanceOf(algebraVault.address);
    token1vault = await token1.balanceOf(algebraVault.address);
    fees1main = await token1.balanceOf(other.address);
    fees1aff = await token1.balanceOf(bob.address);
    fees1amm = await token1.balanceOf(user0.address);
    // we are expecting fees of approximately 3 bips (10% of 30bips, which is total fees)
    // and adjust for 40/60
    // token0 should remain in the vault and not distributed
    /*console.log(token0vault)
        console.log(token1vault)
        console.log(fees1main)
        console.log(fees1aff)
        console.log(fees1amm)*/
    expect(token0vault).to.gt(ethers.utils.parseEther("0.03"));
    expect(fees1main).to.gt(ethers.utils.parseEther("0.016"));
    expect(fees1main).to.lt(ethers.utils.parseEther("0.0165"));
    expect(fees1aff).to.gt(ethers.utils.parseEther("0.024"));
    expect(fees1aff).to.lt(ethers.utils.parseEther("0.0245"));
    expect(fees1amm).to.gt(ethers.utils.parseEther("0.1"));
    expect(fees1amm).to.lt(ethers.utils.parseEther("0.11"));

    // rebalance still works after collectFees
    await algebraVault.rebalance(-1800, 1800, -180, 0, 0);

    // have the positions been updated? Are the token amounts unchanged?
    basePosition = await algebraVault.getBasePosition();
    limitPosition = await algebraVault.getLimitPosition();
    // the base position should have a little bit liquidity because of the pending fees
    // the rest of the token got swapped
    expect(basePosition[0]).to.gt(ethers.utils.parseEther("0.3"));
    expect(basePosition[0]).to.lt(ethers.utils.parseEther("0.4"));
    expect(limitPosition[0]).to.be.gt(0);
    // but no more pending deposits
    token0vault = await token0.balanceOf(algebraVault.address);
    token1vault = await token1.balanceOf(algebraVault.address);
    expect(token0vault).to.be.eq(0);
    expect(token1vault).to.be.eq(0);

    // restore affiliate and 50/50 split
    await algebraVault.connect(wallet).setAffiliate(bob.address);
    await algebraVaultFactory.connect(wallet).setBaseFeeSplit(PERCENT_50);
  });

  it("deposit/withdrawal with many users", async () => {
    const tokenAmount = ethers.utils.parseEther("10000");

    // token mint for liquidity add
    await token0.mint(user0.address, tokenAmount);
    await token1.mint(user0.address, tokenAmount);

    await token0.mint(user1.address, tokenAmount);
    await token1.mint(user1.address, tokenAmount);

    await token0.mint(user2.address, tokenAmount);
    await token1.mint(user2.address, tokenAmount);

    await token0.mint(user3.address, tokenAmount);
    await token1.mint(user3.address, tokenAmount);

    await token0.mint(user4.address, tokenAmount);
    await token1.mint(user4.address, tokenAmount);

    await token0.mint(other.address, ethers.utils.parseEther("100000"));
    await token1.mint(other.address, ethers.utils.parseEther("100000"));

    // deposit to vault contract

    await token0.connect(user0).approve(algebraVault.address, tokenAmount);
    await token1.connect(user0).approve(algebraVault.address, tokenAmount);

    await token0.connect(user1).approve(algebraVault.address, tokenAmount);
    await token1.connect(user1).approve(algebraVault.address, tokenAmount);

    await token0.connect(user2).approve(algebraVault.address, tokenAmount);
    await token1.connect(user2).approve(algebraVault.address, tokenAmount);

    await token0.connect(user3).approve(algebraVault.address, tokenAmount);
    await token1.connect(user3).approve(algebraVault.address, tokenAmount);

    await token0.connect(user4).approve(algebraVault.address, tokenAmount);
    await token1.connect(user4).approve(algebraVault.address, tokenAmount);

    await algebraVault.connect(user0).deposit(tokenAmount, tokenAmount, user0.address);
    await algebraVault.connect(user1).deposit(tokenAmount, tokenAmount, user1.address);
    await algebraVault.connect(user2).deposit(tokenAmount, tokenAmount, user2.address);
    await algebraVault.connect(user3).deposit(tokenAmount, tokenAmount, user3.address);
    await algebraVault.connect(user4).deposit(tokenAmount, tokenAmount, user4.address);

    let user0token0Amount = await token0.balanceOf(user0.address);
    let user0token1Amount = await token1.balanceOf(user0.address);

    let user1token0Amount = await token0.balanceOf(user1.address);
    let user1token1Amount = await token1.balanceOf(user1.address);

    let user2token0Amount = await token0.balanceOf(user2.address);
    let user2token1Amount = await token1.balanceOf(user2.address);

    let user3token0Amount = await token0.balanceOf(user3.address);
    let user3token1Amount = await token1.balanceOf(user3.address);

    let user4token0Amount = await token0.balanceOf(user4.address);
    let user4token1Amount = await token1.balanceOf(user4.address);

    expect(user0token0Amount.toString()).to.be.equal("0");
    expect(user1token0Amount.toString()).to.be.equal("0");
    expect(user2token0Amount.toString()).to.be.equal("0");
    expect(user3token0Amount.toString()).to.be.equal("0");
    expect(user4token0Amount.toString()).to.be.equal("0");
    expect(user0token1Amount.toString()).to.be.equal("0");
    expect(user1token1Amount.toString()).to.be.equal("0");
    expect(user2token1Amount.toString()).to.be.equal("0");
    expect(user3token1Amount.toString()).to.be.equal("0");
    expect(user4token1Amount.toString()).to.be.equal("0");

    // rebalance
    await algebraVault.rebalance(-120, 120, 0, 60, 0);

    // withdraw
    const user0_liq_balance = await algebraVault.balanceOf(user0.address);
    const user1_liq_balance = await algebraVault.balanceOf(user1.address);
    const user2_liq_balance = await algebraVault.balanceOf(user2.address);
    const user3_liq_balance = await algebraVault.balanceOf(user3.address);
    const user4_liq_balance = await algebraVault.balanceOf(user4.address);

    await algebraVault.connect(user0).withdraw(user0_liq_balance, user0.address);
    await algebraVault.connect(user1).withdraw(user1_liq_balance, user1.address);
    await algebraVault.connect(user2).withdraw(user2_liq_balance, user2.address);
    await algebraVault.connect(user3).withdraw(user3_liq_balance, user3.address);
    await algebraVault.connect(user4).withdraw(user4_liq_balance, user4.address);

    user0token0Amount = await token0.balanceOf(user0.address);
    user0token1Amount = await token1.balanceOf(user0.address);

    user1token0Amount = await token0.balanceOf(user1.address);
    user1token1Amount = await token1.balanceOf(user1.address);

    user2token0Amount = await token0.balanceOf(user2.address);
    user2token1Amount = await token1.balanceOf(user2.address);

    user3token0Amount = await token0.balanceOf(user3.address);
    user3token1Amount = await token1.balanceOf(user3.address);

    user4token0Amount = await token0.balanceOf(user4.address);
    user4token1Amount = await token1.balanceOf(user4.address);

    expect(user0token0Amount.sub(tokenAmount).abs().toNumber()).to.be.lte(1);
    expect(user1token0Amount.sub(tokenAmount).abs().toNumber()).to.be.lte(1);
    expect(user2token0Amount.sub(tokenAmount).abs().toNumber()).to.be.lte(1);
    expect(user3token0Amount.sub(tokenAmount).abs().toNumber()).to.be.lte(1);
    expect(user0token1Amount.sub(tokenAmount).abs().toNumber()).to.be.lte(1);
    expect(user1token1Amount.sub(tokenAmount).abs().toNumber()).to.be.lte(1);
    expect(user2token1Amount.sub(tokenAmount).abs().toNumber()).to.be.lte(1);
    expect(user3token1Amount.sub(tokenAmount).abs().toNumber()).to.be.lte(1);
  });

  it("can withdraw deposited funds without rebalance", async () => {
    await token0.mint(alice.address, largeTokenAmount);
    await token1.mint(alice.address, largeTokenAmount);

    await token0.connect(alice).approve(algebraVault.address, largeTokenAmount);
    await token1.connect(alice).approve(algebraVault.address, largeTokenAmount);

    // alice should start with 0 vault tokens
    let alice_liq_balance = await algebraVault.balanceOf(alice.address);
    expect(alice_liq_balance).to.equal(0);

    await algebraVault.connect(alice).deposit(smallTokenAmount, smallTokenAmount, alice.address);
    alice_liq_balance = await algebraVault.balanceOf(alice.address);
    expect(alice_liq_balance).to.equal(ethers.utils.parseEther("2000").mul(MIN_SHARES));
    await algebraVault.connect(alice).withdraw(alice_liq_balance, alice.address);
    let tokenAmounts = await algebraVault.getTotalAmounts();
    // verify that all liquidity has been removed from the pool
    expect(tokenAmounts[0]).to.equal(0);
    expect(tokenAmounts[1]).to.equal(0);

    await algebraVault.connect(alice).deposit(smallTokenAmount, smallTokenAmount, alice.address);

    await algebraVault.rebalance(-120, 120, 0, 60, 0);

    const tokenAmount = smallTokenAmount;

    await token0.mint(user0.address, tokenAmount);
    await token1.mint(user0.address, tokenAmount);
    await token0.connect(user0).approve(algebraVault.address, tokenAmount);
    await token1.connect(user0).approve(algebraVault.address, tokenAmount);
    await algebraVault.connect(user0).deposit(tokenAmount, tokenAmount, user0.address);
    let token0Balance = await token0.balanceOf(user0.address);
    let token1Balance = await token1.balanceOf(user0.address);
    expect(token0Balance).to.equal(0);
    expect(token1Balance).to.equal(0);

    const user0_liq_balance = await algebraVault.balanceOf(user0.address);
    tokenAmounts = await algebraVault.getTotalAmounts();
    // verify that all liquidity has been removed from the pool
    expect(tokenAmounts[0]).to.be.gte(ethers.utils.parseEther("2000").sub(15));
    expect(tokenAmounts[1]).to.be.gte(ethers.utils.parseEther("2000").sub(15));
    expect(tokenAmounts[0]).to.be.lt(ethers.utils.parseEther("2000").add(15));
    expect(tokenAmounts[1]).to.be.lt(ethers.utils.parseEther("2000").add(15));

    await algebraVault.connect(user0).withdraw(user0_liq_balance, user0.address);
    token0Balance = await token0.balanceOf(user0.address);
    token1Balance = await token1.balanceOf(user0.address);
    expect(token0Balance).to.equal(smallTokenAmount);
    expect(token1Balance).to.equal(smallTokenAmount);
  });
});

describe("ETHUSDT AlgebraVault Test", () => {
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

  let factory: IAlgebraFactory;
  let router: ISwapRouter;
  let nft: INonfungiblePositionManager;
  let oracle: TestOracle;
  let token0: TestERC20;
  let token1: TestERC20;
  let token2: TestERC20;
  let algebraPool: IAlgebraPool;
  let algebraVaultFactory: AlgebraVaultFactory;
  let algebraVault: AlgebraVault;

  before("create fixture loader", async () => {
    [wallet, alice, bob, carol, other, user0, user1, user2, user3, user4] = await ethers.getSigners();
  });

  beforeEach("deploy contracts", async () => {
    ({ token0, token1, token2, factory, router, nft, oracle, algebraVaultFactory } = await loadFixture(
      algebraVaultTestFixture,
    ));

    await factory.createPool(token0.address, token1.address, '0x');
    const poolAddress = await factory.poolByPair(token0.address, token1.address);
    algebraPool = (await ethers.getContractAt("IAlgebraPool", poolAddress)) as IAlgebraPool;
    // initializing the pool to mimick the tick that an ETH (18 decimals)
    // - USDT (6 decimals) pool would have if ETH were priced at $2500
    await algebraPool.initialize(encodePriceSqrt(2500000000, ethers.utils.parseEther("1")));
    await algebraVaultFactory.connect(wallet).createAlgebraVault(token0.address, false, token1.address, true);

    const vaultKey = await algebraVaultFactory.genKey(wallet.address, token0.address, token1.address, false, true);
    const algebraVaultAddress = await algebraVaultFactory.getAlgebraVault(vaultKey);
    algebraVault = (await ethers.getContractAt("AlgebraVault", algebraVaultAddress)) as AlgebraVault;
    await algebraVault.connect(wallet).setDepositMax(ethers.utils.parseEther("100000"), ethers.utils.parseEther("100000"));

    // adding extra liquidity into pool to make sure there's always
    // someone to swap with
    await token0.mint(user0.address, giantTokenAmount);
    await token1.mint(user0.address, giantTokenAmount);

    await token0.connect(user0).approve(nft.address, veryLargeTokenAmount);
    await token1.connect(user0).approve(nft.address, veryLargeTokenAmount);

    await nft.connect(user0).mint({
      token0: token0.address,
      token1: token1.address,
      deployer: NULL_ADDRESS,
      tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
      tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
      recipient: user0.address,
      amount0Desired: veryLargeTokenAmount,
      amount1Desired: veryLargeTokenAmount,
      amount0Min: 0,
      amount1Min: 0,
      deadline: 2000000000,
    });

    await network.provider.send("evm_increaseTime", [3600]);
  });

  it.only("handles deposit / withdrawal from pools of different balances", async () => {
    const gState = await algebraPool.globalState();
    expect(gState.tick).to.equal(-198080);

    // create a balanced base deposit
    await token0.mint(user1.address, largeTokenAmount);
    await token1.mint(user1.address, largeTokenAmount);

    await token0.connect(user1).approve(algebraVault.address, largeTokenAmount);
    await token1.connect(user1).approve(algebraVault.address, largeTokenAmount);

    await algebraVault.connect(user1).deposit(0, 2500000000, user1.address);

    let user1LiquidityBalance = await algebraVault.balanceOf(user1.address);
    let expectedValue = 2500000000 * MIN_SHARES;
    expect(user1LiquidityBalance).to.be.gt(Math.round(expectedValue * 0.999));
    expect(user1LiquidityBalance).to.be.lt(Math.round(expectedValue * 1.001));

    // deposit & withdraw liquidity with ETH & USDT balanced
    await token0.mint(user2.address, ethers.utils.parseEther("0.5"));
    await token1.mint(user2.address, 1250000000);
    await token0.connect(user2).approve(algebraVault.address, ethers.utils.parseEther("0.5"));
    await token1.connect(user2).approve(algebraVault.address, 1250000000);

    await algebraVault.connect(user2).deposit(0, 1250000000, user2.address);
    const user2LiquidityBalance = await algebraVault.balanceOf(user2.address);
    expectedValue = 2500000000 * MIN_SHARES / 2;
    expect(user2LiquidityBalance).to.be.gt(Math.round(expectedValue * 0.999));
    expect(user2LiquidityBalance).to.be.lt(Math.round(expectedValue * 1.001));

    await algebraVault.connect(user2).withdraw(user2LiquidityBalance, user2.address);

    const user2ethBalance = await token0.balanceOf(user2.address);
    const user2usdtBalance = await token1.balanceOf(user2.address);
    expect(user2usdtBalance).to.be.lt(1250100000);
    expect(user2usdtBalance).to.be.gt(1249900000);

    // deposit & withdraw liquidity with USDT only
    await token1.mint(user3.address, 1250000000);
    await token1.connect(user3).approve(algebraVault.address, 1250000000);

    await algebraVault.connect(user3).deposit(0, 1250000000, user3.address);
    const user3LiquidityBalance = await algebraVault.balanceOf(user3.address);
    expect(user3LiquidityBalance).to.be.gt(1249900000 * MIN_SHARES);
    expect(user3LiquidityBalance).to.be.lt(1250100000 * MIN_SHARES);

    await algebraVault.connect(user3).withdraw(user3LiquidityBalance, user3.address);

    const user3usdtBalance = await token1.balanceOf(user3.address);
    expect(user3usdtBalance).to.be.lt(1250100000);
    expect(user3usdtBalance).to.be.gt(1249900000);

    // deposit & withdraw liquidity with ETH & USDT balanced
    // deposit & withdraw liquidity with ETH overweight
    // deposit & withdraw liquidity with USDT overweight
  });
});

describe("AlgebraVault additional coverage tests", () => {
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

  let factory: IAlgebraFactory;
  let router: ISwapRouter;
  let nft: INonfungiblePositionManager;
  let oracle: TestOracle;
  let token0: TestERC20;
  let token1: TestERC20;
  let token2: TestERC20;
  let algebraPool: IAlgebraPool;
  let algebraVaultFactory: AlgebraVaultFactory;
  let algebraVault: AlgebraVault;

  before("create fixture loader", async () => {
    [wallet, alice, bob, carol, other, user0, user1, user2, user3, user4] = await ethers.getSigners();
  });

  beforeEach("deploy contracts", async () => {
    ({ token0, token1, token2, factory, router, nft, oracle, algebraVaultFactory } = await loadFixture(
      algebraVaultTestFixture,
    ));
    await algebraVaultFactory.connect(wallet).setFeeRecipient(other.address);

    await factory.createPool(token0.address, token1.address, '0x');
    const poolAddress = await factory.poolByPair(token0.address, token1.address);
    algebraPool = (await ethers.getContractAt("IAlgebraPool", poolAddress)) as IAlgebraPool;
    await algebraPool.initialize(encodePriceSqrt("1", "1"));

    await algebraVaultFactory.connect(wallet).createAlgebraVault(token0.address, true, token1.address, false);

    await token0.mint(carol.address, giantTokenAmount);
    await token1.mint(carol.address, giantTokenAmount);

    await token0.connect(carol).approve(nft.address, veryLargeTokenAmount);
    await token1.connect(carol).approve(nft.address, veryLargeTokenAmount);

    await token0.connect(carol).approve(router.address, veryLargeTokenAmount);
    await token1.connect(carol).approve(router.address, veryLargeTokenAmount);

    await token0.mint(alice.address, giantTokenAmount);
    await token1.mint(alice.address, giantTokenAmount);
  });

  it("test swap", async () => {
    await nft.connect(carol).mint({
      token0: token0.address,
      token1: token1.address,
      deployer: NULL_ADDRESS,
      tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
      tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
      recipient: carol.address,
      amount0Desired: smallTokenAmount,
      amount1Desired: smallTokenAmount,
      amount0Min: 0,
      amount1Min: 0,
      deadline: 2000000000,
    });

    await network.provider.send("evm_increaseTime", [3600]);

    const vaultKey = await algebraVaultFactory.genKey(wallet.address, token0.address, token1.address, true, false);
    const algebraVaultAddress = await algebraVaultFactory.getAlgebraVault(vaultKey);
    algebraVault = (await ethers.getContractAt("AlgebraVault", algebraVaultAddress)) as AlgebraVault;
    await algebraVault.connect(wallet).setAffiliate(bob.address);

    // alice approves the AlgebraVault to transfer her tokens
    await token0.connect(alice).approve(algebraVault.address, giantTokenAmount);
    await token1.connect(alice).approve(algebraVault.address, giantTokenAmount);

    // alice should start with 0 AlgebraVault tokens
    let alice_liq_balance = await algebraVault.balanceOf(alice.address);
    expect(alice_liq_balance).to.equal(0);

    await algebraVault.connect(alice).deposit(largeTokenAmount, largeTokenAmount, alice.address);

    const token0vault = await token0.balanceOf(algebraVault.address);
    const token1vault = await token1.balanceOf(algebraVault.address);
    // check that all the tokens alice depostied ended up in the vault
    expect(token0vault).to.equal(largeTokenAmount);
    expect(token1vault).to.equal(largeTokenAmount);

    alice_liq_balance = await algebraVault.balanceOf(alice.address);

    await router.connect(carol).exactInputSingle({
      tokenIn: token0.address,
      tokenOut: token1.address,
      recipient: carol.address,
      deadline: 2000000000, // Wed May 18 2033 03:33:20 GMT+0000
      amountIn: smallTokenAmount,
      amountOutMinimum: ethers.utils.parseEther("0"),
      limitSqrtPrice: 0,
    });

    await algebraVault.connect(alice).deposit(largeTokenAmount, largeTokenAmount, alice.address);
  });
});

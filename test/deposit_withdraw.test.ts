import { PairFlash } from "../contracts/mocks/TestFlashloan";
import {
  IAlgebraFactory,
  IAlgebraPool,
  AlgebraVault,
  AlgebraVaultFactory,
  INonfungiblePositionManager,
  ISwapRouter,
  TestERC20,
  TestOracle,
  AlgebraVaultDepositGuard,
} from "../types";
import { algebraVaultTestFixture } from "./shared/fixtures";
import {
  FeeAmount,
  TICK_SPACINGS,
  encodePriceSqrt,
  getMaxTick,
  getMinTick,
} from "./shared/utilities";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network } from "hardhat";
import "hardhat-tracer";

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
  let depositGuard: AlgebraVaultDepositGuard;
  let algebraVault: AlgebraVault;

  before("create fixture loader", async () => {
    [wallet, alice, bob, carol, other, user0, user1, user2, user3, user4] =
      await ethers.getSigners();
  });

  beforeEach("deploy contracts", async () => {
    ({
      token0,
      token1,
      token2,
      factory,
      router,
      nft,
      oracle,
      algebraVaultFactory,
      depositGuard,
    } = await loadFixture(algebraVaultTestFixture));
   
    await algebraVaultFactory.connect(wallet).setFeeRecipient(other.address);

    await factory.createPool(token0.address, token1.address, "0x");
    const poolAddress = await factory.poolByPair(
      token0.address,
      token1.address
    );
    algebraPool = (await ethers.getContractAt(
      "IAlgebraPool",
      poolAddress
    )) as IAlgebraPool;
    await algebraPool.initialize(encodePriceSqrt("1", "1"));

    await algebraVaultFactory
      .connect(wallet)
      .createAlgebraVault(token0.address, true, token1.address, false);

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

    const vaultKey = await algebraVaultFactory.genKey(
      wallet.address,
      token0.address,
      token1.address,
      true,
      false
    );
    const algebraVaultAddress = await algebraVaultFactory.getAlgebraVault(
      vaultKey
    );
    algebraVault = (await ethers.getContractAt(
      "AlgebraVault",
      algebraVaultAddress
    )) as AlgebraVault;
    await algebraVault.connect(wallet).setAffiliate(bob.address);
    

    await algebraVault
      .connect(wallet)
      .setDepositMax(
        ethers.utils.parseEther("100000"),
        ethers.utils.parseEther("100000")
      );
  });

  function msg(text: string) {
    return (
      "VM Exception while processing transaction: reverted with reason string '" +
      text +
      "'"
    );
  }

  // Should be reverted because of zero amount
  it("deposit with zero amount", async () => {
    await expect(algebraVault.connect(alice).deposit(0, 0, alice.address)).to.be
      .reverted;
    await expect(algebraVault.connect(alice).deposit(0, 0, alice.address)).to.be
      .reverted;
  });

  // should be passed,
  // balance token0 in vault should be equal to smallTokenAmount
  it("deposit from only Alice account", async () => {
    await token0.connect(alice).approve(algebraVault.address, largeTokenAmount);
    await token1.connect(alice).approve(algebraVault.address, largeTokenAmount);
    await token0.connect(alice).mint(alice.address, largeTokenAmount);
    await token1.connect(alice).mint(alice.address, largeTokenAmount);

    await algebraVault
      .connect(alice)
      .deposit(smallTokenAmount, 0, alice.address);
    let token0vault = await token0.balanceOf(algebraVault.address);
    let token1vault = await token1.balanceOf(algebraVault.address);
    expect(token0vault).to.equal(smallTokenAmount);
    expect(token1vault).to.equal(0);
  });

  it("deposit and withdraw", async () => {
    await token0.connect(alice).approve(algebraVault.address, largeTokenAmount);
    await token1.connect(alice).approve(algebraVault.address, largeTokenAmount);
    await token0.connect(alice).mint(alice.address, largeTokenAmount);
    await token1.connect(alice).mint(alice.address, largeTokenAmount);

    await algebraVault
      .connect(alice)
      .deposit(smallTokenAmount, 0, alice.address);
    let alice_liq_balance = await algebraVault.balanceOf(alice.address);
    await algebraVault
      .connect(alice)
      .withdraw(alice_liq_balance, alice.address);
    let token0vault = await token0.balanceOf(algebraVault.address);
    let token1vault = await token1.balanceOf(algebraVault.address);
    expect(token0vault).to.equal(0);
    expect(token1vault).to.equal(0);
  });

  //shuold be passed, amount
  it("mulpile users deposit and withdraw", async () => {
    // alice deposit
    await token0.connect(alice).approve(algebraVault.address, largeTokenAmount);
    await token1.connect(alice).approve(algebraVault.address, largeTokenAmount);
    await token0.connect(alice).mint(alice.address, smallTokenAmount);
    await token1.connect(alice).mint(alice.address, smallTokenAmount);
    await algebraVault
      .connect(alice)
      .deposit(smallTokenAmount, 0, alice.address);

    // bob deposit
    await token0.connect(bob).approve(algebraVault.address, largeTokenAmount);
    await token1.connect(bob).approve(algebraVault.address, largeTokenAmount);
    await token0.connect(bob).mint(bob.address, smallTokenAmount);
    await token1.connect(bob).mint(bob.address, smallTokenAmount);
    await algebraVault.connect(bob).deposit(smallTokenAmount, 0, bob.address);

    //actual balances after deposits
    let vault_balance_after_deposits = await algebraVault.getTotalAmounts();
    

    //alice withdraw
    let alice_liq_balance = await algebraVault.balanceOf(alice.address);
    await algebraVault
      .connect(alice)
      .withdraw(alice_liq_balance, alice.address);
    let token0vault = await token0.balanceOf(algebraVault.address);
    let token1vault = await token1.balanceOf(algebraVault.address);
    
    expect(token0vault).to.equal(
      vault_balance_after_deposits[0].sub(smallTokenAmount)
    );

    //bob withdraw
    let bob_liq_balance = await algebraVault.balanceOf(bob.address);
    await algebraVault.connect(bob).withdraw(bob_liq_balance, bob.address);
    token0vault = await token0.balanceOf(algebraVault.address);
    token1vault = await token1.balanceOf(algebraVault.address);
    expect(token0vault).to.equal(0);
    expect(token1vault).to.equal(0);
  });

  it("multiple users deposit with different amounts", async () => {
    let alice_deposit_amount = ethers.utils.parseEther("1000");
    let bob_deposit_amount = ethers.utils.parseEther("2000");
    let carol_deposit_amount = ethers.utils.parseEther("4000");

    //alice deposit
    await token0.connect(alice).approve(algebraVault.address, largeTokenAmount);
    await token1.connect(alice).approve(algebraVault.address, largeTokenAmount);
    await token0.connect(alice).mint(alice.address, alice_deposit_amount);
    await token1.connect(alice).mint(alice.address, alice_deposit_amount);
    await algebraVault
      .connect(alice)
      .deposit(alice_deposit_amount, 0, alice.address);
    //bob deposit
    await token0.connect(bob).approve(algebraVault.address, largeTokenAmount);
    await token1.connect(bob).approve(algebraVault.address, largeTokenAmount);
    await token0.connect(bob).mint(bob.address, bob_deposit_amount);
    await token1.connect(bob).mint(bob.address, bob_deposit_amount);
    await algebraVault.connect(bob).deposit(bob_deposit_amount, 0, bob.address);

    //carol deposit
    await token0.connect(carol).approve(algebraVault.address, largeTokenAmount);
    await token1.connect(carol).approve(algebraVault.address, largeTokenAmount);
    await token0.connect(carol).mint(carol.address, carol_deposit_amount);
    await token1.connect(carol).mint(carol.address, carol_deposit_amount);
    await algebraVault
      .connect(carol)
      .deposit(carol_deposit_amount, 0, carol.address);

    //actual balances after deposits
    let vault_balance_after_deposits = await algebraVault.getTotalAmounts();
    expect(vault_balance_after_deposits[0]).to.equal(
      alice_deposit_amount.add(bob_deposit_amount).add(carol_deposit_amount)
    );
  });

  //should be reverted
  //alice withdraw amount greater than her deposited
  it("alice withdraw amount greater than her deposited", async () => {
    await token0.connect(alice).approve(algebraVault.address, largeTokenAmount);
    await token1.connect(alice).approve(algebraVault.address, largeTokenAmount);
    await token0.connect(alice).mint(alice.address, smallTokenAmount);
    await token1.connect(alice).mint(alice.address, smallTokenAmount);
    await algebraVault
      .connect(alice)
      .deposit(smallTokenAmount, 0, alice.address);
    let alice_liq_balance = await algebraVault.balanceOf(alice.address);
    await expect(
      algebraVault
        .connect(alice)
        .withdraw(alice_liq_balance.add(1), alice.address)
    ).to.be.reverted;
  });

  it("swap and deposit in same block", async () => {
    let amount_for_swap = ethers.utils.parseEther("1000");
    await token0.connect(alice).mint(alice.address, smallTokenAmount);
    await token0.connect(alice).approve(algebraVault.address, largeTokenAmount);
    await token1.connect(carol).approve(router.address, veryLargeTokenAmount);
    await token1.connect(carol).mint(carol.address, amount_for_swap);
    await network.provider.send("evm_setAutomine", [false]);
    await router.connect(carol).exactInputSingle(
      {
        tokenIn: token1.address,
        tokenOut: token0.address,
        recipient: alice.address,
        deployer: NULL_ADDRESS,
        deadline: 2000000000, // Wed May 18 2033 03:33:20 GMT+0000
        amountIn: amount_for_swap,
        amountOutMinimum: ethers.utils.parseEther("0"),
        limitSqrtPrice: 0,
      },
      { gasLimit: 30000000 }
    );
    await algebraVault
      .connect(alice)
      .deposit(smallTokenAmount, 0, alice.address);
    await network.provider.send("evm_mine");
    await network.provider.send("evm_setAutomine", [true]);
  });

  //should be reverted
  //alice withdraw amount greater than her deposited
  it("multiply users deposit and alice withdraw amount greater than her deposited", async () => {
    let alice_deposit_amount = ethers.utils.parseEther("1000");
    let bob_deposit_amount = ethers.utils.parseEther("2000");
    //alice deposit
    await token0.connect(alice).approve(algebraVault.address, largeTokenAmount);
    await token1.connect(alice).approve(algebraVault.address, largeTokenAmount);
    await token0.connect(alice).mint(alice.address, alice_deposit_amount);
    await token1.connect(alice).mint(alice.address, alice_deposit_amount);
    await algebraVault
      .connect(alice)
      .deposit(alice_deposit_amount, 0, alice.address);
    //bob deposit
    await token0.connect(bob).approve(algebraVault.address, largeTokenAmount);
    await token1.connect(bob).approve(algebraVault.address, largeTokenAmount);
    await token0.connect(bob).mint(bob.address, bob_deposit_amount);
    await token1.connect(bob).mint(bob.address, bob_deposit_amount);
    await algebraVault.connect(bob).deposit(bob_deposit_amount, 0, bob.address);

    //alice withdraw
    let alice_liq_balance = await algebraVault.balanceOf(alice.address);
    await expect(
      algebraVault
        .connect(alice)
        .withdraw(alice_liq_balance.add(1), alice.address)
    ).to.be.reverted;
  });

  it("rebalance after deposited amount", async () => {
    let amount_for_swap = ethers.utils.parseEther("10000000");
    let amount_for_deposit = ethers.utils.parseEther("10000");

    await token0.connect(alice).approve(algebraVault.address, largeTokenAmount);
    await token1.connect(alice).approve(algebraVault.address, largeTokenAmount);
    await token0.connect(alice).mint(alice.address, largeTokenAmount);
    await token1.connect(alice).mint(alice.address, largeTokenAmount);
    await algebraVault
      .connect(alice)
      .deposit(amount_for_deposit, 0, alice.address);
    await network.provider.send("evm_mine");
    await network.provider.send("evm_increaseTime", [3600]);

    await token0.connect(carol).approve(router.address, veryLargeTokenAmount);
    await token1.connect(carol).approve(router.address, veryLargeTokenAmount);
    await token0.connect(carol).mint(carol.address, amount_for_swap);
    await token1.connect(carol).mint(carol.address, amount_for_swap);
    await router.connect(carol).exactInputSingle(
      {
        tokenIn: token1.address,
        tokenOut: token0.address,
        recipient: alice.address,
        deployer: NULL_ADDRESS,
        deadline: 2000000000, // Wed May 18 2033 03:33:20 GMT+0000
        amountIn: amount_for_swap,
        amountOutMinimum: ethers.utils.parseEther("0"),
        limitSqrtPrice: 0,
      },
      { gasLimit: 30000000 }
    );

    await network.provider.send("evm_mine");
    await network.provider.send("evm_increaseTime", [36000]);
    await algebraVault
      .connect(alice)
      .deposit(amount_for_deposit, 0, alice.address);
    await network.provider.send("evm_mine");
    await network.provider.send("evm_increaseTime", [36000]);

    //await expect(algebraVault.rebalance(-1800, 1800, -600, 0, 0))
    //        .to.emit(algebraVault, "Rebalance");

    algebraVault.rebalance(1800, 3600, -600, 600, 0);

    let token0vault = await token0.balanceOf(algebraVault.address);
    let token1vault = await token1.balanceOf(algebraVault.address);
    let basePositionId = await algebraVault.basePositionId();
    let limitPositionId = await algebraVault.limitPositionId();
    

    expect(token0vault).to.equal(0);
    expect(token1vault).to.equal(0);

    // let limitPositionBefore = await algebraVault.getLimitPosition();
    // console.log(limitPositionBefore);
    // let alice_liq_balance = await algebraVault.balanceOf(alice.address);
    // await (algebraVault.connect(alice).withdraw(alice_liq_balance, alice.address));
    // let token0vault = await token0.balanceOf(algebraVault.address);
    // let token1vault = await token1.balanceOf(algebraVault.address);
    // expect(token0vault).to.equal(0);
    // expect(token1vault).to.equal(0);

    let basePosition = await algebraVault.getBasePosition();
    let limitPosition = await algebraVault.getLimitPosition();
    
    expect(basePosition[0]).to.be.gt(ethers.utils.parseEther("0"));

    expect(limitPosition[0]).to.be.equal(0);
  });

  it("withdraw after deposit and rebalance", async () => {
    let amount_for_swap = ethers.utils.parseEther("10000000");
    let amount_for_deposit = ethers.utils.parseEther("10000");

    await token0.connect(alice).approve(algebraVault.address, largeTokenAmount);
    await token1.connect(alice).approve(algebraVault.address, largeTokenAmount);
    await token0.connect(alice).mint(alice.address, largeTokenAmount);
    await token1.connect(alice).mint(alice.address, largeTokenAmount);
    await algebraVault
      .connect(alice)
      .deposit(amount_for_deposit, 0, alice.address);
    await network.provider.send("evm_mine");
    await network.provider.send("evm_increaseTime", [3600]);

    await token0.connect(carol).approve(router.address, veryLargeTokenAmount);
    await token1.connect(carol).approve(router.address, veryLargeTokenAmount);
    await token0.connect(carol).mint(carol.address, amount_for_swap);
    await token1.connect(carol).mint(carol.address, amount_for_swap);
    // await router.connect(carol).exactInputSingle(
    //   {
    //     tokenIn: token1.address,
    //     tokenOut: token0.address,
    //     recipient: alice.address,
    //     deployer: NULL_ADDRESS,
    //     deadline: 2000000000, // Wed May 18 2033 03:33:20 GMT+0000
    //     amountIn: amount_for_swap,
    //     amountOutMinimum: ethers.utils.parseEther("0"),
    //     limitSqrtPrice: 0,
    //   },
    //   { gasLimit: 30000000 }
    // );

    await network.provider.send("evm_mine");
    await network.provider.send("evm_increaseTime", [36000]);
    await algebraVault
      .connect(alice)
      .deposit(amount_for_deposit, 0, alice.address);
    await network.provider.send("evm_mine");
    await network.provider.send("evm_increaseTime", [36000]);

    //await expect(algebraVault.rebalance(-1800, 1800, -600, 0, 0))
    //        .to.emit(algebraVault, "Rebalance");

    algebraVault.rebalance(1800, 3600, -600, 600, 0);
    await network.provider.send("evm_mine");
    await network.provider.send("evm_increaseTime", [36000]);

    let alice_liq_balance = await algebraVault.balanceOf(alice.address);
    await expect(
      algebraVault.connect(alice).withdraw(alice_liq_balance, alice.address)
    ).to.emit(algebraVault, "Withdraw");
    let token0vault = await token0.balanceOf(algebraVault.address);
    let token1vault = await token1.balanceOf(algebraVault.address);
    expect(token0vault).to.equal(0);
    expect(token1vault).to.equal(0);
  });

  //should be passed
  //1. deposit
  //2. rebalance
  //3. swap
  //4. withdraw
  it("withdraw after deposit and rebalance with swap", async () => {
    let amount_for_swap = ethers.utils.parseEther("10000000");
    let amount_for_deposit = ethers.utils.parseEther("10000");

    await token0.connect(alice).approve(algebraVault.address, largeTokenAmount);
    await token1.connect(alice).approve(algebraVault.address, largeTokenAmount);
    await token0.connect(alice).mint(alice.address, largeTokenAmount);
    await token1.connect(alice).mint(alice.address, largeTokenAmount);
    await algebraVault
      .connect(alice)
      .deposit(amount_for_deposit, 0, alice.address);
    await network.provider.send("evm_mine");
    await network.provider.send("evm_increaseTime", [3600]);

    await token0.connect(carol).approve(router.address, veryLargeTokenAmount);
    await token1.connect(carol).approve(router.address, veryLargeTokenAmount);
    await token0.connect(carol).mint(carol.address, amount_for_swap);
    await token1.connect(carol).mint(carol.address, amount_for_swap);
    await router.connect(carol).exactInputSingle(
      {
        tokenIn: token1.address,
        tokenOut: token0.address,
        recipient: alice.address,
        deployer: NULL_ADDRESS,
        deadline: 2000000000, // Wed May 18 2033 03:33:20 GMT+0000
        amountIn: amount_for_swap,
        amountOutMinimum: ethers.utils.parseEther("0"),
        limitSqrtPrice: 0,
      },
      { gasLimit: 30000000 }
    );
    await network.provider.send("evm_mine");
    await network.provider.send("evm_increaseTime", [36000]);

    let alice_liq_balance = await algebraVault.balanceOf(alice.address);
    await expect(
      algebraVault.connect(alice).withdraw(alice_liq_balance, alice.address)
    ).to.emit(algebraVault, "Withdraw");
    let token0vault = await token0.balanceOf(algebraVault.address);
    let token1vault = await token1.balanceOf(algebraVault.address);
    expect(token0vault).to.equal(0);
    expect(token1vault).to.equal(0);
  });

  it("deposit with deposit guard", async () => {
    await token0.connect(alice).approve(depositGuard.address, largeTokenAmount);
    await token1.connect(alice).approve(depositGuard.address, largeTokenAmount);
    await token0.connect(alice).mint(alice.address, largeTokenAmount);
    await token1.connect(alice).mint(alice.address, largeTokenAmount);
    await depositGuard
      .connect(alice)
      .forwardDepositToAlgebraVault(
        algebraVault.address,
        wallet.address,
        token0.address,
        smallTokenAmount,
        0,
        alice.address
      );
  });

  it("deposit with deposit guard with native deposit", async () => {
    
    await depositGuard
      .connect(alice)
      .forwardNativeDepositToAlgebraVault(
        algebraVault.address,
        wallet.address,
        0,
        alice.address,
        { value: ethers.utils.parseEther("1"), gasLimit: 30000000 }
      );
    let alice_liq_balance = await algebraVault.balanceOf(alice.address);
    expect(alice_liq_balance).to.gt(0);
  });

  //should be reverted
  //because only accept ETH via fallback from the WRAPPED_NATIVE contract
  it("native deposit with deposit guard", async () => {
    await expect(
      alice.sendTransaction({
        to: depositGuard.address,
        value: ethers.utils.parseEther("1"),
        gasLimit: 30000000,
      })
    ).to.be.reverted;
  });

  it("deposit guard -- forward withdraw from algebra vault", async () => {
    await token0.connect(alice).approve(depositGuard.address, largeTokenAmount);
    await token0.connect(alice).mint(alice.address, largeTokenAmount);
    await depositGuard
      .connect(alice)
      .forwardDepositToAlgebraVault(
        algebraVault.address,
        wallet.address,
        token0.address,
        smallTokenAmount,
        0,
        alice.address
      );
    let alice_liq_balance = await algebraVault.balanceOf(alice.address);
    await algebraVault
      .connect(alice)
      .approve(depositGuard.address, alice_liq_balance);
    await depositGuard
      .connect(alice)
      .forwardWithdrawFromAlgebraVault(
        algebraVault.address,
        wallet.address,
        alice_liq_balance,
        alice.address,
        0,
        0
      );
    alice_liq_balance = await algebraVault.balanceOf(alice.address);
    expect(alice_liq_balance).to.equal(0);
  });

  it("withdraw with deposit guard with native withdraw", async () => {
    await depositGuard
      .connect(alice)
      .forwardNativeDepositToAlgebraVault(
        algebraVault.address,
        wallet.address,
        0,
        alice.address,
        { value: ethers.utils.parseEther("1") }
      );
    let alice_liq_balance = await algebraVault.balanceOf(alice.address);
    expect(alice_liq_balance).to.be.gt(0);
    await algebraVault
      .connect(alice)
      .approve(depositGuard.address, alice_liq_balance);

    await depositGuard
      .connect(alice)
      .forwardNativeWithdrawFromAlgebraVault(
        algebraVault.address,
        wallet.address,
        alice_liq_balance,
        alice.address,
        0,
        0
      );

    alice_liq_balance = await algebraVault.balanceOf(alice.address);

    expect(alice_liq_balance).to.equal(0);
  });

  it("deposit guard -- deposit and withdraw native after rebalance", async () => {
    await depositGuard
      .connect(alice)
      .forwardNativeDepositToAlgebraVault(
        algebraVault.address,
        wallet.address,
        0,
        alice.address,
        { value: ethers.utils.parseEther("1") }
      );
    let alice_liq_balance = await algebraVault.balanceOf(alice.address);

    algebraVault.rebalance(1800, 3600, -600, 600, 0);
    await algebraVault
      .connect(alice)
      .approve(depositGuard.address, alice_liq_balance);
    await expect(
      depositGuard
        .connect(alice)
        .forwardNativeWithdrawFromAlgebraVault(
          algebraVault.address,
          wallet.address,
          alice_liq_balance,
          alice.address,
          0,
          0
        )
    ).to.emit(token0, "Withdraw");
    alice_liq_balance = await algebraVault.balanceOf(alice.address);
    expect(alice_liq_balance).to.equal(0);
  });

  it("Deposit guard - deposit token if this token not allowed", async () => {
    await token1.mint(alice.address, smallTokenAmount);
    await token1.connect(alice).approve(depositGuard.address, smallTokenAmount);
    await expect(
      depositGuard
        .connect(alice)
        .forwardDepositToAlgebraVault(
          algebraVault.address,
          wallet.address,
          token1.address,
          smallTokenAmount,
          0,
          alice.address
        )
    ).to.be.reverted;
  });

  it("DepositGuard - deposit another token", async () => {
    await token2.mint(alice.address, smallTokenAmount);
    await token2.connect(alice).approve(depositGuard.address, smallTokenAmount);
    await expect(
      depositGuard
        .connect(alice)
        .forwardDepositToAlgebraVault(
          algebraVault.address,
          wallet.address,
          token2.address,
          smallTokenAmount,
          0,
          alice.address
        )
    ).to.be.revertedWith("Invalid token");
  });

  it("deposit after set DepositMax==0", async () => {
    await algebraVault.connect(wallet).setDepositMax(0, 0);
    await token0.connect(alice).mint(alice.address, largeTokenAmount);
    await token0.connect(alice).approve(algebraVault.address, largeTokenAmount);
    await expect(
      algebraVault.connect(alice).deposit(smallTokenAmount, 0, alice.address)
    ).to.be.reverted;

    await token0.connect(alice).approve(depositGuard.address, largeTokenAmount);
    await expect(
      depositGuard
        .connect(alice)
        .forwardDepositToAlgebraVault(
          algebraVault.address,
          wallet.address,
          token0.address,
          smallTokenAmount,
          0,
          alice.address
        )
    ).to.be.reverted;

    await expect(
      depositGuard
        .connect(alice)
        .forwardNativeDepositToAlgebraVault(
          algebraVault.address,
          wallet.address,
          0,
          alice.address,
          { value: ethers.utils.parseEther("1") }
        )
    ).to.be.reverted;
  });

  // shoule be reverted with InvalidDeposit
  // because pool is locked
  it("deposit from one with flashloan", async () => {
    const poolDeployer = await factory.poolDeployer();
    const pairFlashFactory = await ethers.getContractFactory("PairFlash");
    const pairFlash = (await pairFlashFactory.deploy(
      factory.address,
      poolDeployer,
      algebraVault.address // используем factory как poolDeployer для простоты
    )) as PairFlash;

    await token0.connect(alice).approve(depositGuard.address, largeTokenAmount);
    await token1.connect(alice).approve(depositGuard.address, largeTokenAmount);
    await token0.connect(alice).mint(alice.address, largeTokenAmount);
    await token1.connect(alice).mint(alice.address, largeTokenAmount);
    await token0.connect(alice).mint(pairFlash.address, largeTokenAmount);
    await token1.connect(alice).mint(pairFlash.address, largeTokenAmount);
    const flashAmount0 = ethers.utils.parseEther("0.1");
    const flashAmount1 = ethers.utils.parseEther("0.1");
    const computedPool = await factory.computePoolAddress(
      token0.address,
      token1.address
    );

    const pool = await pairFlash.getPool(token0.address, token1.address);
    

    
    await expect(
      pairFlash.connect(alice).initFlash({
        token0: token0.address,
        token1: token1.address,
        deployer: poolDeployer,
        amount0: flashAmount0,
        amount1: flashAmount1,
      })
    ).to.revertedWithCustomError(algebraVault, "InvalidDeposit");
  });

  it("Withdraw to vault address", async () => {
    await token0.connect(alice).mint(alice.address, veryLargeTokenAmount);
    await token0
      .connect(alice)
      .approve(algebraVault.address, veryLargeTokenAmount);

    await algebraVault
      .connect(alice)
      .deposit(smallTokenAmount, 0, alice.address);

    await token0.connect(bob).mint(bob.address, veryLargeTokenAmount);
    await token0
      .connect(bob)
      .approve(algebraVault.address, veryLargeTokenAmount);

    await algebraVault.connect(bob).deposit(smallTokenAmount, 0, bob.address);

    let alice_liq_balance = algebraVault.balanceOf(alice.address);
    let bob_liq_balance = algebraVault.balanceOf(bob.address);

    await algebraVault
      .connect(alice)
      .withdraw(alice_liq_balance, algebraVault.address);

    await algebraVault.connect(bob).withdraw(bob_liq_balance, bob.address);
  });

  it("Collected fees", async () => {
    await token1.connect(alice).mint(algebraVault.address, smallTokenAmount);
    await token0.connect(alice).mint(alice.address, veryLargeTokenAmount);
    
    
    await algebraVaultFactory.connect(wallet).setAmmFee(ethers.utils.parseEther("0.1"));
    await algebraVault.connect(wallet).setAmmFeeRecipient(alice.address);
    await token0
      .connect(alice)
      .approve(algebraVault.address, veryLargeTokenAmount);
    await algebraVault
      .connect(alice)
      .deposit(smallTokenAmount, 0, alice.address);

    await algebraVault.rebalance(-600, 600, -1800, 3600, 0);
    await token0.connect(carol).mint(carol.address, veryLargeTokenAmount);
    await token0.connect(carol).approve(router.address, veryLargeTokenAmount);
    await router.connect(carol).exactInputSingle(
      {
        tokenIn: token0.address,
        tokenOut: token1.address,
        recipient: alice.address,
        deployer: NULL_ADDRESS,
        deadline: 2000000000, // Wed May 18 2033 03:33:20 GMT+0000
        amountIn: largeTokenAmount,
        amountOutMinimum: ethers.utils.parseEther("0"),
        limitSqrtPrice: 0,
      },
      { gasLimit: 30000000 }
    );

    await token1.mint(carol.address, giantTokenAmount);
    await token1.connect(carol).approve(router.address, giantTokenAmount);
    await router.connect(carol).exactInputSingle(
      {
        tokenIn: token1.address,
        tokenOut: token0.address,
        recipient: alice.address,
        deployer: NULL_ADDRESS,
        deadline: 2000000000, // Wed May 18 2033 03:33:20 GMT+0000
        amountIn: largeTokenAmount,
        amountOutMinimum: ethers.utils.parseEther("0"),
        limitSqrtPrice: 0,
      },
      { gasLimit: 30000000 }
    );

    
    let fees= await algebraVault.connect(alice).callStatic.collectFees();
    
    await algebraVault.connect(alice).collectFees();
    let alice_liq_balance = algebraVault.balanceOf(alice.address);
    await algebraVault
      .connect(alice)
      .withdraw(alice_liq_balance, alice.address);

  });

  it("Deposit from two accounts and Collect fees", async () => {
    await token1.connect(alice).mint(algebraVault.address, smallTokenAmount);
    await token0.connect(alice).mint(alice.address, veryLargeTokenAmount);
    await token0
      .connect(alice)
      .approve(algebraVault.address, veryLargeTokenAmount);
    await algebraVault
      .connect(alice)
      .deposit(ethers.utils.parseEther("0.001"), 0, alice.address);

    await token0.connect(bob).mint(bob.address, veryLargeTokenAmount);
    await token0
      .connect(bob)
      .approve(algebraVault.address, veryLargeTokenAmount);
    await algebraVault
      .connect(bob)
      .deposit(ethers.utils.parseEther("0.001"), 0, bob.address);

    await token0.connect(carol).mint(carol.address, veryLargeTokenAmount);
    await token0
      .connect(carol)
      .approve(algebraVault.address, veryLargeTokenAmount);
    await algebraVault
      .connect(carol)
      .deposit(ethers.utils.parseEther("0.001"), 0, carol.address);

    await algebraVault.rebalance(-60, 60, -600, 600, 0);

    await token0.connect(carol).mint(carol.address, veryLargeTokenAmount);
    await token0.connect(carol).approve(router.address, veryLargeTokenAmount);
    await router.connect(carol).exactInputSingle(
      {
        tokenIn: token0.address,
        tokenOut: token1.address,
        recipient: alice.address,
        deployer: NULL_ADDRESS,
        deadline: 2000000000, // Wed May 18 2033 03:33:20 GMT+0000
        amountIn: smallTokenAmount,
        amountOutMinimum: ethers.utils.parseEther("0"),
        limitSqrtPrice: 0,
      },
      { gasLimit: 30000000 }
    );
    
    await algebraVault.connect(alice).collectFees();
    let alice_liq_balance = algebraVault.balanceOf(alice.address);
    const [amount0_alice, amount1_alice] = await algebraVault
      .connect(alice)
      .callStatic.withdraw(alice_liq_balance, alice.address);

    await algebraVault
      .connect(alice)
      .withdraw(alice_liq_balance, alice.address);
    let bob_liq_balance = algebraVault.balanceOf(bob.address);
    const [amount0_bob, amount1_bob] = await algebraVault
      .connect(bob)
      .callStatic.withdraw(bob_liq_balance, bob.address);
    

    await algebraVault.connect(bob).withdraw(bob_liq_balance, bob.address);
  });

  it("deposit after tranfer token1 to vault", async () => {
    //despoit Alice
    await token0.connect(alice).mint(alice.address, veryLargeTokenAmount);
    let token0_alice_balance = await token0.balanceOf(alice.address);
    await token0
      .connect(alice)
      .approve(algebraVault.address, veryLargeTokenAmount);

    await algebraVault
      .connect(alice)
      .deposit(ethers.utils.parseEther("0.001"), 0, alice.address);
    let alice_liq_balance = await algebraVault.balanceOf(alice.address);

    //deposit Bob
    await token0.connect(bob).mint(bob.address, veryLargeTokenAmount);
    await token0
      .connect(bob)
      .approve(algebraVault.address, veryLargeTokenAmount);
    await algebraVault
      .connect(bob)
      .deposit(ethers.utils.parseEther("0.001"), 0, bob.address);
    let bob_liq_balance = await algebraVault.balanceOf(bob.address);
    

    //Mint token
    await token1.mint(algebraVault.address, ethers.utils.parseEther("0.001"));
    // await algebraVault
    //   .connect(alice)
    //   .withdraw(alice_liq_balance, alice.address);
    let token0_alice_balance_after = await token0.balanceOf(alice.address);

    
    await algebraVault.connect(bob).withdraw(bob_liq_balance, bob.address);
    let token0_bob_balance_after_withdraw = await token0.balanceOf(bob.address);
    
    await token0.connect(carol).mint(carol.address, veryLargeTokenAmount);
    await token0
      .connect(carol)
      .approve(algebraVault.address, veryLargeTokenAmount);
    await algebraVault
      .connect(carol)
      .deposit(ethers.utils.parseEther("0.001"), 0, carol.address);
    let carol_liq_balance = await algebraVault.balanceOf(carol.address);
    

    await algebraVault
      .connect(carol)
      .withdraw(carol_liq_balance, carol.address);
    let carol_tokn0_balance_after = await token0.balanceOf(carol.address);
    
  });

  it("Delta balances after withdrowal", async () => {
    await token0.mint(alice.address, veryLargeTokenAmount);
    await token0.mint(bob.address, veryLargeTokenAmount);

    await token0
      .connect(alice)
      .approve(algebraVault.address, veryLargeTokenAmount);
    await token0
      .connect(bob)
      .approve(algebraVault.address, veryLargeTokenAmount);

    await token0.mint(algebraVault.address, smallTokenAmount);
    //Deposit Alice
    await algebraVault
      .connect(alice)
      .deposit(smallTokenAmount, 0, alice.address);
    let alice_liq_balance = await algebraVault.balanceOf(alice.address);
    //Mint to Vault

    //Deposit Bob
    await algebraVault.connect(bob).deposit(smallTokenAmount, 0, bob.address);
    let bob_liq_balance = await algebraVault.balanceOf(bob.address);

    //Balances before Withdraw
    let aliceToken0BalanceBefore = await token0.balanceOf(alice.address);
    let bobToken0BalanceBefore = await token0.balanceOf(bob.address);

    //withdraws
    await algebraVault
      .connect(alice)
      .withdraw(alice_liq_balance, alice.address);
    await algebraVault.connect(bob).withdraw(bob_liq_balance, bob.address);

    //Balances after Withdraw
    let aliceToken0BalanceAfter = await token0.balanceOf(alice.address);
    let bobToken0BalanceAfter = await token0.balanceOf(bob.address);

    let aliceDelta = aliceToken0BalanceAfter.sub(aliceToken0BalanceBefore);
    let bobDelta = bobToken0BalanceAfter.sub(bobToken0BalanceBefore);

    alice_liq_balance = await algebraVault.balanceOf(alice.address);
  });
  it("check Lp balance", async () => {
    await token0.mint(alice.address, veryLargeTokenAmount);
    await token0.mint(bob.address, smallTokenAmount);
    await token0.mint(carol.address, smallTokenAmount);

    await token0
      .connect(alice)
      .approve(algebraVault.address, veryLargeTokenAmount);
    await token0
      .connect(bob)
      .approve(algebraVault.address, veryLargeTokenAmount);
    await token0
      .connect(carol)
      .approve(algebraVault.address, veryLargeTokenAmount);

    await algebraVault
      .connect(alice)
      .deposit(smallTokenAmount, 0, alice.address);
    await algebraVault.connect(bob).deposit(smallTokenAmount, 0, bob.address);
    await token0.mint(algebraVault.address, smallTokenAmount);
    await algebraVault
      .connect(carol)
      .deposit(smallTokenAmount, 0, carol.address);

    let alice_liq_balance = await algebraVault.balanceOf(alice.address);
    let bob_liq_balance = await algebraVault.balanceOf(bob.address);
    let carol_liq_balance = await algebraVault.balanceOf(carol.address);

   
  });

  it("check baseLower",async () => {
    
    await token0.mint(alice.address, veryLargeTokenAmount);
    await token0.connect(alice).approve(algebraVault.address, veryLargeTokenAmount);
    await algebraVault.connect(alice).deposit(smallTokenAmount, 0, alice.address);
    await expect(algebraVault.connect(wallet).rebalance(1800, 3600, -600, 600, 0)).to.emit(algebraPool, "Mint");
    let baseLower = await algebraVault.baseLower();
    
  });
  it("check baseUpper",async () => {
    await token0.mint(alice.address, veryLargeTokenAmount);
    await token0.connect(alice).approve(algebraVault.address, veryLargeTokenAmount);
    await algebraVault.connect(alice).deposit(smallTokenAmount, 0, alice.address);
    await expect(algebraVault.connect(wallet).rebalance(1800, 3600, -600, 600, 0)).to.emit(algebraPool, "Mint");
    let baseUpper = await algebraVault.baseUpper();
    
  });
  it("check limitPosition",async () => {
    await token0.mint(algebraVault.address, veryLargeTokenAmount);
    await token1.mint(algebraVault.address,veryLargeTokenAmount);
    await token0.mint(alice.address, veryLargeTokenAmount);
    await token0.connect(alice).approve(algebraVault.address, veryLargeTokenAmount);
    await algebraVault.connect(alice).deposit(smallTokenAmount, 0, alice.address);
    await expect(algebraVault.connect(wallet).rebalance(1800, 3600, -3600, -1800, 0)).to.emit(algebraPool, "Mint");
    let limitUpper = await algebraVault.limitUpper();
    let limitLower = await algebraVault.limitLower();
 
  });

  it("check setAuxTwapPeriod",async () => {
    await expect(algebraVault.connect(wallet).setAuxTwapPeriod(100)).to.emit(algebraVault, "SetAuxTwapPeriod");
  });
  it("check hysteresis",async () => {
    let hysteresis = await algebraVault.hysteresis();
    
  });
  
  it("check change rebalance manager",async () => {
    await expect(algebraVault.connect(wallet).setRebalanceManager(alice.address)).to.emit(algebraVault, "RebalanceManager");
  });
  it("check setHysteresis", async()=>{
    await expect(algebraVault.connect(wallet).setHysteresis(1)).to.emit(algebraVault, "Hysteresis");
    await token0.mint(alice.address, giantTokenAmount);
    await token0.connect(alice).approve(algebraVault.address, giantTokenAmount);
    await algebraVault.connect(wallet).setDepositMax(giantTokenAmount,giantTokenAmount);

    await token0.mint(carol.address, giantTokenAmount);
    await token0.connect(carol).approve(router.address, giantTokenAmount);

    await network.provider.send("evm_setAutomine", [false]);
    const txSwap = await router.connect(carol).exactInputSingle(
      {
        tokenIn: token0.address,
        tokenOut: token1.address,
        recipient: carol.address,
        deployer: NULL_ADDRESS,
        deadline: 2000000000, // Wed May 18 2033 03:33:20 GMT+0000
        amountIn: largeTokenAmount,
        amountOutMinimum: ethers.utils.parseEther("0"),
        limitSqrtPrice: 0,
      },
      { gasLimit: 30000000 }
    );
    
    
    const txDeposit = await algebraVault.connect(alice).deposit(largeTokenAmount,0,alice.address);
    await network.provider.send("evm_mine");
    

    try{
      await txDeposit.wait();
      throw new Error("Expected transaction to revert");
    } catch (error) {
      expect(error.code).to.equal("CALL_EXCEPTION");
      if (error.reason) {
        expect(error.reason).to.include("transaction failed");
      }
    };
    await network.provider.send("evm_setAutomine", [true]);

  });

  it("check Hysteresis and auxTWAP=0", async()=>{
    await expect(algebraVault.connect(wallet).setHysteresis(1)).to.emit(algebraVault, "Hysteresis");
    await expect(algebraVault.connect(wallet).setAuxTwapPeriod(0)).to.emit(algebraVault,"SetAuxTwapPeriod");
    await token0.mint(alice.address, giantTokenAmount);
    await token0.connect(alice).approve(algebraVault.address, giantTokenAmount);
    await algebraVault.connect(wallet).setDepositMax(giantTokenAmount,giantTokenAmount);

    await token0.mint(carol.address, giantTokenAmount);
    await token0.connect(carol).approve(router.address, giantTokenAmount);

    await network.provider.send("evm_setAutomine", [false]);
    const txSwap = await router.connect(carol).exactInputSingle(
      {
        tokenIn: token0.address,
        tokenOut: token1.address,
        recipient: carol.address,
        deployer: NULL_ADDRESS,
        deadline: 2000000000, // Wed May 18 2033 03:33:20 GMT+0000
        amountIn: largeTokenAmount,
        amountOutMinimum: ethers.utils.parseEther("0"),
        limitSqrtPrice: 0,
      },
      { gasLimit: 30000000 }
    );
    
    
    const txDeposit = await algebraVault.connect(alice).deposit(largeTokenAmount,0,alice.address);
    await network.provider.send("evm_mine");
    

    try{
      await txDeposit.wait();
      throw new Error("Expected transaction to revert");
    } catch (error) {
      expect(error.code).to.equal("CALL_EXCEPTION");
      if (error.reason) {
        expect(error.reason).to.include("transaction failed");
      }
    };
    await network.provider.send("evm_setAutomine", [true]);

  });

  // it("check algebraSwapCallback",async () => {
  //   await algebraVault.connect(algebraPool).algebraSwapCallback(-1, 10, "0x");
  // });

  it("check factory: setAmmFee",async () => {
    await expect(algebraVaultFactory.connect(alice).setAmmFee(ethers.utils.parseEther("0.001"))).to.be.reverted;
    await expect(algebraVaultFactory.connect(wallet).setAmmFee(ethers.utils.parseEther("10"))).to.be.reverted;
    await expect(algebraVaultFactory.connect(wallet).setAmmFee(ethers.utils.parseEther("0.001"))).to.emit(algebraVaultFactory, "AmmFee");

  });
  it("check factory: setBaseFee",async () => {
    await expect(algebraVaultFactory.connect(alice).setBaseFee(ethers.utils.parseEther("0.001"))).to.be.reverted;
    await expect(algebraVaultFactory.connect(wallet).setBaseFee(ethers.utils.parseEther("10"))).to.be.reverted;
    await expect(algebraVaultFactory.connect(wallet).setBaseFee(ethers.utils.parseEther("0.001"))).to.emit(algebraVaultFactory, "BaseFee");
  });
  it("check factory: setBaseFeeSplit",async () => {
    await expect(algebraVaultFactory.connect(alice).setBaseFeeSplit(ethers.utils.parseEther("0.001"))).to.be.reverted;
    await expect(algebraVaultFactory.connect(wallet).setBaseFeeSplit(ethers.utils.parseEther("10"))).to.be.reverted;
    await expect(algebraVaultFactory.connect(wallet).setBaseFeeSplit(ethers.utils.parseEther("0.001"))).to.emit(algebraVaultFactory, "BaseFeeSplit");
  });
  it("check createAlgebraVault",async()=>{
    await expect(algebraVaultFactory.connect(alice).createAlgebraVault(token0.address,true, token1.address,false)).to.be.reverted;

  });
});

describe("AlgebraVault General Functionality (allowed token1)", () => {
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
  let depositGuard: AlgebraVaultDepositGuard;
  let depositGuardToken1: AlgebraVaultDepositGuard;
  let algebraVault: AlgebraVault;

  before("create fixture loader", async () => {
    [wallet, alice, bob, carol, other, user0, user1, user2, user3, user4] =
      await ethers.getSigners();
  });

    beforeEach("deploy contracts", async () => {
        ({
            token0,
            token1,
            token2,
            factory,
            router,
            nft,
            oracle,
            algebraVaultFactory,
            depositGuard,
            depositGuardToken1,
        } = await loadFixture(algebraVaultTestFixture));
        
        await algebraVaultFactory.setFeeRecipient(alice.address);
        await algebraVaultFactory.connect(wallet).setFeeRecipient(other.address);

        await factory.createPool(token0.address, token1.address, "0x");
        const poolAddress = await factory.poolByPair(
            token0.address,
            token1.address
        );
        algebraPool = (await ethers.getContractAt(
            "IAlgebraPool",
            poolAddress
        )) as IAlgebraPool;
        await algebraPool.initialize(encodePriceSqrt("1", "1"));

        await algebraVaultFactory.connect(wallet).setAmmFee(100);
        await algebraVaultFactory
            .connect(wallet)
            .createAlgebraVault(token0.address, false, token1.address, true);

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

        const vaultKey = await algebraVaultFactory.genKey(
            wallet.address,
            token0.address,
            token1.address,
            false,
            true
        );
        const algebraVaultAddress = await algebraVaultFactory.getAlgebraVault(
            vaultKey
        );
        algebraVault = (await ethers.getContractAt(
            "AlgebraVault",
            algebraVaultAddress
        )) as AlgebraVault;
        await algebraVault.connect(wallet).setAffiliate(bob.address);
        

        await algebraVault
            .connect(wallet)
            .setDepositMax(
                ethers.utils.parseEther("100000"),
                ethers.utils.parseEther("100000")
            );
    });

    it("deposit and withdraw token1 if allowed token1", async () => {
      let wrappedNative = await depositGuardToken1.WRAPPED_NATIVE();
      await expect(wrappedNative).to.be.equal(token1.address);
      await token1.connect(alice).approve(wrappedNative, smallTokenAmount);
      await expect(depositGuardToken1.connect(alice).forwardNativeDepositToAlgebraVault(
        algebraVault.address,
        wallet.address,
        0,
        alice.address,
        { value: ethers.utils.parseEther("1"), gasLimit: 30000000 }
      )).to.emit(depositGuardToken1, "DepositForwarded");

      await token0.mint(carol.address, giantTokenAmount);
      await token1.mint(carol.address, giantTokenAmount);
      await token0.connect(carol).approve(router.address, giantTokenAmount);
      await token1.connect(carol).approve(router.address, giantTokenAmount);
      await router.connect(carol).exactInputSingle(
        {
          tokenIn: token0.address,
          tokenOut: token1.address,
          recipient: carol.address,
          deployer: NULL_ADDRESS,
          deadline: 2000000000,
          amountIn: ethers.utils.parseEther("0.0001"),
          amountOutMinimum: 0,
          limitSqrtPrice: 0,
        },
        { gasLimit: 30000000 }
      );
      await router.connect(carol).exactInputSingle(
        {
          tokenIn: token1.address,
          tokenOut: token0.address,
          recipient: carol.address,
          deployer: NULL_ADDRESS,
          deadline: 2000000000,
          amountIn: ethers.utils.parseEther("0.0001"),
          amountOutMinimum: 0,
          limitSqrtPrice: 0,
        },
        { gasLimit: 30000000 }
      );

      let alice_liq_balance = await algebraVault.balanceOf(alice.address);
      await algebraVault.connect(alice).approve(depositGuardToken1.address, alice_liq_balance);
      await expect(depositGuardToken1.connect(alice).forwardNativeWithdrawFromAlgebraVault(
        algebraVault.address,
        wallet.address,
        alice_liq_balance,
        alice.address,
        0,
        0
      )
    ).to.emit(algebraVault, "Withdraw");
    });
    
  });


import { PairFlash } from "../types/contracts/mocks/TestFlashloan.sol/PairFlash";
import {
  IAlgebraFactory,
  IAlgebraPool,
  AlgebraVaultStable,
  AlgebraVaultStableFactory,
  INonfungiblePositionManager,
  ISwapRouter,
  TestERC20,
  TestOracle,
  AlgebraVaultStableDepositGuard,
} from "../types";
import { algebraVaultStableTestFixture } from "./shared/fixtures";
import {
  FeeAmount,
  TICK_SPACINGS,
  encodePriceSqrt,
  getMaxTick,
  getMinTick,
} from "./shared/utilities";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network } from "hardhat";

const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";
const PERCENT_100 = "1000000000000000000";
const PERCENT_50 = "500000000000000000";
const PERCENT_40 = "400000000000000000";
const PERCENT_20 = "200000000000000000";
const PERCENT_10 = "100000000000000000";

const MIN_SHARES = 1000;

const smallTokenAmount = ethers.parseEther("1000");
const largeTokenAmount = ethers.parseEther("1000000");
const veryLargeTokenAmount = ethers.parseEther("10000000000");
const giantTokenAmount = ethers.parseEther("1000000000000");

describe("AlgebraVaultStable General Functionality", () => {
  let wallet: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let carol: HardhatEthersSigner;
  let other: HardhatEthersSigner;
  let user0: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let user3: HardhatEthersSigner;
  let user4: HardhatEthersSigner;

  let factory: IAlgebraFactory;
  let router: ISwapRouter;
  let nft: INonfungiblePositionManager;
  let oracle: TestOracle;
  let token0: TestERC20;
  let token1: TestERC20;
  let token2: TestERC20;
  let algebraPool: IAlgebraPool;
  let algebraVaultStableFactory: AlgebraVaultStableFactory;
  let depositGuardStable: AlgebraVaultStableDepositGuard;
  let algebraVaultStable: AlgebraVaultStable;

  before("create fixture loader", async () => {
    [wallet, alice, bob, carol, other, user0, user1, user2, user3, user4] =
      await (ethers as any).getSigners();
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
      algebraVaultStableFactory,
      depositGuardStable,
    } = await loadFixture(algebraVaultStableTestFixture));
   
    await algebraVaultStableFactory.connect(wallet).setFeeRecipient(await other.getAddress());

    await factory.createPool(await token0.getAddress(), await token1.getAddress(), "0x");
    const poolAddress = await factory.poolByPair(
      await token0.getAddress(),
      await token1.getAddress()
    );
    algebraPool = (await ethers.getContractAt(
      "IAlgebraPool",
      poolAddress
    )) as IAlgebraPool;
    await algebraPool.initialize(encodePriceSqrt("1", "1"));

    await algebraVaultStableFactory
      .connect(wallet)
      .createAlgebraVaultStable(await token0.getAddress(), await token1.getAddress());

    // adding extra liquidity into pool to make sure there's always
    // someone to swap with
    await token0.mint(await carol.getAddress(), giantTokenAmount);
    await token1.mint(await carol.getAddress(), giantTokenAmount);

    

    await token0.connect(carol).approve(await nft.getAddress(), veryLargeTokenAmount);
    await token1.connect(carol).approve(await nft.getAddress(), veryLargeTokenAmount);

    await nft.connect(carol).mint({
      token0: await token0.getAddress(),
      token1: await token1.getAddress(),
      deployer: NULL_ADDRESS,
      tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
      tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
      recipient: await carol.getAddress(),
      amount0Desired: veryLargeTokenAmount,
      amount1Desired: veryLargeTokenAmount,
      amount0Min: 0,
      amount1Min: 0,
      deadline: 2000000000,
    });

    await network.provider.send("evm_increaseTime", [3600]);

    const vaultKey = await algebraVaultStableFactory.genKey(
      await wallet.getAddress(),
      await token0.getAddress(),
      await token1.getAddress()
    );
    const algebraVaultStableAddress = await algebraVaultStableFactory.getAlgebraVaultStable(
      vaultKey
    );
    algebraVaultStable = (await ethers.getContractAt(
      "AlgebraVaultStable",
      algebraVaultStableAddress
    )) as AlgebraVaultStable;
    await algebraVaultStable.connect(wallet).setAffiliate(await bob.getAddress());
    

    await algebraVaultStable
      .connect(wallet)
      .setDepositMax(
        ethers.parseEther("100000"),
        ethers.parseEther("100000")
      );
  });

  // Should be reverted because of zero amount
  it("deposit with zero amount", async () => {
    await expect(algebraVaultStable.connect(alice).deposit(0, 0, await alice.getAddress())).to.be
      .reverted;
    await expect(algebraVaultStable.connect(alice).deposit(0, 0, await alice.getAddress())).to.be
      .reverted;
  });

  // should be passed,
  // balance token0 in vault should be equal to smallTokenAmount
  it("deposit from only Alice account", async () => {
    await token0.connect(alice).approve(await algebraVaultStable.getAddress(), largeTokenAmount);
    await token1.connect(alice).approve(await algebraVaultStable.getAddress(), largeTokenAmount);
    await token0.connect(alice).mint(await alice.getAddress(), largeTokenAmount);
    await token1.connect(alice).mint(await alice.getAddress(), largeTokenAmount);

    await algebraVaultStable
      .connect(alice)
      .deposit(smallTokenAmount, 0, await alice.getAddress());
    let token0vault = await token0.balanceOf(await algebraVaultStable.getAddress());
    let token1vault = await token1.balanceOf(await algebraVaultStable.getAddress());
    expect(token0vault).to.equal(smallTokenAmount);
    expect(token1vault).to.equal(0);
  });

  it("deposit and withdraw", async () => {
    await token0.connect(alice).approve(await algebraVaultStable.getAddress(), largeTokenAmount);
    await token1.connect(alice).approve(await algebraVaultStable.getAddress(), largeTokenAmount);
    await token0.connect(alice).mint(await alice.getAddress(), largeTokenAmount);
    await token1.connect(alice).mint(await alice.getAddress(), largeTokenAmount);

    await algebraVaultStable
      .connect(alice)
      .deposit(smallTokenAmount, 0, await alice.getAddress());
    let alice_liq_balance = await algebraVaultStable.balanceOf(await alice.getAddress());
    await algebraVaultStable
      .connect(alice)
      .withdraw(alice_liq_balance, await alice.getAddress());
    let token0vault = await token0.balanceOf(await algebraVaultStable.getAddress());
    let token1vault = await token1.balanceOf(await algebraVaultStable.getAddress());
    expect(token0vault).to.equal(0);
    expect(token1vault).to.equal(0);
  });

  // Should pass - multiple users deposit and withdraw
  it("multiple users deposit and withdraw", async () => {
    // alice deposit
    await token0.connect(alice).approve(await algebraVaultStable.getAddress(), largeTokenAmount);
    await token1.connect(alice).approve(await algebraVaultStable.getAddress(), largeTokenAmount);
    await token0.connect(alice).mint(await alice.getAddress(), smallTokenAmount);
    await token1.connect(alice).mint(await alice.getAddress(), smallTokenAmount);
    await algebraVaultStable
      .connect(alice)
      .deposit(smallTokenAmount, 0, await alice.getAddress());

    // bob deposit
    await token0.connect(bob).approve(await algebraVaultStable.getAddress(), largeTokenAmount);
    await token1.connect(bob).approve(await algebraVaultStable.getAddress(), largeTokenAmount);
    await token0.connect(bob).mint(await bob.getAddress(), smallTokenAmount);
    await token1.connect(bob).mint(await bob.getAddress(), smallTokenAmount);
    await algebraVaultStable.connect(bob).deposit(smallTokenAmount, 0, await bob.getAddress());

    //actual balances after deposits
    let vault_balance_after_deposits = await algebraVaultStable.getTotalAmounts();

    //alice withdraw
    let alice_liq_balance = await algebraVaultStable.balanceOf(await alice.getAddress());
    await algebraVaultStable
      .connect(alice)
      .withdraw(alice_liq_balance, await alice.getAddress());
    let token0vault = await token0.balanceOf(await algebraVaultStable.getAddress());
    let token1vault = await token1.balanceOf(await algebraVaultStable.getAddress());
    
    expect(token0vault).to.equal(
      vault_balance_after_deposits[0] - smallTokenAmount
    );

    //bob withdraw
    let bob_liq_balance = await algebraVaultStable.balanceOf(await bob.getAddress());
    await algebraVaultStable.connect(bob).withdraw(bob_liq_balance, await bob.getAddress());
    token0vault = await token0.balanceOf(await algebraVaultStable.getAddress());
    token1vault = await token1.balanceOf(await algebraVaultStable.getAddress());
    expect(token0vault).to.equal(0);
    expect(token1vault).to.equal(0);
  });

  it("multiple users deposit with different amounts", async () => {
    let alice_deposit_amount = ethers.parseEther("1000");
    let bob_deposit_amount = ethers.parseEther("2000");
    let carol_deposit_amount = ethers.parseEther("4000");

    //alice deposit
    await token0.connect(alice).approve(await algebraVaultStable.getAddress(), largeTokenAmount);
    await token1.connect(alice).approve(await algebraVaultStable.getAddress(), largeTokenAmount);
    await token0.connect(alice).mint(await alice.getAddress(), alice_deposit_amount);
    await token1.connect(alice).mint(await alice.getAddress(), alice_deposit_amount);
    await algebraVaultStable
      .connect(alice)
      .deposit(alice_deposit_amount, 0, await alice.getAddress());
    //bob deposit
    await token0.connect(bob).approve(await algebraVaultStable.getAddress(), largeTokenAmount);
    await token1.connect(bob).approve(await algebraVaultStable.getAddress(), largeTokenAmount);
    await token0.connect(bob).mint(await bob.getAddress(), bob_deposit_amount);
    await token1.connect(bob).mint(await bob.getAddress(), bob_deposit_amount);
    await algebraVaultStable.connect(bob).deposit(bob_deposit_amount, 0, await bob.getAddress());

    //carol deposit
    await token0.connect(carol).approve(await algebraVaultStable.getAddress(), largeTokenAmount);
    await token1.connect(carol).approve(await algebraVaultStable.getAddress(), largeTokenAmount);
    await token0.connect(carol).mint(await carol.getAddress(), carol_deposit_amount);
    await token1.connect(carol).mint(await carol.getAddress(), carol_deposit_amount);
    await algebraVaultStable
      .connect(carol)
      .deposit(carol_deposit_amount, 0, await carol.getAddress());

    //actual balances after deposits
    let vault_balance_after_deposits = await algebraVaultStable.getTotalAmounts();
    expect(vault_balance_after_deposits[0]).to.equal(
      alice_deposit_amount + bob_deposit_amount + carol_deposit_amount
    );
  });

  // Should be reverted - alice tries to withdraw more than she deposited
  it("alice withdraw amount greater than her deposited", async () => {
    await token0.connect(alice).approve(await algebraVaultStable.getAddress(), largeTokenAmount);
    await token1.connect(alice).approve(await algebraVaultStable.getAddress(), largeTokenAmount);
    await token0.connect(alice).mint(await alice.getAddress(), smallTokenAmount);
    await token1.connect(alice).mint(await alice.getAddress(), smallTokenAmount);
    await algebraVaultStable
      .connect(alice)
      .deposit(smallTokenAmount, 0, await alice.getAddress());
    let alice_liq_balance = await algebraVaultStable.balanceOf(await alice.getAddress());
    await expect(
      algebraVaultStable
        .connect(alice)
        .withdraw(alice_liq_balance + 1n, await alice.getAddress())
    ).to.be.reverted;
  });

  it("swap and deposit in same block", async () => {
    let amount_for_swap = ethers.parseEther("1000");
    await token0.connect(alice).mint(await alice.getAddress(), smallTokenAmount);
    await token0.connect(alice).approve(await algebraVaultStable.getAddress(), largeTokenAmount);
    await token1.connect(carol).approve(await router.getAddress(), veryLargeTokenAmount);
    await token1.connect(carol).mint(await carol.getAddress(), amount_for_swap);
    await network.provider.send("evm_setAutomine", [false]);
    await router.connect(carol).exactInputSingle(
      {
        tokenIn: await token1.getAddress(),
        tokenOut: await token0.getAddress(),
        recipient: await alice.getAddress(),
        deployer: NULL_ADDRESS,
        deadline: 2000000000, // Wed May 18 2033 03:33:20 GMT+0000
        amountIn: amount_for_swap,
        amountOutMinimum: ethers.parseEther("0"),
        limitSqrtPrice: 0,
      },
      { gasLimit: 30000000 }
    );
    await algebraVaultStable
      .connect(alice)
      .deposit(smallTokenAmount, 0, await alice.getAddress());
    await network.provider.send("evm_mine");
    await network.provider.send("evm_setAutomine", [true]);
  });

  // Should be reverted - multiple users deposit and alice tries to withdraw more than she deposited
  it("multiple users deposit and alice withdraw amount greater than her deposited", async () => {
    let alice_deposit_amount = ethers.parseEther("1000");
    let bob_deposit_amount = ethers.parseEther("2000");
    //alice deposit
    await token0.connect(alice).approve(await algebraVaultStable.getAddress(), largeTokenAmount);
    await token1.connect(alice).approve(await algebraVaultStable.getAddress(), largeTokenAmount);
    await token0.connect(alice).mint(await alice.getAddress(), alice_deposit_amount);
    await token1.connect(alice).mint(await alice.getAddress(), alice_deposit_amount);
    await algebraVaultStable
      .connect(alice)
      .deposit(alice_deposit_amount, 0, await alice.getAddress());
    //bob deposit
    await token0.connect(bob).approve(await algebraVaultStable.getAddress(), largeTokenAmount);
    await token1.connect(bob).approve(await algebraVaultStable.getAddress(), largeTokenAmount);
    await token0.connect(bob).mint(await bob.getAddress(), bob_deposit_amount);
    await token1.connect(bob).mint(await bob.getAddress(), bob_deposit_amount);
    await algebraVaultStable.connect(bob).deposit(bob_deposit_amount, 0, await bob.getAddress());

    //alice withdraw
    let alice_liq_balance = await algebraVaultStable.balanceOf(await alice.getAddress());
    await expect(
      algebraVaultStable
        .connect(alice)
        .withdraw(alice_liq_balance + 1n, await alice.getAddress())
    ).to.be.reverted;
  });

  it("rebalance after deposited amount", async () => {
    let amount_for_swap = ethers.parseEther("10000000");
    let amount_for_deposit = ethers.parseEther("10000");

    await token0.connect(alice).approve(await algebraVaultStable.getAddress(), largeTokenAmount);
    await token1.connect(alice).approve(await algebraVaultStable.getAddress(), largeTokenAmount);
    await token0.connect(alice).mint(await alice.getAddress(), largeTokenAmount);
    await token1.connect(alice).mint(await alice.getAddress(), largeTokenAmount);
    await algebraVaultStable
      .connect(alice)
      .deposit(amount_for_deposit, amount_for_deposit, await alice.getAddress());
    await network.provider.send("evm_mine");
    await network.provider.send("evm_increaseTime", [3600]);

    await token0.connect(carol).approve(await router.getAddress(), veryLargeTokenAmount);
    await token1.connect(carol).approve(await router.getAddress(), veryLargeTokenAmount);
    await token0.connect(carol).mint(await carol.getAddress(), amount_for_swap);
    await token1.connect(carol).mint(await carol.getAddress(), amount_for_swap);
    await router.connect(carol).exactInputSingle(
      {
        tokenIn: await token1.getAddress(),
        tokenOut: await token0.getAddress(),
        recipient: await alice.getAddress(),
        deployer: NULL_ADDRESS,
        deadline: 2000000000, // Wed May 18 2033 03:33:20 GMT+0000
        amountIn: 1,
        amountOutMinimum: ethers.parseEther("0"),
        limitSqrtPrice: 0,
      },
      { gasLimit: 30000000 }
    );

    await network.provider.send("evm_mine");
    await network.provider.send("evm_increaseTime", [36000]);
    await algebraVaultStable
      .connect(alice)
      .deposit(amount_for_deposit, amount_for_deposit, await alice.getAddress());
    await network.provider.send("evm_mine");
    await network.provider.send("evm_increaseTime", [36000]);

    await algebraVaultStable.rebalance(-600, 600, 0);

    let token0vault = await token0.balanceOf(await algebraVaultStable.getAddress());
    let token1vault = await token1.balanceOf(await algebraVaultStable.getAddress());

    console.log(token0vault,token1vault)
    expect(token0vault).to.equal(0);
    expect(token1vault).to.equal(0);

    let basePosition = await algebraVaultStable.getBasePosition();

    expect(basePosition[0]).to.be.gt(ethers.parseEther("0"));
  });

  it("withdraw after deposit and rebalance", async () => {
    let amount_for_swap = ethers.parseEther("10000000");
    let amount_for_deposit = ethers.parseEther("10000");

    await token0.connect(alice).approve(await algebraVaultStable.getAddress(), largeTokenAmount);
    await token1.connect(alice).approve(await algebraVaultStable.getAddress(), largeTokenAmount);
    await token0.connect(alice).mint(await alice.getAddress(), largeTokenAmount);
    await token1.connect(alice).mint(await alice.getAddress(), largeTokenAmount);
    await algebraVaultStable
      .connect(alice)
      .deposit(amount_for_deposit, 0, await alice.getAddress());
    await network.provider.send("evm_mine");
    await network.provider.send("evm_increaseTime", [3600]);

    await token0.connect(carol).approve(await router.getAddress(), veryLargeTokenAmount);
    await token1.connect(carol).approve(await router.getAddress(), veryLargeTokenAmount);
    await token0.connect(carol).mint(await carol.getAddress(), amount_for_swap);
    await token1.connect(carol).mint(await carol.getAddress(), amount_for_swap);

    await network.provider.send("evm_mine");
    await network.provider.send("evm_increaseTime", [36000]);
    await algebraVaultStable
      .connect(alice)
      .deposit(amount_for_deposit, 0, await alice.getAddress());
    await network.provider.send("evm_mine");
    await network.provider.send("evm_increaseTime", [36000]);

    await algebraVaultStable.rebalance(-600, 600, 0);
    await network.provider.send("evm_mine");
    await network.provider.send("evm_increaseTime", [36000]);

    let alice_liq_balance = await algebraVaultStable.balanceOf(await alice.getAddress());
    await expect(
      algebraVaultStable.connect(alice).withdraw(alice_liq_balance, await alice.getAddress())
    ).to.emit(algebraVaultStable, "Withdraw");
    let token0vault = await token0.balanceOf(await algebraVaultStable.getAddress());
    let token1vault = await token1.balanceOf(await algebraVaultStable.getAddress());
    expect(token0vault).to.equal(0);
    expect(token1vault).to.equal(0);
  });

  //should be passed
  //1. deposit
  //2. rebalance
  //3. swap
  //4. withdraw
  it("withdraw after deposit and rebalance with swap", async () => {
    let amount_for_swap = ethers.parseEther("10000000");
    let amount_for_deposit = ethers.parseEther("10000");

    await token0.connect(alice).approve(await algebraVaultStable.getAddress(), largeTokenAmount);
    await token1.connect(alice).approve(await algebraVaultStable.getAddress(), largeTokenAmount);
    await token0.connect(alice).mint(await alice.getAddress(), largeTokenAmount);
    await token1.connect(alice).mint(await alice.getAddress(), largeTokenAmount);
    await algebraVaultStable
      .connect(alice)
      .deposit(amount_for_deposit, 0, await alice.getAddress());
    await network.provider.send("evm_mine");
    await network.provider.send("evm_increaseTime", [3600]);

    await token0.connect(carol).approve(await router.getAddress(), veryLargeTokenAmount);
    await token1.connect(carol).approve(await router.getAddress(), veryLargeTokenAmount);
    await token0.connect(carol).mint(await carol.getAddress(), amount_for_swap);
    await token1.connect(carol).mint(await carol.getAddress(), amount_for_swap);
    await router.connect(carol).exactInputSingle(
      {
        tokenIn: await token1.getAddress(),
        tokenOut: await token0.getAddress(),
        recipient: await alice.getAddress(),
        deployer: NULL_ADDRESS,
        deadline: 2000000000, // Wed May 18 2033 03:33:20 GMT+0000
        amountIn: amount_for_swap,
        amountOutMinimum: ethers.parseEther("0"),
        limitSqrtPrice: 0,
      },
      { gasLimit: 30000000 }
    );
    await network.provider.send("evm_mine");
    await network.provider.send("evm_increaseTime", [36000]);

    let alice_liq_balance = await algebraVaultStable.balanceOf(await alice.getAddress());
    await expect(
      algebraVaultStable.connect(alice).withdraw(alice_liq_balance, await alice.getAddress())
    ).to.emit(algebraVaultStable, "Withdraw");
    let token0vault = await token0.balanceOf(await algebraVaultStable.getAddress());
    let token1vault = await token1.balanceOf(await algebraVaultStable.getAddress());
    expect(token0vault).to.equal(0);
    expect(token1vault).to.equal(0);
  });

  it("deposit with deposit guard", async () => {
    await token0.connect(alice).approve(await depositGuardStable.getAddress(), largeTokenAmount);
    await token1.connect(alice).approve(await depositGuardStable.getAddress(), largeTokenAmount);
    await token0.connect(alice).mint(await alice.getAddress(), largeTokenAmount);
    await token1.connect(alice).mint(await alice.getAddress(), largeTokenAmount);
    await depositGuardStable
      .connect(alice)
      .forwardDepositToAlgebraVaultStable(
        await algebraVaultStable.getAddress(),
        await wallet.getAddress(),
        await token0.getAddress(),
        smallTokenAmount,
        await token1.getAddress(),
        smallTokenAmount,
        0,
        await alice.getAddress()
      );
  });

  //should be reverted
  //because does not accept native
  it("native deposit with deposit guard", async () => {
    await expect(
      alice.sendTransaction({
        to: await depositGuardStable.getAddress(),
        value: ethers.parseEther("1"),
        gasLimit: 30000000,
      })
    ).to.be.reverted;
  });

  it("deposit guard -- forward withdraw from algebra vault", async () => {
    await token0.connect(alice).approve(await depositGuardStable.getAddress(), largeTokenAmount);
    await token0.connect(alice).mint(await alice.getAddress(), largeTokenAmount);
    await token1.connect(alice).approve(await depositGuardStable.getAddress(), largeTokenAmount);
    await token1.connect(alice).mint(await alice.getAddress(), largeTokenAmount);
    await depositGuardStable
      .connect(alice)
      .forwardDepositToAlgebraVaultStable(
        await algebraVaultStable.getAddress(),
        await wallet.getAddress(),
        await token0.getAddress(),
        smallTokenAmount,
        await token1.getAddress(),
        smallTokenAmount,
        0,
        await alice.getAddress()
      );
    let alice_liq_balance = await algebraVaultStable.balanceOf(await alice.getAddress());
    await algebraVaultStable
      .connect(alice)
      .approve(await depositGuardStable.getAddress(), alice_liq_balance);
    await depositGuardStable
      .connect(alice)
      .forwardWithdrawFromAlgebraVaultStable(
        await algebraVaultStable.getAddress(),
        await wallet.getAddress(),
        alice_liq_balance,
        await alice.getAddress(),
        0,
        0
      );
    alice_liq_balance = await algebraVaultStable.balanceOf(await alice.getAddress());
    expect(alice_liq_balance).to.equal(0);
  });

  it("DepositGuard - deposit another token", async () => {
    await token2.mint(await alice.getAddress(), smallTokenAmount);
    await token2.connect(alice).approve(await depositGuardStable.getAddress(), smallTokenAmount);
    await expect(
      depositGuardStable
        .connect(alice)
        .forwardDepositToAlgebraVaultStable(
          await algebraVaultStable.getAddress(),
          await wallet.getAddress(),
          await token2.getAddress(),
          smallTokenAmount,
          await token1.getAddress(),
          0,
          0,
          await alice.getAddress()
        )
    ).to.be.revertedWith("Invalid token");
  });

  it("deposit after set DepositMax==0", async () => {
    await algebraVaultStable.connect(wallet).setDepositMax(0, 0);
    await token0.connect(alice).mint(await alice.getAddress(), largeTokenAmount);
    await token0.connect(alice).approve(await algebraVaultStable.getAddress(), largeTokenAmount);
    await expect(
      algebraVaultStable.connect(alice).deposit(smallTokenAmount, 0, await alice.getAddress())
    ).to.be.reverted;

    await token0.connect(alice).approve(await depositGuardStable.getAddress(), largeTokenAmount);
    await expect(
      depositGuardStable
        .connect(alice)
        .forwardDepositToAlgebraVaultStable(
          await algebraVaultStable.getAddress(),
          await wallet.getAddress(),
          await token0.getAddress(),
          smallTokenAmount,
          await token1.getAddress(),
          smallTokenAmount,
          0,
          await alice.getAddress()
        )
    ).to.be.reverted;
  });

  // shoule be reverted with InvalidDeposit
  // because pool is locked
  it("deposit from one with flashloan", async () => {
    const poolDeployer = await factory.poolDeployer();
    const pairFlashFactory = await ethers.getContractFactory("PairFlash");
    const pairFlash = (await pairFlashFactory.deploy(
      await factory.getAddress(),
      poolDeployer,
      await algebraVaultStable.getAddress() // используем factory как poolDeployer для простоты
    )) as PairFlash;

    await token0.connect(alice).approve(await depositGuardStable.getAddress(), largeTokenAmount);
    await token1.connect(alice).approve(await depositGuardStable.getAddress(), largeTokenAmount);
    await token0.connect(alice).mint(await alice.getAddress(), largeTokenAmount);
    await token1.connect(alice).mint(await alice.getAddress(), largeTokenAmount);
    await token0.connect(alice).mint(await pairFlash.getAddress(), largeTokenAmount);
    await token1.connect(alice).mint(await pairFlash.getAddress(), largeTokenAmount);
    const flashAmount0 = ethers.parseEther("0.1");
    const flashAmount1 = ethers.parseEther("0.1");
    const computedPool = await factory.computePoolAddress(
      await token0.getAddress(),
      await token1.getAddress()
    );

    const pool = await pairFlash.getPool(await token0.getAddress(), await token1.getAddress());
    

    
    await expect(
      pairFlash.connect(alice).initFlash({
        token0: await token0.getAddress(),
        token1: await token1.getAddress(),
        deployer: poolDeployer,
        amount0: flashAmount0,
        amount1: flashAmount1,
      })
    ).to.revertedWithCustomError(algebraVaultStable, "InvalidDeposit");
  });

  it("Withdraw to vault address", async () => {
    await token0.connect(alice).mint(await alice.getAddress(), veryLargeTokenAmount);
    await token0
      .connect(alice)
      .approve(await algebraVaultStable.getAddress(), veryLargeTokenAmount);

    await algebraVaultStable
      .connect(alice)
      .deposit(smallTokenAmount, 0, await alice.getAddress());

    await token0.connect(bob).mint(await bob.getAddress(), veryLargeTokenAmount);
    await token0
      .connect(bob)
      .approve(await algebraVaultStable.getAddress(), veryLargeTokenAmount);

    await algebraVaultStable.connect(bob).deposit(smallTokenAmount, 0, await bob.getAddress());

    let alice_liq_balance = await algebraVaultStable.balanceOf(await alice.getAddress());
    let bob_liq_balance = await algebraVaultStable.balanceOf(await bob.getAddress());

    await algebraVaultStable
      .connect(alice)
      .withdraw(alice_liq_balance, await algebraVaultStable.getAddress());

    await algebraVaultStable.connect(bob).withdraw(bob_liq_balance, await bob.getAddress());
  });

  it("Collected fees", async () => {
    await token1.connect(alice).mint(await algebraVaultStable.getAddress(), smallTokenAmount);
    await token0.connect(alice).mint(await alice.getAddress(), veryLargeTokenAmount);
    
    
    await algebraVaultStableFactory.connect(wallet).setAmmFee(ethers.parseEther("0.1"));
    await algebraVaultStable.connect(wallet).setAmmFeeRecipient(await alice.getAddress());
    await token0
      .connect(alice)
      .approve(await algebraVaultStable.getAddress(), veryLargeTokenAmount);
    await algebraVaultStable
      .connect(alice)
      .deposit(smallTokenAmount, 0, await alice.getAddress());

    await algebraVaultStable.rebalance(-600, 600,0);
    await token0.connect(carol).mint(await carol.getAddress(), veryLargeTokenAmount);
    await token0.connect(carol).approve(await router.getAddress(), veryLargeTokenAmount);
    await router.connect(carol).exactInputSingle(
      {
        tokenIn: await token0.getAddress(),
        tokenOut: await token1.getAddress(),
        recipient: await alice.getAddress(),
        deployer: NULL_ADDRESS,
        deadline: 2000000000, // Wed May 18 2033 03:33:20 GMT+0000
        amountIn: largeTokenAmount,
        amountOutMinimum: ethers.parseEther("0"),
        limitSqrtPrice: 0,
      },
      { gasLimit: 30000000 }
    );

    await token1.mint(await carol.getAddress(), giantTokenAmount);
    await token1.connect(carol).approve(await router.getAddress(), giantTokenAmount);
    await router.connect(carol).exactInputSingle(
      {
        tokenIn: await token1.getAddress(),
        tokenOut: await token0.getAddress(),
        recipient: await alice.getAddress(),
        deployer: NULL_ADDRESS,
        deadline: 2000000000, // Wed May 18 2033 03:33:20 GMT+0000
        amountIn: largeTokenAmount,
        amountOutMinimum: ethers.parseEther("0"),
        limitSqrtPrice: 0,
      },
      { gasLimit: 30000000 }
    );

    
    let fees = await algebraVaultStable.connect(alice).collectFees.staticCall();
    
    await algebraVaultStable.connect(alice).collectFees();
    let alice_liq_balance = await algebraVaultStable.balanceOf(await alice.getAddress());
    await algebraVaultStable
      .connect(alice)
      .withdraw(alice_liq_balance, await alice.getAddress());

  });

  it("Deposit from two accounts and Collect fees", async () => {
    await token1.connect(alice).mint(await algebraVaultStable.getAddress(), smallTokenAmount);
    await token0.connect(alice).mint(await alice.getAddress(), veryLargeTokenAmount);
    await token0
      .connect(alice)
      .approve(await algebraVaultStable.getAddress(), veryLargeTokenAmount);
    await algebraVaultStable
      .connect(alice)
      .deposit(ethers.parseEther("0.001"), 0, await alice.getAddress());

    await token0.connect(bob).mint(await bob.getAddress(), veryLargeTokenAmount);
    await token0
      .connect(bob)
      .approve(await algebraVaultStable.getAddress(), veryLargeTokenAmount);
    await algebraVaultStable
      .connect(bob)
      .deposit(ethers.parseEther("0.001"), 0, await bob.getAddress());

    await token0.connect(carol).mint(await carol.getAddress(), veryLargeTokenAmount);
    await token0
      .connect(carol)
      .approve(await algebraVaultStable.getAddress(), veryLargeTokenAmount);
    await algebraVaultStable
      .connect(carol)
      .deposit(ethers.parseEther("0.001"), 0, await carol.getAddress());

    await algebraVaultStable.rebalance(-60, 60, 0);

    await token0.connect(carol).mint(await carol.getAddress(), veryLargeTokenAmount);
    await token0.connect(carol).approve(await router.getAddress(), veryLargeTokenAmount);
    await router.connect(carol).exactInputSingle(
      {
        tokenIn: await token0.getAddress(),
        tokenOut: await token1.getAddress(),
        recipient: await alice.getAddress(),
        deployer: NULL_ADDRESS,
        deadline: 2000000000, // Wed May 18 2033 03:33:20 GMT+0000
        amountIn: smallTokenAmount,
        amountOutMinimum: ethers.parseEther("0"),
        limitSqrtPrice: 0,
      },
      { gasLimit: 30000000 }
    );
    
    await algebraVaultStable.connect(alice).collectFees();
    let alice_liq_balance = await algebraVaultStable.balanceOf(await alice.getAddress());
    const [amount0_alice, amount1_alice] = await algebraVaultStable
      .connect(alice)
      .withdraw.staticCall(alice_liq_balance, await alice.getAddress());

    await algebraVaultStable
      .connect(alice)
      .withdraw(alice_liq_balance, await alice.getAddress());
    let bob_liq_balance = await algebraVaultStable.balanceOf(await bob.getAddress());
    const [amount0_bob, amount1_bob] = await algebraVaultStable
      .connect(bob)
      .withdraw.staticCall(bob_liq_balance, await bob.getAddress());
    

    await algebraVaultStable.connect(bob).withdraw(bob_liq_balance, await bob.getAddress());
  });

  it("deposit after tranfer token1 to vault", async () => {
    //despoit Alice
    await token0.connect(alice).mint(await alice.getAddress(), veryLargeTokenAmount);
    let token0_alice_balance = await token0.balanceOf(await alice.getAddress());
    await token0
      .connect(alice)
      .approve(await algebraVaultStable.getAddress(), veryLargeTokenAmount);

    await algebraVaultStable
      .connect(alice)
      .deposit(ethers.parseEther("0.001"), 0, await alice.getAddress());
    let alice_liq_balance = await algebraVaultStable.balanceOf(await alice.getAddress());

    //deposit Bob
    await token0.connect(bob).mint(await bob.getAddress(), veryLargeTokenAmount);
    await token0
      .connect(bob)
      .approve(await algebraVaultStable.getAddress(), veryLargeTokenAmount);
    await algebraVaultStable
      .connect(bob)
      .deposit(ethers.parseEther("0.001"), 0, await bob.getAddress());
    let bob_liq_balance = await algebraVaultStable.balanceOf(await bob.getAddress());
    

    //Mint token
    await token1.mint(await algebraVaultStable.getAddress(), ethers.parseEther("0.001"));
    let token0_alice_balance_after = await token0.balanceOf(await alice.getAddress());

    
    await algebraVaultStable.connect(bob).withdraw(bob_liq_balance, await bob.getAddress());
    let token0_bob_balance_after_withdraw = await token0.balanceOf(await bob.getAddress());
    
    await token0.connect(carol).mint(await carol.getAddress(), veryLargeTokenAmount);
    await token0
      .connect(carol)
      .approve(await algebraVaultStable.getAddress(), veryLargeTokenAmount);
    await algebraVaultStable
      .connect(carol)
      .deposit(ethers.parseEther("0.001"), 0, await carol.getAddress());
    let carol_liq_balance = await algebraVaultStable.balanceOf(await carol.getAddress());
    

    await algebraVaultStable
      .connect(carol)
      .withdraw(carol_liq_balance, await carol.getAddress());
    let carol_tokn0_balance_after = await token0.balanceOf(await carol.getAddress());
    
  });

  it("Delta balances after withdrowal", async () => {
    await token0.mint(await alice.getAddress(), veryLargeTokenAmount);
    await token0.mint(await bob.getAddress(), veryLargeTokenAmount);

    await token0
      .connect(alice)
      .approve(await algebraVaultStable.getAddress(), veryLargeTokenAmount);
    await token0
      .connect(bob)
      .approve(await algebraVaultStable.getAddress(), veryLargeTokenAmount);

    await token0.mint(await algebraVaultStable.getAddress(), smallTokenAmount);
    //Deposit Alice
    await algebraVaultStable
      .connect(alice)
      .deposit(smallTokenAmount, 0, await alice.getAddress());
    let alice_liq_balance = await algebraVaultStable.balanceOf(await alice.getAddress());
    //Mint to Vault

    //Deposit Bob
    await algebraVaultStable.connect(bob).deposit(smallTokenAmount, 0, await bob.getAddress());
    let bob_liq_balance = await algebraVaultStable.balanceOf(await bob.getAddress());

    //Balances before Withdraw
    let aliceToken0BalanceBefore = await token0.balanceOf(await alice.getAddress());
    let bobToken0BalanceBefore = await token0.balanceOf(await bob.getAddress());

    //withdraws
    await algebraVaultStable
      .connect(alice)
      .withdraw(alice_liq_balance, await alice.getAddress());
    await algebraVaultStable.connect(bob).withdraw(bob_liq_balance, await bob.getAddress());

    //Balances after Withdraw
    let aliceToken0BalanceAfter = await token0.balanceOf(await alice.getAddress());
    let bobToken0BalanceAfter = await token0.balanceOf(await bob.getAddress());

    let aliceDelta = aliceToken0BalanceAfter - aliceToken0BalanceBefore;
    let bobDelta = bobToken0BalanceAfter - bobToken0BalanceBefore;

    alice_liq_balance = await algebraVaultStable.balanceOf(await alice.getAddress());
  });
  it("check Lp balance", async () => {
    await token0.mint(await alice.getAddress(), veryLargeTokenAmount);
    await token0.mint(await bob.getAddress(), smallTokenAmount);
    await token0.mint(await carol.getAddress(), smallTokenAmount);

    await token0
      .connect(alice)
      .approve(await algebraVaultStable.getAddress(), veryLargeTokenAmount);
    await token0
      .connect(bob)
      .approve(await algebraVaultStable.getAddress(), veryLargeTokenAmount);
    await token0
      .connect(carol)
      .approve(await algebraVaultStable.getAddress(), veryLargeTokenAmount);

    await algebraVaultStable
      .connect(alice)
      .deposit(smallTokenAmount, 0, await alice.getAddress());
    await algebraVaultStable.connect(bob).deposit(smallTokenAmount, 0, await bob.getAddress());
    await token0.mint(await algebraVaultStable.getAddress(), smallTokenAmount);
    await algebraVaultStable
      .connect(carol)
      .deposit(smallTokenAmount, 0, await carol.getAddress());

    let alice_liq_balance = await algebraVaultStable.balanceOf(await alice.getAddress());
    let bob_liq_balance = await algebraVaultStable.balanceOf(await bob.getAddress());
    let carol_liq_balance = await algebraVaultStable.balanceOf(await carol.getAddress());

   
  });

  it("check baseLower",async () => {
    
    await token0.mint(await alice.getAddress(), veryLargeTokenAmount);
    await token0.connect(alice).approve(await algebraVaultStable.getAddress(), veryLargeTokenAmount);
    await algebraVaultStable.connect(alice).deposit(smallTokenAmount, 0, await alice.getAddress());
    await expect(algebraVaultStable.connect(wallet).rebalance(-600, 600, 0)).to.emit(algebraPool, "Mint");
    let baseLower = await algebraVaultStable.baseLower();
    
  });
  it("check baseUpper",async () => {
    await token0.mint(await alice.getAddress(), veryLargeTokenAmount);
    await token0.connect(alice).approve(await algebraVaultStable.getAddress(), veryLargeTokenAmount);
    await algebraVaultStable.connect(alice).deposit(smallTokenAmount, 0, await alice.getAddress());
    await expect(algebraVaultStable.connect(wallet).rebalance(-600, 600, 0)).to.emit(algebraPool, "Mint");
    let baseUpper = await algebraVaultStable.baseUpper();
    
  });

  it("check setAuxTwapPeriod",async () => {
    await expect(algebraVaultStable.connect(wallet).setAuxTwapPeriod(100)).to.emit(algebraVaultStable, "SetAuxTwapPeriod");
  });
  it("check hysteresis",async () => {
    let hysteresis = await algebraVaultStable.hysteresis();
    
  });
  
  it("check change rebalance manager",async () => {
    await expect(algebraVaultStable.connect(wallet).setRebalanceManager(await alice.getAddress())).to.emit(algebraVaultStable, "RebalanceManager");
  });
  it("check setHysteresis", async()=>{
    // Set small hysteresis to trigger check on significant price deviation
    await expect(algebraVaultStable.connect(wallet).setHysteresis(ethers.parseEther("0.01")))
      .to.emit(algebraVaultStable, "Hysteresis");
    await token0.mint(await alice.getAddress(), giantTokenAmount);
    await algebraVaultStable.connect(wallet).setDepositMax(giantTokenAmount,giantTokenAmount);

    // Deploy TestDepositHelper
    const helperFactory = await ethers.getContractFactory("TestDepositHelper");
    const helper = await helperFactory.deploy();
    
    // Approve helper to spend tokens
    const totalAmount = veryLargeTokenAmount + largeTokenAmount;
    await token0.connect(alice).approve(await helper.getAddress(), totalAmount);
    
    // Execute swap and deposit in same transaction - should revert
    // because both happen in same block, oracle timestamp == block.timestamp
    await expect(
      helper.connect(alice).swapAndDeposit(
        await router.getAddress(),
        await algebraVaultStable.getAddress(),
        await token0.getAddress(),
        await token1.getAddress(),
        NULL_ADDRESS,
        veryLargeTokenAmount, // Large swap to move price significantly
        largeTokenAmount,     // Deposit amount
        await alice.getAddress()
      )
    ).to.be.revertedWithCustomError(algebraVaultStable, "InvalidDeposit");
  });

  it("check Hysteresis and auxTWAP=0", async()=>{
    // Set hysteresis to 0 to trigger check on any price deviation when auxTWAP=0
    await expect(algebraVaultStable.connect(wallet).setHysteresis(0))
      .to.emit(algebraVaultStable, "Hysteresis");

    await expect(algebraVaultStable.connect(wallet).setAuxTwapPeriod(0))
      .to.emit(algebraVaultStable,"SetAuxTwapPeriod");

    await token0.mint(await alice.getAddress(), giantTokenAmount);
    await algebraVaultStable.connect(wallet).setDepositMax(giantTokenAmount,giantTokenAmount);

    // Deploy TestDepositHelper
    const helperFactory = await ethers.getContractFactory("TestDepositHelper");
    const helper = await helperFactory.deploy();
    
    // Approve helper to spend tokens
    const totalAmount = largeTokenAmount + largeTokenAmount;
    await token0.connect(alice).approve(await helper.getAddress(), totalAmount);
    
    // Execute swap and deposit in same transaction - should revert
    // With hysteresis=0 and auxTWAP=0, any price deviation triggers the timestamp check
    await expect(
      helper.connect(alice).swapAndDeposit(
        await router.getAddress(),
        await algebraVaultStable.getAddress(),
        await token0.getAddress(),
        await token1.getAddress(),
        NULL_ADDRESS,
        largeTokenAmount,     // Regular swap amount
        largeTokenAmount,     // Deposit amount
        await alice.getAddress()
      )
    ).to.be.revertedWithCustomError(algebraVaultStable, "InvalidDeposit");
  });

  it("check factory: setAmmFee",async () => {
    await expect(algebraVaultStableFactory.connect(alice).setAmmFee(ethers.parseEther("0.001"))).to.be.reverted;
    await expect(algebraVaultStableFactory.connect(wallet).setAmmFee(ethers.parseEther("10"))).to.be.reverted;
    expect(algebraVaultStableFactory.connect(wallet).setAmmFee(ethers.parseEther("0.001")))
      .to.emit(algebraVaultStableFactory, "AmmFee");

  });
  it("check factory: setBaseFee",async () => {
    await expect(algebraVaultStableFactory.connect(alice).setBaseFee(ethers.parseEther("0.001"))).to.be.reverted;
    await expect(algebraVaultStableFactory.connect(wallet).setBaseFee(ethers.parseEther("10"))).to.be.reverted;
    expect(algebraVaultStableFactory.connect(wallet).setBaseFee(ethers.parseEther("0.001")))
      .to.emit(algebraVaultStableFactory, "BaseFee");
  });
  it("check factory: setBaseFeeSplit",async () => {
    await expect(algebraVaultStableFactory.connect(alice).setBaseFeeSplit(ethers.parseEther("0.001"))).to.be.reverted;
    await expect(algebraVaultStableFactory.connect(wallet).setBaseFeeSplit(ethers.parseEther("10"))).to.be.reverted;
    expect(algebraVaultStableFactory.connect(wallet).setBaseFeeSplit(ethers.parseEther("0.001")))
      .to.emit(algebraVaultStableFactory, "BaseFeeSplit");
  });
  it("check createAlgebraVaultStable",async()=>{
    await expect(algebraVaultStableFactory.connect(alice).createAlgebraVaultStable(await token0.getAddress(), await token1.getAddress())).to.be.reverted;

  });
});



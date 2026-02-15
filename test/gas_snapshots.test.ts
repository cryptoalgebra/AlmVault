import {
  IAlgebraEternalFarming,
  IAlgebraFactory,
  IFarmingCenter,
  INonfungiblePositionManager,
  IFarmingRewardsDistributor,
  IAlgebraPool,
  AlgebraVault,
  AlgebraVaultFactory,
  TestERC20,
  ISwapRouter,
} from '../types';
import { algebraVaultTestFixture } from './shared/fixtures';
import { FeeAmount, TICK_SPACINGS, encodePriceSqrt, getMaxTick, getMinTick } from './shared/utilities';
import snapshotGasCost from './shared/snapshotGasCost';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers, network } from 'hardhat';

const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';

const largeTokenAmount = ethers.parseEther('1000000');
const veryLargeTokenAmount = ethers.parseEther('100000000000');
const giantTokenAmount = ethers.parseEther('1000000000000');

describe('Gas Snapshots', () => {
  const totalReward = ethers.parseEther('2000000');
  const bonusReward = ethers.parseEther('4000');

  let factory: IAlgebraFactory;
  let nft: INonfungiblePositionManager;
  let token0: TestERC20;
  let token1: TestERC20;
  let token2: TestERC20;
  let token3: TestERC20;
  let algebraPool: IAlgebraPool;
  let router: ISwapRouter;
  let algebraVaultFactory: AlgebraVaultFactory;
  let algebraEternalFarming: IAlgebraEternalFarming;
  let farmingCenter: IFarmingCenter;
  let algebraVault: AlgebraVault;
  let farmingRewardsDistributor: IFarmingRewardsDistributor;

  let wallet: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let carol: HardhatEthersSigner;
  let other: HardhatEthersSigner;

  before('create fixture loader', async () => {
    [wallet, alice, bob, carol, other] = await (ethers as any).getSigners();
  });

  beforeEach('deploy contracts', async () => {
    ({
      token0,
      token1,
      token2,
      token3,
      factory,
      router,
      nft,
      algebraVaultFactory,
      algebraEternalFarming,
      farmingCenter,
    } = await loadFixture(algebraVaultTestFixture));

    await factory.createPool(await token0.getAddress(), await token1.getAddress(), '0x');

    const poolAddress = await factory.poolByPair(await token0.getAddress(), await token1.getAddress());

    algebraPool = (await ethers.getContractAt('IAlgebraPool', poolAddress)) as IAlgebraPool;
    await algebraPool.initialize(encodePriceSqrt('1', '1'));

    await algebraVaultFactory
      .connect(wallet)
      .createAlgebraVault(await token0.getAddress(), true, await token1.getAddress(), false);

    const vaultKey = await algebraVaultFactory.genKey(
      await wallet.getAddress(),
      await token0.getAddress(),
      await token1.getAddress(),
      true,
      false,
    );
    const algebraVaultAddress = await algebraVaultFactory.getAlgebraVault(vaultKey);
    algebraVault = (await ethers.getContractAt('AlgebraVault', algebraVaultAddress)) as AlgebraVault;

    farmingRewardsDistributor = (await ethers.getContractAt(
      'FarmingRewardsDistributor',
      await algebraVault.farmingRewardsDistributor(),
    )) as IFarmingRewardsDistributor;

    // Add reward tokens
    await farmingRewardsDistributor.addReward(await token2.getAddress());
    await farmingRewardsDistributor.addReward(await token1.getAddress());

    await algebraVault.connect(wallet).setDepositMax(ethers.parseEther('100000'), ethers.parseEther('100000'));

    // Seed extra liquidity into the pool
    await token0.mint(await carol.getAddress(), giantTokenAmount);
    await token1.mint(await carol.getAddress(), giantTokenAmount);

    await token0.connect(carol).approve(await nft.getAddress(), giantTokenAmount);
    await token1.connect(carol).approve(await nft.getAddress(), giantTokenAmount);

    await token0.connect(carol).approve(await router.getAddress(), giantTokenAmount);
    await token1.connect(carol).approve(await router.getAddress(), giantTokenAmount);

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

    await network.provider.send('evm_increaseTime', [3600]);

    // Prepare alice & bob tokens
    await token0.mint(await alice.getAddress(), largeTokenAmount);
    await token1.mint(await alice.getAddress(), largeTokenAmount);
    await token0.connect(alice).approve(await algebraVault.getAddress(), largeTokenAmount);
    await token1.connect(alice).approve(await algebraVault.getAddress(), largeTokenAmount);

    await token0.mint(await bob.getAddress(), largeTokenAmount);
    await token1.mint(await bob.getAddress(), largeTokenAmount);
    await token0.connect(bob).approve(await algebraVault.getAddress(), largeTokenAmount);
    await token1.connect(bob).approve(await algebraVault.getAddress(), largeTokenAmount);

    await token1.mint(algebraVault, largeTokenAmount);
  });

  describe('Core Vault Operations', () => {
    it('deposit: first deposit (empty vault)', async () => {
      await snapshotGasCost(
        algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress()),
      );
    });

    it('deposit: second deposit (non-empty vault, no positions)', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());

      await snapshotGasCost(algebraVault.connect(bob).deposit(ethers.parseEther('2000'), 0, await bob.getAddress()));
    });

    it('deposit: into vault with active position', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());

      await algebraVault.connect(wallet).rebalance(-1800, 1800, 1800, 3600, 0);
      expect(await algebraVault.basePositionId()).to.not.equal(0);

      await network.provider.send('evm_increaseTime', [60]);
      await network.provider.send('evm_mine');

      await snapshotGasCost(algebraVault.connect(bob).deposit(ethers.parseEther('2000'), 0, await bob.getAddress()));
    });

    it('withdraw: full withdraw (no positions)', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());

      const shares = await algebraVault.balanceOf(await alice.getAddress());
      await snapshotGasCost(algebraVault.connect(alice).withdraw(shares, await alice.getAddress()));
    });

    it('withdraw: partial withdraw (no positions)', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());

      const shares = await algebraVault.balanceOf(await alice.getAddress());
      await snapshotGasCost(algebraVault.connect(alice).withdraw(shares / 2n, await alice.getAddress()));
    });

    it('withdraw: full withdraw (with position, no fees)', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());
      await algebraVault.connect(wallet).rebalance(-1800, 1800, 1800, 3600, 0);
      expect(await algebraVault.basePositionId()).to.not.equal(0);

      const shares = await algebraVault.balanceOf(await alice.getAddress());
      await snapshotGasCost(algebraVault.connect(alice).withdraw(shares, await alice.getAddress()));
    });

    it('withdraw: partial withdraw (with position, no fees)', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());
      await algebraVault.connect(wallet).rebalance(-1800, 1800, 1800, 3600, 0);
      expect(await algebraVault.basePositionId()).to.not.equal(0);

      // Second depositor so partial withdraw is valid
      await algebraVault.connect(bob).deposit(ethers.parseEther('2000'), 0, await bob.getAddress());

      const shares = await algebraVault.balanceOf(await alice.getAddress());
      await snapshotGasCost(algebraVault.connect(alice).withdraw(shares / 2n, await alice.getAddress()));
    });

    it('withdraw: with accumulated fees', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());
      await algebraVault.connect(wallet).rebalance(-1800, 1800, 1800, 3600, 0);
      expect(await algebraVault.basePositionId()).to.not.equal(0);

      // Generate swap fees
      await router.connect(carol).exactInputSingle({
        tokenIn: await token1.getAddress(),
        tokenOut: await token0.getAddress(),
        deployer: NULL_ADDRESS,
        recipient: await carol.getAddress(),
        deadline: 9999999999999,
        amountIn: ethers.parseEther('10000'),
        amountOutMinimum: 0,
        limitSqrtPrice: 0,
      });

      await network.provider.send('evm_increaseTime', [3600]);
      await network.provider.send('evm_mine');

      const shares = await algebraVault.balanceOf(await alice.getAddress());
      await snapshotGasCost(algebraVault.connect(alice).withdraw(shares, await alice.getAddress()));
    });

    it('collectFees: no positions', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());

      await snapshotGasCost(algebraVault.collectFees());
    });

    it('collectFees: with position, no fees', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());
      await algebraVault.connect(wallet).rebalance(-1800, 1800, 1800, 3600, 0);
      expect(await algebraVault.basePositionId()).to.not.equal(0);

      await snapshotGasCost(algebraVault.collectFees());
    });

    it('collectFees: with accumulated fees and fee distribution', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());
      await algebraVault.connect(wallet).rebalance(-1800, 1800, 1800, 3600, 0);
      expect(await algebraVault.basePositionId()).to.not.equal(0);

      // Generate swap fees
      await router.connect(carol).exactInputSingle({
        tokenIn: await token1.getAddress(),
        tokenOut: await token0.getAddress(),
        deployer: NULL_ADDRESS,
        recipient: await carol.getAddress(),
        deadline: 9999999999999,
        amountIn: ethers.parseEther('10000'),
        amountOutMinimum: 0,
        limitSqrtPrice: 0,
      });

      await network.provider.send('evm_increaseTime', [3600]);
      await network.provider.send('evm_mine');

      // set fees
      await algebraVaultFactory.connect(wallet).setBaseFee(ethers.parseEther('0.2')); // 20%
      await algebraVault.connect(wallet).setAffiliate(await other.getAddress());

      await snapshotGasCost(algebraVault.collectFees());
    });

    it('rebalance: first rebalance, base position only (no limit)', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());

      await snapshotGasCost(algebraVault.connect(wallet).rebalance(-1800, 1800, 1800, 3600, 0));

      expect(await algebraVault.basePositionId()).to.not.equal(0);
      expect(await algebraVault.limitPositionId()).to.equal(0);
    });

    it('rebalance: first rebalance, base + limit positions', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());

      await snapshotGasCost(algebraVault.connect(wallet).rebalance(-60, 1800, -1800, -60, 0));

      expect(await algebraVault.basePositionId()).to.not.equal(0);
      expect(await algebraVault.limitPositionId()).to.not.equal(0);
    });

    it('rebalance: re-rebalance, 1 pos => 1 pos (no fees)', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());

      await algebraVault.connect(wallet).rebalance(-1800, 1800, 1800, 3600, 0);
      expect(await algebraVault.basePositionId()).to.not.equal(0);
      expect(await algebraVault.limitPositionId()).to.equal(0);

      await network.provider.send('evm_increaseTime', [60]);
      await network.provider.send('evm_mine');

      await snapshotGasCost(algebraVault.connect(wallet).rebalance(-1200, 1200, 1200, 3600, 0));

      expect(await algebraVault.basePositionId()).to.not.equal(0);
      expect(await algebraVault.limitPositionId()).to.equal(0);
    });

    it('rebalance: re-rebalance, 2 pos => 2 pos (no fees)', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());

      await algebraVault.connect(wallet).rebalance(-60, 1800, -1800, -60, 0);
      expect(await algebraVault.basePositionId()).to.not.equal(0);
      expect(await algebraVault.limitPositionId()).to.not.equal(0);

      await network.provider.send('evm_increaseTime', [60]);
      await network.provider.send('evm_mine');

      await snapshotGasCost(algebraVault.connect(wallet).rebalance(-120, 1800, -1800, -120, 0));

      expect(await algebraVault.basePositionId()).to.not.equal(0);
      expect(await algebraVault.limitPositionId()).to.not.equal(0);
    });

    it('rebalance: re-rebalance, 1 pos => 2 pos (no fees)', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());

      await algebraVault.connect(wallet).rebalance(-1800, 1800, 1800, 3600, 0);
      expect(await algebraVault.basePositionId()).to.not.equal(0);
      expect(await algebraVault.limitPositionId()).to.equal(0);

      await network.provider.send('evm_increaseTime', [60]);
      await network.provider.send('evm_mine');

      await snapshotGasCost(algebraVault.connect(wallet).rebalance(-60, 1800, -1800, -60, 0));

      expect(await algebraVault.basePositionId()).to.not.equal(0);
      expect(await algebraVault.limitPositionId()).to.not.equal(0);
    });

    it('rebalance: re-rebalance, 2 pos => 1 pos (no fees)', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());

      await algebraVault.connect(wallet).rebalance(-60, 1800, -1800, -60, 0);
      expect(await algebraVault.basePositionId()).to.not.equal(0);
      expect(await algebraVault.limitPositionId()).to.not.equal(0);

      await network.provider.send('evm_increaseTime', [60]);
      await network.provider.send('evm_mine');

      await snapshotGasCost(algebraVault.connect(wallet).rebalance(-1800, 1800, 1800, 3600, 0));

      expect(await algebraVault.basePositionId()).to.not.equal(0);
      expect(await algebraVault.limitPositionId()).to.equal(0);
    });

    it('rebalance: with positive swap (token0 => token1)', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());

      await snapshotGasCost(algebraVault.connect(wallet).rebalance(-1800, 1800, 1800, 3600, ethers.parseEther('500')));

      expect(await algebraVault.basePositionId()).to.not.equal(0);
    });

    it('rebalance: with negative swap (token1 => token0)', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());
      await algebraVault.connect(wallet).rebalance(-1800, 1800, 1800, 3600, ethers.parseEther('2000'));

      await network.provider.send('evm_increaseTime', [60]);
      await network.provider.send('evm_mine');

      await snapshotGasCost(algebraVault.connect(wallet).rebalance(-1800, 1800, 1800, 3600, ethers.parseEther('-500')));

      expect(await algebraVault.basePositionId()).to.not.equal(0);
    });

    it('rebalance: re-rebalance, 2 pos => 2 pos (with fees, no fee split)', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());

      await algebraVault.connect(wallet).rebalance(-60, 1800, -1800, -60, 0);
      expect(await algebraVault.basePositionId()).to.not.equal(0);
      expect(await algebraVault.limitPositionId()).to.not.equal(0);

      // Generate swap fees
      await router.connect(carol).exactInputSingle({
        tokenIn: await token1.getAddress(),
        tokenOut: await token0.getAddress(),
        deployer: NULL_ADDRESS,
        recipient: await carol.getAddress(),
        deadline: 9999999999999,
        amountIn: ethers.parseEther('10000'),
        amountOutMinimum: 0,
        limitSqrtPrice: 0,
      });

      await network.provider.send('evm_increaseTime', [3600]);
      await network.provider.send('evm_mine');

      await snapshotGasCost(algebraVault.connect(wallet).rebalance(-120, 1800, -1800, -120, 0));

      expect(await algebraVault.basePositionId()).to.not.equal(0);
      expect(await algebraVault.limitPositionId()).to.not.equal(0);
    });

    it('rebalance: re-rebalance, 2 pos => 2 pos (with fees + amm fee + affiliate)', async () => {
      // Setup fee distribution
      await algebraVaultFactory.connect(wallet).setBaseFee(ethers.parseEther('0.2')); // 20%
      await algebraVaultFactory.connect(wallet).setAmmFee(ethers.parseEther('0.1')); // 10%
      await algebraVault.connect(wallet).setAffiliate(await other.getAddress());
      await algebraVault.connect(wallet).setAmmFeeRecipient(await bob.getAddress());

      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());

      await algebraVault.connect(wallet).rebalance(-60, 1800, -1800, -60, 0);
      expect(await algebraVault.basePositionId()).to.not.equal(0);
      expect(await algebraVault.limitPositionId()).to.not.equal(0);

      // Generate swap fees
      await router.connect(carol).exactInputSingle({
        tokenIn: await token1.getAddress(),
        tokenOut: await token0.getAddress(),
        deployer: NULL_ADDRESS,
        recipient: await carol.getAddress(),
        deadline: 9999999999999,
        amountIn: ethers.parseEther('10000'),
        amountOutMinimum: 0,
        limitSqrtPrice: 0,
      });

      await network.provider.send('evm_increaseTime', [3600]);
      await network.provider.send('evm_mine');

      await snapshotGasCost(algebraVault.connect(wallet).rebalance(-120, 1800, -1800, -120, 0));

      expect(await algebraVault.basePositionId()).to.not.equal(0);
      expect(await algebraVault.limitPositionId()).to.not.equal(0);
    });

    it('rebalance: re-rebalance, 1 pos => 1 pos (with fees)', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());

      await algebraVault.connect(wallet).rebalance(-1800, 1800, 1800, 3600, 0);
      expect(await algebraVault.basePositionId()).to.not.equal(0);
      expect(await algebraVault.limitPositionId()).to.equal(0);

      // Generate swap fees
      await router.connect(carol).exactInputSingle({
        tokenIn: await token1.getAddress(),
        tokenOut: await token0.getAddress(),
        deployer: NULL_ADDRESS,
        recipient: await carol.getAddress(),
        deadline: 9999999999999,
        amountIn: ethers.parseEther('10000'),
        amountOutMinimum: 0,
        limitSqrtPrice: 0,
      });

      await network.provider.send('evm_increaseTime', [3600]);
      await network.provider.send('evm_mine');

      await snapshotGasCost(algebraVault.connect(wallet).rebalance(-1200, 1200, 1200, 3600, 0));

      expect(await algebraVault.basePositionId()).to.not.equal(0);
      expect(await algebraVault.limitPositionId()).to.equal(0);
    });

    it('setTwapPeriod', async () => {
      await snapshotGasCost(algebraVault.connect(wallet).setTwapPeriod(1800));
    });

    it('setAuxTwapPeriod', async () => {
      await snapshotGasCost(algebraVault.connect(wallet).setAuxTwapPeriod(900));
    });

    it('setHysteresis', async () => {
      await snapshotGasCost(algebraVault.connect(wallet).setHysteresis(ethers.parseEther('0.01')));
    });

    it('setDepositMax', async () => {
      await snapshotGasCost(
        algebraVault.connect(wallet).setDepositMax(ethers.parseEther('200000'), ethers.parseEther('200000')),
      );
    });

    it('setAffiliate', async () => {
      await snapshotGasCost(algebraVault.connect(wallet).setAffiliate(await other.getAddress()));
    });

    it('setAmmFeeRecipient', async () => {
      await snapshotGasCost(algebraVault.connect(wallet).setAmmFeeRecipient(await other.getAddress()));
    });

    it('setRebalanceManager', async () => {
      await snapshotGasCost(algebraVault.connect(wallet).setRebalanceManager(await other.getAddress()));
    });

    it('getTotalAmounts: no positions', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());

      await snapshotGasCost(algebraVault.getTotalAmounts.estimateGas());
    });

    it('getTotalAmounts: with positions', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());
      await algebraVault.connect(wallet).rebalance(-60, 1800, -1800, -60, 0);
      expect(await algebraVault.basePositionId()).to.not.equal(0);
      expect(await algebraVault.limitPositionId()).to.not.equal(0);

      await snapshotGasCost(algebraVault.getTotalAmounts.estimateGas());
    });
  });

  describe('Farming Integration', () => {
    beforeEach('create farming incentive', async () => {
      // Create farming incentive
      const nonce = await algebraEternalFarming.numOfIncentives();
      await token1.approve(await algebraEternalFarming.getAddress(), bonusReward);
      await token2.approve(await algebraEternalFarming.getAddress(), totalReward);
      const pluginAddress = await algebraPool.plugin();

      await algebraEternalFarming.createEternalFarming(
        {
          pool: await algebraPool.getAddress(),
          rewardToken: await token2.getAddress(),
          bonusRewardToken: await token1.getAddress(),
          nonce,
        },
        {
          reward: totalReward,
          bonusReward: bonusReward,
          rewardRate: ethers.parseEther('1'),
          bonusRewardRate: ethers.parseEther('0.03'),
          minimalPositionWidth: 1,
        },
        pluginAddress,
      );

      // Rebalance to enter farming (1 position with vault's token1, at tick=0)
      await algebraVault.connect(wallet).rebalance(-1800, -60, 60, 15000, 0);

      // Huge swap to distribute farming rewards and move tick to ≈14000
      await router.connect(carol).exactInputSingle({
        tokenIn: await token1.getAddress(),
        tokenOut: await token0.getAddress(),
        deployer: NULL_ADDRESS,
        recipient: await carol.getAddress(),
        deadline: 9999999999999,
        amountIn: veryLargeTokenAmount,
        amountOutMinimum: 0,
        limitSqrtPrice: 0,
      });

      await network.provider.send('evm_increaseTime', [3600]);
      await network.provider.send('evm_mine');
    });

    it('rebalance: enters farming (base + limit)', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('40000'), 0, await alice.getAddress());

      await snapshotGasCost(algebraVault.connect(wallet).rebalance(13200, 15600, 12000, 13200, 0));

      // Verify 2 positions created
      const baseId = await algebraVault.basePositionId();
      const limitId = await algebraVault.limitPositionId();
      expect(baseId).to.not.equal(0);
      expect(limitId).to.not.equal(0);

      // Verify both positions are in farming
      const farmingCenterAddr = await farmingCenter.getAddress();
      expect(await nft.tokenFarmedIn(baseId)).to.equal(farmingCenterAddr);
      expect(await nft.tokenFarmedIn(limitId)).to.equal(farmingCenterAddr);
    });

    it('collectRewards: from farmed positions', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());
      await algebraVault.setFarmingRewardsDistributor(await other.getAddress());

      // Rebalance at tick≈14000
      await algebraVault.connect(wallet).rebalance(13200, 15600, 12000, 13200, 0);

      const baseId = await algebraVault.basePositionId();
      expect(baseId).to.not.equal(0);
      expect(await nft.tokenFarmedIn(baseId)).to.equal(await farmingCenter.getAddress());

      // Generate more swap activity for farming rewards
      await router.connect(carol).exactInputSingle({
        tokenIn: await token1.getAddress(),
        tokenOut: await token0.getAddress(),
        deployer: NULL_ADDRESS,
        recipient: await carol.getAddress(),
        deadline: 9999999999999,
        amountIn: veryLargeTokenAmount,
        amountOutMinimum: 0,
        limitSqrtPrice: 0,
      });

      await network.provider.send('evm_increaseTime', [3600]);
      await network.provider.send('evm_mine');

      await snapshotGasCost(algebraVault.collectRewards());
    });

    it('rebalance: re-rebalance with farming, 2 pos => 2 pos (no fees)', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('40000'), 0, await alice.getAddress());

      // First rebalance: 2 positions at tick≈14000
      await algebraVault.connect(wallet).rebalance(13200, 15600, 12000, 13200, 0);
      expect(await algebraVault.basePositionId()).to.not.equal(0);
      expect(await algebraVault.limitPositionId()).to.not.equal(0);

      await network.provider.send('evm_increaseTime', [60]);
      await network.provider.send('evm_mine');

      // Second rebalance: 2 positions with slightly shifted ranges
      await snapshotGasCost(algebraVault.connect(wallet).rebalance(13140, 15600, 12000, 13140, 0));

      expect(await algebraVault.basePositionId()).to.not.equal(0);
      expect(await algebraVault.limitPositionId()).to.not.equal(0);

      // Verify farming
      const farmingCenterAddr = await farmingCenter.getAddress();
      expect(await nft.tokenFarmedIn(await algebraVault.basePositionId())).to.equal(farmingCenterAddr);
      expect(await nft.tokenFarmedIn(await algebraVault.limitPositionId())).to.equal(farmingCenterAddr);
    });

    it('rebalance: re-rebalance with farming, 2 pos => 2 pos (with fees)', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());

      await algebraVault.connect(wallet).rebalance(13200, 15600, 12000, 13200, 0);
      expect(await algebraVault.basePositionId()).to.not.equal(0);
      expect(await algebraVault.limitPositionId()).to.not.equal(0);

      // Generate swap fees (small swap, tick barely moves)
      await router.connect(carol).exactInputSingle({
        tokenIn: await token1.getAddress(),
        tokenOut: await token0.getAddress(),
        deployer: NULL_ADDRESS,
        recipient: await carol.getAddress(),
        deadline: 9999999999999,
        amountIn: ethers.parseEther('10000'),
        amountOutMinimum: 0,
        limitSqrtPrice: 0,
      });

      await network.provider.send('evm_increaseTime', [3600]);
      await network.provider.send('evm_mine');

      await snapshotGasCost(algebraVault.connect(wallet).rebalance(13140, 15600, 12000, 13140, 0));

      expect(await algebraVault.basePositionId()).to.not.equal(0);
      expect(await algebraVault.limitPositionId()).to.not.equal(0);
    });

    it('rebalance: re-rebalance with farming, 1 pos => 2 pos (with fees)', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());

      await algebraVault.connect(wallet).rebalance(12000, 16800, 16800, 18000, 0);
      expect(await algebraVault.basePositionId()).to.not.equal(0);
      expect(await algebraVault.limitPositionId()).to.equal(0);

      // Generate swap fees
      await router.connect(carol).exactInputSingle({
        tokenIn: await token1.getAddress(),
        tokenOut: await token0.getAddress(),
        deployer: NULL_ADDRESS,
        recipient: await carol.getAddress(),
        deadline: 9999999999999,
        amountIn: ethers.parseEther('10000'),
        amountOutMinimum: 0,
        limitSqrtPrice: 0,
      });

      await network.provider.send('evm_increaseTime', [3600]);
      await network.provider.send('evm_mine');

      // Second: 2 positions
      await snapshotGasCost(algebraVault.connect(wallet).rebalance(13200, 15600, 12000, 13200, 0));

      expect(await algebraVault.basePositionId()).to.not.equal(0);
      expect(await algebraVault.limitPositionId()).to.not.equal(0);
    });

    it('rebalance: re-rebalance with farming, 2 pos => 1 pos (with fees)', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());

      // First: 2 positions
      await algebraVault.connect(wallet).rebalance(13200, 15600, 12000, 13200, 0);
      expect(await algebraVault.basePositionId()).to.not.equal(0);
      expect(await algebraVault.limitPositionId()).to.not.equal(0);

      // Generate swap fees
      await router.connect(carol).exactInputSingle({
        tokenIn: await token1.getAddress(),
        tokenOut: await token0.getAddress(),
        deployer: NULL_ADDRESS,
        recipient: await carol.getAddress(),
        deadline: 9999999999999,
        amountIn: ethers.parseEther('10000'),
        amountOutMinimum: 0,
        limitSqrtPrice: 0,
      });

      await network.provider.send('evm_increaseTime', [3600]);
      await network.provider.send('evm_mine');

      // Second: 1 position
      await snapshotGasCost(algebraVault.connect(wallet).rebalance(12000, 16800, 16800, 18000, 0));

      expect(await algebraVault.basePositionId()).to.not.equal(0);
      expect(await algebraVault.limitPositionId()).to.equal(0);
    });

    it('rebalance: full (farming + swap + fees + amm fee + affiliate)', async () => {
      // Setup full fee distribution
      await algebraVaultFactory.connect(wallet).setBaseFee(ethers.parseEther('0.2')); // 20%
      await algebraVaultFactory.connect(wallet).setAmmFee(ethers.parseEther('0.1')); // 10%
      await algebraVault.connect(wallet).setAffiliate(await other.getAddress());
      await algebraVault.connect(wallet).setAmmFeeRecipient(await bob.getAddress());

      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());

      await algebraVault.connect(wallet).rebalance(13200, 15600, 12000, 13200, 0);
      expect(await algebraVault.basePositionId()).to.not.equal(0);
      expect(await algebraVault.limitPositionId()).to.not.equal(0);

      // Generate swap fees + farming rewards
      await router.connect(carol).exactInputSingle({
        tokenIn: await token1.getAddress(),
        tokenOut: await token0.getAddress(),
        deployer: NULL_ADDRESS,
        recipient: await carol.getAddress(),
        deadline: 9999999999999,
        amountIn: ethers.parseEther('10000'),
        amountOutMinimum: 0,
        limitSqrtPrice: 0,
      });

      await network.provider.send('evm_increaseTime', [3600]);
      await network.provider.send('evm_mine');

      await snapshotGasCost(
        algebraVault.connect(wallet).rebalance(13140, 15600, 12000, 13140, ethers.parseEther('100')),
      );

      expect(await algebraVault.basePositionId()).to.not.equal(0);
    });

    it('withdraw: with farming positions', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());

      await algebraVault.connect(wallet).rebalance(13200, 15600, 12000, 13200, 0);
      const baseId = await algebraVault.basePositionId();
      expect(baseId).to.not.equal(0);
      expect(await nft.tokenFarmedIn(baseId)).to.equal(await farmingCenter.getAddress());

      await network.provider.send('evm_increaseTime', [3600]);
      await network.provider.send('evm_mine');

      const shares = await algebraVault.balanceOf(await alice.getAddress());
      await snapshotGasCost(algebraVault.connect(alice).withdraw(shares, await alice.getAddress()));
    });

    it('withdraw: with farming + fees', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());

      await algebraVault.connect(wallet).rebalance(13200, 15600, 12000, 13200, 0);
      expect(await algebraVault.basePositionId()).to.not.equal(0);

      // Generate swap fees
      await router.connect(carol).exactInputSingle({
        tokenIn: await token1.getAddress(),
        tokenOut: await token0.getAddress(),
        deployer: NULL_ADDRESS,
        recipient: await carol.getAddress(),
        deadline: 9999999999999,
        amountIn: ethers.parseEther('10000'),
        amountOutMinimum: 0,
        limitSqrtPrice: 0,
      });

      await network.provider.send('evm_increaseTime', [3600]);
      await network.provider.send('evm_mine');

      const shares = await algebraVault.balanceOf(await alice.getAddress());
      await snapshotGasCost(algebraVault.connect(alice).withdraw(shares, await alice.getAddress()));
    });

    it('deposit: into vault with farming positions + fees', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());

      await algebraVault.connect(wallet).rebalance(13200, 15600, 12000, 13200, 0);
      expect(await algebraVault.basePositionId()).to.not.equal(0);
      expect(await nft.tokenFarmedIn(await algebraVault.basePositionId())).to.equal(await farmingCenter.getAddress());

      // Generate some activity
      await router.connect(carol).exactInputSingle({
        tokenIn: await token1.getAddress(),
        tokenOut: await token0.getAddress(),
        deployer: NULL_ADDRESS,
        recipient: await carol.getAddress(),
        deadline: 9999999999999,
        amountIn: ethers.parseEther('10000'),
        amountOutMinimum: 0,
        limitSqrtPrice: 0,
      });

      await network.provider.send('evm_increaseTime', [3600]);
      await network.provider.send('evm_mine');

      await snapshotGasCost(algebraVault.connect(bob).deposit(ethers.parseEther('2000'), 0, await bob.getAddress()));
    });

    it('collectFees: with farming positions + fees', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());

      await algebraVault.connect(wallet).rebalance(13200, 15600, 12000, 13200, 0);
      expect(await algebraVault.basePositionId()).to.not.equal(0);
      expect(await nft.tokenFarmedIn(await algebraVault.basePositionId())).to.equal(await farmingCenter.getAddress());

      // Generate swap fees
      await router.connect(carol).exactInputSingle({
        tokenIn: await token1.getAddress(),
        tokenOut: await token0.getAddress(),
        deployer: NULL_ADDRESS,
        recipient: await carol.getAddress(),
        deadline: 9999999999999,
        amountIn: ethers.parseEther('10000'),
        amountOutMinimum: 0,
        limitSqrtPrice: 0,
      });

      await network.provider.send('evm_increaseTime', [3600]);
      await network.provider.send('evm_mine');

      await snapshotGasCost(algebraVault.collectFees());
    });
  });

  describe('FarmingRewardsDistributor', () => {
    beforeEach('create farming', async () => {
      // Create farming incentive
      const nonce = await algebraEternalFarming.numOfIncentives();
      await token1.approve(await algebraEternalFarming.getAddress(), bonusReward);
      await token2.approve(await algebraEternalFarming.getAddress(), totalReward);
      const pluginAddress = await algebraPool.plugin();

      await algebraEternalFarming.createEternalFarming(
        {
          pool: await algebraPool.getAddress(),
          rewardToken: await token2.getAddress(),
          bonusRewardToken: await token1.getAddress(),
          nonce,
        },
        {
          reward: totalReward,
          bonusReward: bonusReward,
          rewardRate: ethers.parseEther('1'),
          bonusRewardRate: ethers.parseEther('0.03'),
          minimalPositionWidth: 1,
        },
        pluginAddress,
      );

      // Rebalance to enter farming
      await algebraVault.connect(wallet).rebalance(-1800, -60, 60, 15000, 0);

      // Distribute farming rewards
      await router.connect(carol).exactInputSingle({
        tokenIn: await token1.getAddress(),
        tokenOut: await token0.getAddress(),
        deployer: NULL_ADDRESS,
        recipient: await carol.getAddress(),
        deadline: 9999999999999,
        amountIn: veryLargeTokenAmount,
        amountOutMinimum: 0,
        limitSqrtPrice: 0,
      });

      await network.provider.send('evm_increaseTime', [3600]);
      await network.provider.send('evm_mine');
    });

    it('stake: first stake', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());
      await algebraVault.connect(alice).approve(await farmingRewardsDistributor.getAddress(), giantTokenAmount);

      const lpBalance = await algebraVault.balanceOf(await alice.getAddress());
      await snapshotGasCost(farmingRewardsDistributor.connect(alice).stake(lpBalance, await alice.getAddress()));
    });

    it('stake: second stake (different user)', async () => {
      // First staker
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());
      await algebraVault.connect(alice).approve(await farmingRewardsDistributor.getAddress(), giantTokenAmount);
      const aliceLp = await algebraVault.balanceOf(await alice.getAddress());
      await farmingRewardsDistributor.connect(alice).stake(aliceLp, await alice.getAddress());

      // Collect and update rewards
      await algebraVault.collectRewards();
      await farmingRewardsDistributor.updateReward();

      await network.provider.send('evm_increaseTime', [3600]);
      await network.provider.send('evm_mine');

      // Second staker
      await algebraVault.connect(bob).deposit(ethers.parseEther('2000'), 0, await bob.getAddress());
      await algebraVault.connect(bob).approve(await farmingRewardsDistributor.getAddress(), giantTokenAmount);

      const bobLp = await algebraVault.balanceOf(await bob.getAddress());
      await snapshotGasCost(farmingRewardsDistributor.connect(bob).stake(bobLp, await bob.getAddress()));
    });

    it('unstake: full unstake', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());
      await algebraVault.connect(alice).approve(await farmingRewardsDistributor.getAddress(), giantTokenAmount);

      const lpBalance = await algebraVault.balanceOf(await alice.getAddress());
      await farmingRewardsDistributor.connect(alice).stake(lpBalance, await alice.getAddress());

      // Some time passes
      await network.provider.send('evm_increaseTime', [3600]);
      await network.provider.send('evm_mine');

      await snapshotGasCost(farmingRewardsDistributor.connect(alice).unstake(lpBalance));
    });

    it('getAllRewards', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());
      await algebraVault.connect(alice).approve(await farmingRewardsDistributor.getAddress(), giantTokenAmount);

      const lpBalance = await algebraVault.balanceOf(await alice.getAddress());
      await farmingRewardsDistributor.connect(alice).stake(lpBalance, await alice.getAddress());

      // Collect rewards and update
      await algebraVault.collectRewards();
      await farmingRewardsDistributor.updateReward();

      await network.provider.send('evm_increaseTime', [3600]);
      await network.provider.send('evm_mine');

      await snapshotGasCost(farmingRewardsDistributor.connect(alice).getAllRewards());
    });

    it('updateReward: update after rewards collected', async () => {
      await algebraVault.connect(alice).deposit(ethers.parseEther('4000'), 0, await alice.getAddress());
      await algebraVault.connect(alice).approve(await farmingRewardsDistributor.getAddress(), giantTokenAmount);

      const lpBalance = await algebraVault.balanceOf(await alice.getAddress());
      await farmingRewardsDistributor.connect(alice).stake(lpBalance, await alice.getAddress());

      // Collect rewards
      await algebraVault.collectRewards();

      await snapshotGasCost(farmingRewardsDistributor.updateReward());
    });
  });

  describe('Factory Operations', () => {
    it('createAlgebraVault', async () => {
      await factory.createPool(await token1.getAddress(), await token2.getAddress(), '0x');

      const poolAddress = await factory.poolByPair(await token1.getAddress(), await token2.getAddress());

      algebraPool = (await ethers.getContractAt('IAlgebraPool', poolAddress)) as IAlgebraPool;
      await algebraPool.initialize(encodePriceSqrt('1', '1'));
      await snapshotGasCost(
        algebraVaultFactory
          .connect(wallet)
          .createAlgebraVault(await token1.getAddress(), true, await token2.getAddress(), false),
      );
    });

    it('setFeeRecipient', async () => {
      await snapshotGasCost(algebraVaultFactory.connect(wallet).setFeeRecipient(await alice.getAddress()));
    });

    it('setBaseFee', async () => {
      await snapshotGasCost(algebraVaultFactory.connect(wallet).setBaseFee(ethers.parseEther('0.15')));
    });

    it('setAmmFee', async () => {
      await snapshotGasCost(algebraVaultFactory.connect(wallet).setAmmFee(ethers.parseEther('0.05')));
    });

    it('setBaseFeeSplit', async () => {
      await snapshotGasCost(algebraVaultFactory.connect(wallet).setBaseFeeSplit(ethers.parseEther('0.3')));
    });
  });
});

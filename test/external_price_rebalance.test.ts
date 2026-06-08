import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers, network } from 'hardhat';

import {
  AlgebraVault,
  AlgebraVaultDepositGuard,
  AlgebraVaultFactory,
  IAlgebraFactory,
  IAlgebraPool,
  INonfungiblePositionManager,
  TestERC20,
} from '../types';
import { algebraVaultTestFixture } from './shared/fixtures';
import { FeeAmount, TICK_SPACINGS, encodePriceSqrt, getMaxTick, getMinTick, getPositionKey } from './shared/utilities';

const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';
const depositAmount = ethers.parseEther('100000');
const keeperMaxInput = 1000n;

describe('External Price AlgebraVault', () => {
  let wallet: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let keeper: HardhatEthersSigner;
  let externalLp: HardhatEthersSigner;

  let factory: IAlgebraFactory;
  let nft: INonfungiblePositionManager;
  let token0: TestERC20;
  let token1: TestERC20;
  let pool: IAlgebraPool;
  let vaultFactory: AlgebraVaultFactory;
  let depositGuard: AlgebraVaultDepositGuard;
  let vault: AlgebraVault;

  before('load signers', async () => {
    [wallet, alice, keeper, externalLp] = await (ethers as any).getSigners();
  });

  beforeEach('deploy pool and dual-token vault', async () => {
    ({
      factory,
      nft,
      token0,
      token1,
      algebraVaultFactory: vaultFactory,
      depositGuard,
    } = await loadFixture(algebraVaultTestFixture));

    await factory.createPool(await token0.getAddress(), await token1.getAddress(), '0x');
    const poolAddress = await factory.poolByPair(await token0.getAddress(), await token1.getAddress());
    pool = (await ethers.getContractAt('IAlgebraPool', poolAddress)) as IAlgebraPool;
    await pool.initialize(encodePriceSqrt(1, 1));

    await vaultFactory
      .connect(wallet)
      .createAlgebraVault(await token0.getAddress(), true, await token1.getAddress(), true);
    const vaultKey = await vaultFactory.genKey(
      await wallet.getAddress(),
      await token0.getAddress(),
      await token1.getAddress(),
      true,
      true,
    );
    vault = (await ethers.getContractAt('AlgebraVault', await vaultFactory.getAlgebraVault(vaultKey))) as AlgebraVault;

    await vault.connect(wallet).setDepositMax(depositAmount * 10n, depositAmount * 10n);
    await network.provider.send('evm_increaseTime', [3600]);

    await token0.mint(await alice.getAddress(), depositAmount * 2n);
    await token1.mint(await alice.getAddress(), depositAmount * 2n);
    await token0.connect(alice).approve(await vault.getAddress(), depositAmount);
    await token1.connect(alice).approve(await vault.getAddress(), depositAmount);
  });

  it('accepts both pool tokens directly and through the deposit guard', async () => {
    await vault.connect(alice).deposit(depositAmount, depositAmount, await alice.getAddress());
    expect(await vault.balanceOf(await alice.getAddress())).to.be.gt(0);

    await token0.connect(alice).approve(await depositGuard.getAddress(), depositAmount);
    await token1.connect(alice).approve(await depositGuard.getAddress(), depositAmount);

    await expect(
      depositGuard
        .connect(alice)
        .forwardDualDepositToAlgebraVault(
          await vault.getAddress(),
          await wallet.getAddress(),
          depositAmount,
          depositAmount,
          0,
          await alice.getAddress(),
        ),
    ).to.emit(depositGuard, 'DualDepositForwarded');
  });

  it('moves price up and down using a single narrow position at the target price', async () => {
    await vault.connect(alice).deposit(depositAmount, depositAmount, await alice.getAddress());
    await vault.connect(wallet).rebalance(-600, 600, 600, 1200, 0);

    await token0.mint(await keeper.getAddress(), keeperMaxInput);
    await token1.mint(await keeper.getAddress(), keeperMaxInput);
    await token0.connect(keeper).approve(await vault.getAddress(), keeperMaxInput);
    await token1.connect(keeper).approve(await vault.getAddress(), keeperMaxInput);

    const upwardTarget = encodePriceSqrt(2, 1);
    const keeperToken1Before = await token1.balanceOf(await keeper.getAddress());
    await vault
      .connect(wallet)
      .rebalanceToExternalPrice(6600, 7200, 7200, 7800, upwardTarget, await keeper.getAddress(), keeperMaxInput);

    expect((await pool.safelyGetStateOfAMM())[0]).to.equal(upwardTarget);
    const upwardInput = keeperToken1Before - (await token1.balanceOf(await keeper.getAddress()));
    expect(upwardInput).to.be.gt(0);
    expect(upwardInput).to.be.lte(10);
    expect(await vault.basePositionId()).to.be.gt(0);
    expect(await vault.limitPositionId()).to.be.gt(0);

    const upwardTargetTick = Number(await vault.currentTick());
    const upwardTargetLower = Math.floor(upwardTargetTick / 60) * 60;
    await expectTemporaryPositionRemoved(upwardTargetLower, upwardTargetLower + 60);

    const downwardTarget = encodePriceSqrt(1, 1);
    const keeperToken0Before = await token0.balanceOf(await keeper.getAddress());
    await vault
      .connect(wallet)
      .rebalanceToExternalPrice(-600, 600, -1200, -600, downwardTarget, await keeper.getAddress(), keeperMaxInput);

    expect((await pool.safelyGetStateOfAMM())[0]).to.equal(downwardTarget);
    const downwardInput = keeperToken0Before - (await token0.balanceOf(await keeper.getAddress()));
    expect(downwardInput).to.be.gt(0);
    expect(downwardInput).to.be.lte(10);

    await expectTemporaryPositionRemoved(0, 60);
  });

  it('rejects an external-price rebalance while external active liquidity remains', async () => {
    await vault.connect(alice).deposit(depositAmount, depositAmount, await alice.getAddress());
    await vault.connect(wallet).rebalance(-600, 600, 600, 1200, 0);

    await token0.mint(await externalLp.getAddress(), depositAmount);
    await token1.mint(await externalLp.getAddress(), depositAmount);
    await token0.connect(externalLp).approve(await nft.getAddress(), depositAmount);
    await token1.connect(externalLp).approve(await nft.getAddress(), depositAmount);
    await nft.connect(externalLp).mint({
      token0: await token0.getAddress(),
      token1: await token1.getAddress(),
      deployer: NULL_ADDRESS,
      tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
      tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
      recipient: await externalLp.getAddress(),
      amount0Desired: depositAmount,
      amount1Desired: depositAmount,
      amount0Min: 0,
      amount1Min: 0,
      deadline: 2000000000,
    });

    await token1.mint(await keeper.getAddress(), keeperMaxInput);
    await token1.connect(keeper).approve(await vault.getAddress(), keeperMaxInput);

    await expect(
      vault
        .connect(wallet)
        .rebalanceToExternalPrice(
          6600,
          7200,
          7200,
          7800,
          encodePriceSqrt(2, 1),
          await keeper.getAddress(),
          keeperMaxInput,
        ),
    ).to.be.revertedWithCustomError(vault, 'NonZeroLiquidity');
  });

  it('reverts when the input limit is insufficient to reach the exact target', async () => {
    await vault.connect(alice).deposit(depositAmount, depositAmount, await alice.getAddress());
    await vault.connect(wallet).rebalance(-600, 600, 600, 1200, 0);

    await token1.mint(await keeper.getAddress(), 1);
    await token1.connect(keeper).approve(await vault.getAddress(), 1);

    await expect(
      vault
        .connect(wallet)
        .rebalanceToExternalPrice(6600, 7200, 7200, 7800, encodePriceSqrt(2, 1), await keeper.getAddress(), 1),
    ).to.be.revertedWithCustomError(vault, 'TargetPriceNotReached');
  });

  async function expectTemporaryPositionRemoved(tickLower: number, tickUpper: number) {
    const key = getPositionKey(await vault.getAddress(), tickLower, tickUpper);
    expect((await pool.positions(key))[0]).to.equal(0);
  }
});

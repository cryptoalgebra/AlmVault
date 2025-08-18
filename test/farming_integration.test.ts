import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {expect} from "chai";
import {ethers, network} from "hardhat";
import {
    IAlgebraEternalFarming,
    IAlgebraFactory,
    IFarmingCenter,
    INonfungiblePositionManager,
    IFarmingRewardsDistributor,
    IAlgebraPool,
    AlgebraVault,
    AlgebraVaultFactory,
    TestERC20, ISwapRouter,
} from "../types";
import {algebraVaultTestFixture} from "./shared/fixtures";
import {FeeAmount, TICK_SPACINGS, encodePriceSqrt, getMaxTick, getMinTick} from "./shared/utilities";

const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";

const largeTokenAmount = ethers.utils.parseEther("1000000");
const veryLargeTokenAmount = ethers.utils.parseEther("10000000000");
const giantTokenAmount = ethers.utils.parseEther("1000000000000");

describe("Farming Integration", () => {
    const totalReward = ethers.utils.parseEther("2000000");
    const bonusReward = ethers.utils.parseEther("4000");

    let factory: IAlgebraFactory;
    let nft: INonfungiblePositionManager;
    let token0: TestERC20;
    let token1: TestERC20;
    let token2: TestERC20;
    let algebraPool: IAlgebraPool;
    let router: ISwapRouter;
    let algebraVaultFactory: AlgebraVaultFactory;
    let algebraEternalFarming: IAlgebraEternalFarming;
    let farmingCenter: IFarmingCenter;
    let algebraVault: AlgebraVault;

    let wallet: SignerWithAddress;
    let alice: SignerWithAddress;
    let bob: SignerWithAddress;
    let carol: SignerWithAddress;
    let other: SignerWithAddress;

    before("create fixture loader", async () => {
        [wallet, alice, bob, carol, other] = await ethers.getSigners();
    });

    beforeEach("deploy contracts", async () => {
        ({
            token0,
            token1,
            token2,
            factory,
            router,
            nft,
            algebraVaultFactory,
            algebraEternalFarming,
            farmingCenter
        } = await loadFixture(
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
                rewardRate: ethers.utils.parseEther("1"),
                bonusRewardRate: ethers.utils.parseEther("0.03"),
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

        await token0.connect(carol).approve(router.address, veryLargeTokenAmount);
        await token1.connect(carol).approve(router.address, veryLargeTokenAmount);

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

    describe("With deposits", () => {
        beforeEach("setup", async () => {
            // alice approves the AlgebraVault to transfer her tokens
            await token0.connect(alice).approve(algebraVault.address, largeTokenAmount);
            await token1.connect(alice).approve(algebraVault.address, largeTokenAmount);
            // mint tokens to alice
            await token0.mint(alice.address, largeTokenAmount);
            await token1.mint(alice.address, largeTokenAmount);
        })

        it("Enters farming on rebalance", async () => {
            await algebraVault
                .connect(alice)
                .deposit(ethers.utils.parseEther("4000"), 0, alice.address);

            await algebraVault.connect(wallet).rebalance(-1800, -60, 60, 15000, 0);
            const balance0 = await token0.balanceOf(algebraVault.address);
            const balance1 = await token1.balanceOf(algebraVault.address);
            expect(balance0).to.be.equal(0);
            expect(balance1).to.be.equal(0);

            expect(await nft.tokenFarmedIn(2)).to.be.equal(farmingCenter.address);
        });

        it("CollectRewards()", async () => {
            await algebraVault
                .connect(alice)
                .deposit(ethers.utils.parseEther("4000"), 0, alice.address);

            await algebraVault.connect(wallet).rebalance(-1800, -60, 60, 15000, 0);
            await algebraVault.setFarmingRewardsDistributor(other.address)

            await router.connect(carol).exactInputSingle({
                tokenIn: token1.address,
                tokenOut: token0.address,
                deployer: NULL_ADDRESS,
                recipient: carol.address,
                deadline: 9999999999999,
                amountIn: veryLargeTokenAmount,
                amountOutMinimum: 0,
                limitSqrtPrice: 0
            })

            await network.provider.send("evm_increaseTime", [3600]);

            await algebraVault.collectRewards()
            const rewardBalance = await token2.balanceOf(other.address);
            const bonusRewardBalance = await token1.balanceOf(other.address);

            expect(rewardBalance).to.be.greaterThan(0)
            expect(bonusRewardBalance).to.be.greaterThan(0)
        })

        describe("Rewards Distribution", () => {
            let farmingRewardsDistributor: IFarmingRewardsDistributor;

            beforeEach("Earn initial rewards", async () => {
                farmingRewardsDistributor = (await ethers.getContractAt("FarmingRewardsDistributor", await algebraVault.farmingRewardsDistributor())) as IFarmingRewardsDistributor;
                await farmingRewardsDistributor.addReward(token2.address)
                await farmingRewardsDistributor.addReward(token1.address)

                await token0.approve(algebraVault.address, veryLargeTokenAmount);
                await token1.approve(algebraVault.address, veryLargeTokenAmount);

                await algebraVault.deposit(ethers.utils.parseEther("1"), 0, wallet.address);
                await algebraVault.approve(farmingRewardsDistributor.address, giantTokenAmount);

                await algebraVault.connect(wallet).rebalance(-1800, -60, 60, 15000, 0);
                await router.connect(carol).exactInputSingle({
                    tokenIn: token1.address,
                    tokenOut: token0.address,
                    deployer: NULL_ADDRESS,
                    recipient: carol.address,
                    deadline: 9999999999999,
                    amountIn: veryLargeTokenAmount,
                    amountOutMinimum: 0,
                    limitSqrtPrice: 0
                })

                await network.provider.send("evm_increaseTime", [3600]);
            })

            it("Collects rewards on first stake but does not update", async () => {
                await algebraVault
                    .connect(alice)
                    .deposit(ethers.utils.parseEther("4000"), 0, alice.address);
                await algebraVault.connect(alice).approve(farmingRewardsDistributor.address, giantTokenAmount);

                const lpBalance = await algebraVault.balanceOf(alice.address);
                await farmingRewardsDistributor.connect(alice).stake(lpBalance, alice.address);

                const rewardData = await farmingRewardsDistributor.rewardData(token2.address)
                expect(rewardData[2]).to.be.equal(0)

                const rewardBalance = await token2.balanceOf(farmingRewardsDistributor.address);
                const bonusRewardBalance = await token1.balanceOf(farmingRewardsDistributor.address);

                expect(rewardBalance).to.be.greaterThan(0)
                expect(bonusRewardBalance).to.be.greaterThan(0)
            })

            it("Should handle rewards accrual when no users are staking", async () => {
                await algebraVault.collectRewards();

                // Get initial rewards in the distributor
                const initialToken2Balance = await token2.balanceOf(farmingRewardsDistributor.address);
                const initialToken1Balance = await token1.balanceOf(farmingRewardsDistributor.address);

                expect(initialToken2Balance).to.be.greaterThan(0);
                expect(initialToken1Balance).to.be.greaterThan(0);

                // Verify rewardPerToken remains 0 when no stakers
                const rewardDataToken2 = await farmingRewardsDistributor.rewardData(token2.address);
                expect(rewardDataToken2[2]).to.equal(0); // rewardPerToken should be 0

                // Now add a staker
                await algebraVault
                    .connect(alice)
                    .deposit(ethers.utils.parseEther("4000"), 0, alice.address);
                await algebraVault.connect(alice).approve(farmingRewardsDistributor.address, giantTokenAmount);

                const aliceLpBalance = await algebraVault.balanceOf(alice.address);
                await farmingRewardsDistributor.connect(alice).stake(aliceLpBalance, alice.address);

                // Generate more rewards
                // await plugin.updateVirtualPoolTick(550, false);
                await network.provider.send("evm_increaseTime", [3600]);
                await algebraVault.collectRewards();
                await farmingRewardsDistributor.updateReward();

                // Check that rewardPerToken is now updated
                const updatedRewardDataToken2 = await farmingRewardsDistributor.rewardData(token2.address);
                expect(updatedRewardDataToken2[2]).to.be.greaterThan(0);

                // New rewards should only include those generated after staking
                const [, amounts] = await farmingRewardsDistributor.claimableRewards(alice.address);

                // Alice should get all new rewards but including the initial ones
                const currentToken2Balance = await token2.balanceOf(farmingRewardsDistributor.address);

                expect(amounts[0]).to.be.closeTo(currentToken2Balance, 1);
            })

            describe("Not first stakers", () => {
                beforeEach("Clean rewards", async () => {
                    await farmingRewardsDistributor.stake(await algebraVault.balanceOf(wallet.address), wallet.address);

                    // Reset rewards for the subsequent tests
                    await farmingRewardsDistributor.updateReward();

                    await farmingRewardsDistributor.unstake(await farmingRewardsDistributor.totalBalance(wallet.address));
                    await farmingRewardsDistributor.getReward(wallet.address, [token1.address, token2.address]);
                })

                it("Should handle unstaking correctly and update reward claims", async () => {
                    // Setup initial stake
                    await algebraVault
                        .connect(alice)
                        .deposit(ethers.utils.parseEther("4000"), 0, alice.address);
                    await algebraVault.connect(alice).approve(farmingRewardsDistributor.address, giantTokenAmount);

                    let aliceLpBalance = await algebraVault.balanceOf(alice.address);
                    await farmingRewardsDistributor.connect(alice).stake(aliceLpBalance, alice.address);
                    await farmingRewardsDistributor.updateReward();

                    // Get starting claimable rewards
                    const [, startingAmounts] = await farmingRewardsDistributor.claimableRewards(alice.address);

                    // Generate some rewards
                    // await plugin.updateVirtualPoolTick(550, false);
                    await network.provider.send("evm_increaseTime", [3600]);
                    await algebraVault.collectRewards();
                    await farmingRewardsDistributor.updateReward();

                    // Get initial claimable rewards
                    const [, initialAmounts] = await farmingRewardsDistributor.claimableRewards(alice.address);

                    // Unstake half of the tokens
                    const totalStaked = await farmingRewardsDistributor.totalBalance(alice.address);
                    await farmingRewardsDistributor.connect(alice).unstake(totalStaked.div(2));

                    // Check that rewards were calculated and made claimable during unstake
                    const claimableAfterUnstake = await farmingRewardsDistributor.claimable(token2.address, alice.address);

                    // Slightly more rewards, because of accumulation while unstaking
                    expect(claimableAfterUnstake).to.be.closeTo(initialAmounts[0], ethers.utils.parseEther("1"));

                    // Generate more rewards
                    // await plugin.updateVirtualPoolTick(600, false);
                    await network.provider.send("evm_increaseTime", [3600]);
                    await algebraVault.collectRewards();
                    await farmingRewardsDistributor.updateReward();

                    // Get final claimable rewards
                    const [, finalAmounts] = await farmingRewardsDistributor.claimableRewards(alice.address);

                    // New rewards should accrue at half the rate (since half tokens unstaked)
                    const previousReward = initialAmounts[0].sub(startingAmounts[0]);
                    const newRewardsAccrued = finalAmounts[0].sub(previousReward).sub(startingAmounts[0]);
                    const previousTotalRewards = previousReward.mul(2); // Double the claimed amount as estimate


                    const accruedRewardsDiff = newRewardsAccrued.mul(100).div(previousTotalRewards);

                    // With 50% of original tokens, rewards should be ~50% of what they were before
                    expect(accruedRewardsDiff).to.be.within(45, 55); // Allow for some rounding
                })

                it("Handles getReward for specific reward tokens correctly", async () => {
                    // Setup Bob for testing
                    await token0.mint(bob.address, largeTokenAmount);
                    await token1.mint(bob.address, largeTokenAmount);
                    await token0.connect(bob).approve(algebraVault.address, largeTokenAmount);
                    await token1.connect(bob).approve(algebraVault.address, largeTokenAmount);
                    await algebraVault.connect(bob).deposit(ethers.utils.parseEther("2000"), 0, bob.address);

                    // Rebalance to enter farming
                    await algebraVault.connect(wallet).rebalance(60, 15000, -1800, -60, 0);

                    // Generate rewards
                    // await plugin.updateVirtualPoolTick(500, false);
                    await network.provider.send("evm_increaseTime", [3600]);
                    await algebraVault.collectRewards();



                    // Stake LP tokens
                    const bobLpBalance = await algebraVault.balanceOf(bob.address);
                    await algebraVault.connect(bob).approve(farmingRewardsDistributor.address, bobLpBalance);
                    await farmingRewardsDistributor.connect(bob).stake(bobLpBalance, bob.address);


                    // Generate more rewards
                    // await plugin.updateVirtualPoolTick(550, false);
                    await network.provider.send("evm_increaseTime", [3600]);
                    await algebraVault.collectRewards();
                    await farmingRewardsDistributor.updateReward();


                    // Check initial balances
                    const initialToken2Balance = await token2.balanceOf(bob.address);
                    const initialToken1Balance = await token1.balanceOf(bob.address);

                    // Get claimable amounts for reference
                    const [, amounts] = await farmingRewardsDistributor.claimableRewards(bob.address);
                    const expectedToken2Reward = amounts[0];
                    const expectedToken1Reward = amounts[1];

                    // Claim only token2 rewards
                    const rewardsToGet = [token2.address];
                    const claimTx = await farmingRewardsDistributor.connect(bob).getReward(bob.address, rewardsToGet);
                    const claimReceipt = await claimTx.wait();

                    // Extract claimed amounts from RewardPaid events
                    const rewardPaidEvents = claimReceipt.events?.filter(e => e.event === 'RewardPaid') || [];
                    expect(rewardPaidEvents.length).to.equal(1);
                    const token2Event = rewardPaidEvents.find(e => e.args?.rewardToken === token2.address);
                    expect(token2Event).to.not.be.undefined;
                    const claimedToken2Amount = token2Event?.args?.reward;

                    // Check that only token2 was claimed
                    const finalToken2Balance = await token2.balanceOf(bob.address);
                    const finalToken1Balance = await token1.balanceOf(bob.address);

                    expect(claimedToken2Amount).to.be.closeTo(expectedToken2Reward, ethers.utils.parseEther("1"));
                    expect(finalToken2Balance).to.be.closeTo(initialToken2Balance.add(expectedToken2Reward), ethers.utils.parseEther("1"));
                    expect(finalToken1Balance).to.be.equal(initialToken1Balance); // Should remain unchanged

                    // Now claim token1 rewards
                    const token1RewardsToGet = [token1.address];
                    const token1ClaimTx = await farmingRewardsDistributor.connect(bob).getReward(bob.address, token1RewardsToGet);
                    const token1ClaimReceipt = await token1ClaimTx.wait();

                    // Extract claimed amounts from RewardPaid events
                    const token1RewardPaidEvents = token1ClaimReceipt.events?.filter(e => e.event === 'RewardPaid') || [];
                    const token1Event = token1RewardPaidEvents.find(e => e.args?.rewardToken === token1.address);
                    const claimedToken1Amount = token1Event?.args?.reward;

                    // Verify token1 was claimed correctly
                    const afterToken1ClaimBalance = await token1.balanceOf(bob.address);
                    expect(claimedToken1Amount).to.be.closeTo(expectedToken1Reward, ethers.utils.parseEther("1"));
                    expect(afterToken1ClaimBalance).to.be.closeTo(initialToken1Balance.add(expectedToken1Reward), ethers.utils.parseEther("1"));
                })

                it("Distributes rewards correctly between multiple users", async () => {
                    // Setup Bob's account
                    await token0.mint(bob.address, largeTokenAmount);
                    await token1.mint(bob.address, largeTokenAmount);
                    await token0.connect(bob).approve(algebraVault.address, largeTokenAmount);
                    await token1.connect(bob).approve(algebraVault.address, largeTokenAmount);

                    // Both deposit

                    await algebraVault.connect(alice).deposit(ethers.utils.parseEther("2000"), 0, alice.address);
                    await algebraVault.connect(bob).deposit(ethers.utils.parseEther("1000"), 0, bob.address);

                    // Rebalance to enter farming
                    await algebraVault.connect(wallet).rebalance(120, 15000, -1800, -60, 0);

                    // Both stake their LP tokens
                    const aliceLpBalance = await algebraVault.balanceOf(alice.address);
                    const bobLpBalance = await algebraVault.balanceOf(bob.address);
                    await algebraVault.connect(alice).approve(farmingRewardsDistributor.address, aliceLpBalance);
                    await algebraVault.connect(bob).approve(farmingRewardsDistributor.address, bobLpBalance);

                    await farmingRewardsDistributor.connect(alice).stake(aliceLpBalance, alice.address);
                    await farmingRewardsDistributor.connect(bob).stake(bobLpBalance, bob.address);

                    // Fast forward to accumulate more rewards
                    // await plugin.updateVirtualPoolTick(600, false);
                    await network.provider.send("evm_increaseTime", [7200]);
                    await algebraVault.collectRewards();
                    await farmingRewardsDistributor.updateReward();

                    // Check rewards distribution proportions
                    const [, aliceAmounts] = await farmingRewardsDistributor.claimableRewards(alice.address);
                    const [, bobAmounts] = await farmingRewardsDistributor.claimableRewards(bob.address);

                    // Alice should have approximately 2x the rewards of Bob based on stake ratio
                    const aliceReward = aliceAmounts[0];
                    const bobReward = bobAmounts[0];
                    const ratio = aliceReward.mul(100).div(bobReward);

                    // Allow some margin of error, but ratio should be close to 200 (2:1)
                    expect(ratio).to.be.within(190, 210);

                    // Claim rewards and verify they received the correct amounts
                    const aliceRewardsBefore = await token2.balanceOf(alice.address);
                    const bobRewardsBefore = await token2.balanceOf(bob.address);

                    await farmingRewardsDistributor.connect(alice).getAllRewards();
                    await farmingRewardsDistributor.connect(bob).getAllRewards();

                    const aliceRewardsAfter = await token2.balanceOf(alice.address);
                    const bobRewardsAfter = await token2.balanceOf(bob.address);

                    const aliceRewardsClaimed = aliceRewardsAfter.sub(aliceRewardsBefore);
                    const bobRewardsClaimed = bobRewardsAfter.sub(bobRewardsBefore);

                    expect(aliceRewardsClaimed).to.be.closeTo(aliceReward, ethers.utils.parseEther("1"));
                    expect(bobRewardsClaimed).to.be.closeTo(bobReward, ethers.utils.parseEther("1"));
                })

                it("Updates rewards on the subsequent stakes", async () => {
                    await algebraVault.connect(alice).deposit(ethers.utils.parseEther("4000"), 0, alice.address);
                    await algebraVault.connect(alice).approve(farmingRewardsDistributor.address, giantTokenAmount);

                    let lpBalance = await algebraVault.balanceOf(alice.address);
                    await farmingRewardsDistributor.connect(alice).stake(lpBalance.div(2), alice.address);

                    lpBalance = await algebraVault.balanceOf(alice.address);
                    
                    await farmingRewardsDistributor.connect(alice).stake(lpBalance, alice.address);

                    await network.provider.send("evm_increaseTime", [7200]);

                    const rewardData = await farmingRewardsDistributor.rewardData(token2.address)
                    const rewardDataBonus = await farmingRewardsDistributor.rewardData(token2.address)
                    expect(rewardData[2]).to.be.greaterThan(0)
                    expect(rewardDataBonus[2]).to.be.greaterThan(0)

                    await farmingRewardsDistributor.updateReward()
                    const rewardBalance = await token2.balanceOf(farmingRewardsDistributor.address);
                    const bonusRewardBalance = await token1.balanceOf(farmingRewardsDistributor.address);

                    const [claimableTokens, claimableAmounts] = await farmingRewardsDistributor.claimableRewards(alice.address);
                    expect(claimableTokens[0]).to.be.equal(token2.address)
                    expect(claimableTokens[1]).to.be.equal(token1.address)
                    expect(claimableAmounts[0]).to.be.closeTo(rewardBalance, 2)
                    expect(claimableAmounts[1]).to.be.closeTo(bonusRewardBalance, 2)
                })

                it("Transfers rewards to distributor contract on alm deposit", async () => {
                    await algebraVault.connect(alice).deposit(ethers.utils.parseEther("4000"), 0, alice.address);
                    await algebraVault.connect(alice).approve(farmingRewardsDistributor.address, giantTokenAmount);

                    let lpBalance = await algebraVault.balanceOf(alice.address);
                    await farmingRewardsDistributor.connect(alice).stake(lpBalance, alice.address);

                    const rewardsBeforeData = await token2.balanceOf(farmingRewardsDistributor.address)

                    await network.provider.send("evm_increaseTime", [7200]);
                    await algebraVault.connect(alice).deposit(ethers.utils.parseEther("4000"), 0, alice.address)

                    const rewardsAfterData = await token2.balanceOf(farmingRewardsDistributor.address)

                    expect(rewardsAfterData).to.be.greaterThan(rewardsBeforeData)
                })

                it("Transfers rewards to distributor contract on rebalance", async () => {
                    await algebraVault.connect(alice).deposit(ethers.utils.parseEther("4000"), 0, alice.address);
                    await algebraVault.connect(alice).approve(farmingRewardsDistributor.address, giantTokenAmount);

                    let lpBalance = await algebraVault.balanceOf(alice.address);
                    await farmingRewardsDistributor.connect(alice).stake(lpBalance, alice.address);

                    const rewardsBeforeData = await token2.balanceOf(farmingRewardsDistributor.address)

                    await network.provider.send("evm_increaseTime", [7200]);
                    await algebraVault.connect(wallet).rebalance(-1800, -60, 60, 15000, 0);

                    const rewardsAfterData = await token2.balanceOf(farmingRewardsDistributor.address)

                    expect(rewardsAfterData).to.be.greaterThan(rewardsBeforeData)
                })

                it("Transfers rewards to distributor contract on withdraw", async () => {
                    await algebraVault.connect(alice).deposit(ethers.utils.parseEther("4000"), 0, alice.address);
                    await algebraVault.connect(alice).approve(farmingRewardsDistributor.address, giantTokenAmount);

                    let lpBalance = await algebraVault.balanceOf(alice.address);

                    await farmingRewardsDistributor.connect(alice).stake(lpBalance.sub(1000), alice.address);

                    const rewardsBeforeData = await token2.balanceOf(farmingRewardsDistributor.address)

                    await network.provider.send("evm_increaseTime", [7200]);
                    await algebraVault.connect(alice).withdraw(1000, alice.address);

                    const rewardsAfterData = await token2.balanceOf(farmingRewardsDistributor.address)

                    expect(rewardsAfterData).to.be.greaterThan(rewardsBeforeData)
                })

            })

        })

        describe("Farming detach", () => {
            let farmingRewardsDistributor: IFarmingRewardsDistributor;

                beforeEach("Earn initial rewards", async () => {
                    farmingRewardsDistributor = (await ethers.getContractAt("FarmingRewardsDistributor", await algebraVault.farmingRewardsDistributor())) as IFarmingRewardsDistributor;

                    await token0.approve(algebraVault.address, veryLargeTokenAmount);
                    await token1.approve(algebraVault.address, veryLargeTokenAmount);

                    await algebraVault.deposit(ethers.utils.parseEther("1"), 0, wallet.address);
                    await algebraVault.approve(farmingRewardsDistributor.address, giantTokenAmount);

                    await algebraVault.connect(wallet).rebalance(-1800, -60, 60, 15000, 0);
                    await router.connect(carol).exactInputSingle({
                        tokenIn: token1.address,
                        tokenOut: token0.address,
                        deployer: NULL_ADDRESS,
                        recipient: carol.address,
                        deadline: 9999999999999,
                        amountIn: veryLargeTokenAmount,
                        amountOutMinimum: 0,
                        limitSqrtPrice: 0
                    })

                    await network.provider.send("evm_increaseTime", [3600]);

                    await farmingRewardsDistributor.stake(await algebraVault.balanceOf(wallet.address), wallet.address);

                    // Reset rewards for the subsequent tests
                    await farmingRewardsDistributor.updateReward();

                    await farmingRewardsDistributor.unstake(await farmingRewardsDistributor.totalBalance(wallet.address));
                    await farmingRewardsDistributor.getReward(wallet.address, [token1.address, token2.address]);
                })


                it("pos has rewards after detach", async () => {
                    await algebraVault.connect(alice).deposit(ethers.utils.parseEther("4000"), 0, alice.address);
                    await algebraVault.connect(alice).approve(farmingRewardsDistributor.address, giantTokenAmount);

                    let lpBalance = await algebraVault.balanceOf(alice.address);
                    await farmingRewardsDistributor.connect(alice).stake(lpBalance.div(2), alice.address);
                    
                    const rewardsBeforeData = await token2.balanceOf(farmingRewardsDistributor.address)

                    await network.provider.send("evm_increaseTime", [7200]);
                    await algebraEternalFarming.deactivateIncentive(
                    {
                            pool: algebraPool.address,
                            rewardToken: token2.address,
                            bonusRewardToken: token1.address,
                            nonce: 0,
                    })
                    
                    await token1.approve(algebraEternalFarming.address, bonusReward);
                    await token2.approve(algebraEternalFarming.address, totalReward);

                    await algebraEternalFarming.createEternalFarming(
                        {
                            pool: algebraPool.address,
                            rewardToken: token2.address,
                            bonusRewardToken: token1.address,
                            nonce: 1,
                        },
                        {
                            reward: totalReward,
                            bonusReward: bonusReward,
                            rewardRate: ethers.utils.parseEther("1"),
                            bonusRewardRate: ethers.utils.parseEther("0.03"),
                            minimalPositionWidth: 1,
                        },
                        await algebraPool.plugin()
                    )

                    await algebraVault.connect(alice).deposit(ethers.utils.parseEther("4000"), 0, alice.address)
                })

                it("ALM participates in new farming after detach", async () => {
                    await algebraVault.connect(alice).deposit(ethers.utils.parseEther("4000"), 0, alice.address);
                    await algebraVault.connect(alice).approve(farmingRewardsDistributor.address, giantTokenAmount);

                    let lpBalance = await algebraVault.balanceOf(alice.address);
                    await farmingRewardsDistributor.connect(alice).stake(lpBalance.div(2), alice.address);

                    await network.provider.send("evm_increaseTime", [7200]);
                    await algebraEternalFarming.deactivateIncentive(
                    {
                            pool: algebraPool.address,
                            rewardToken: token2.address,
                            bonusRewardToken: token1.address,
                            nonce: 0,
                    })
                    
                    await token1.approve(algebraEternalFarming.address, bonusReward);
                    await token2.approve(algebraEternalFarming.address, totalReward);

                    await algebraEternalFarming.createEternalFarming(
                        {
                            pool: algebraPool.address,
                            rewardToken: token2.address,
                            bonusRewardToken: token1.address,
                            nonce: 1,
                        },
                        {
                            reward: totalReward,
                            bonusReward: bonusReward,
                            rewardRate: ethers.utils.parseEther("1"),
                            bonusRewardRate: ethers.utils.parseEther("0.03"),
                            minimalPositionWidth: 1,
                        },
                        await algebraPool.plugin()
                    )

                    await algebraVault.connect(wallet).rebalance(-1800, -60, 60, 15000, 0);
                    const incentiveId = await farmingCenter.deposits(3); // last pos id

                    let res = await farmingCenter.incentiveKeys(incentiveId);
                    expect(res.nonce).to.be.eq(1) // alm pos in new farming
                })
            
            })
    })
});

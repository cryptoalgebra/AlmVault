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
    MockPlugin,
    IAlgebraPool,
    AlgebraVault,
    AlgebraVaultFactory,
    TestERC20,
} from "../types";
import {algebraVaultTestFixture} from "./shared/fixtures";
import {FeeAmount, TICK_SPACINGS, encodePriceSqrt, getMaxTick, getMinTick} from "./shared/utilities";
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
    const totalReward = ethers.utils.parseEther("2000000");
    const bonusReward = ethers.utils.parseEther("4000");
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
    let plugin: MockPlugin;

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
        ({
            token0,
            token1,
            token2,
            factory,
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

        plugin = (await ethers.getContractAt("MockPlugin", await algebraPool.plugin())) as MockPlugin;

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

            await algebraVault.connect(wallet).rebalance(-1800, -1200, 180, 600, 0);
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

            await algebraVault.connect(wallet).rebalance(-1800, -1200, 180, 600, 0);
            await algebraVault.setFarmingRewardsDistributor(other.address)

            await plugin.updateVirtualPoolTick(500, false)

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

                await algebraVault
                    .connect(alice)
                    .deposit(ethers.utils.parseEther("4000"), 0, alice.address);
                await algebraVault.connect(alice).approve(farmingRewardsDistributor.address, giantTokenAmount);

                await algebraVault.connect(wallet).rebalance(-1800, -1200, 180, 600, 0);
                await plugin.updateVirtualPoolTick(500, false)

                await network.provider.send("evm_increaseTime", [360000]);
            })

            it("Collects rewards on first stake but does not update", async () => {
                const lpBalance = await algebraVault.balanceOf(alice.address);
                await farmingRewardsDistributor.connect(alice).stake(lpBalance, alice.address);

                const rewardData = await farmingRewardsDistributor.rewardData(token2.address)
                expect(rewardData[2]).to.be.equal(0)

                const rewardBalance = await token2.balanceOf(farmingRewardsDistributor.address);
                const bonusRewardBalance = await token1.balanceOf(farmingRewardsDistributor.address);

                expect(rewardBalance).to.be.greaterThan(0)
                expect(bonusRewardBalance).to.be.greaterThan(0)
            })

            it("Updates rewards on the subsequent stakes", async () => {
                let lpBalance = await algebraVault.balanceOf(alice.address);
                await farmingRewardsDistributor.connect(alice).stake(lpBalance.div(2), alice.address);

                lpBalance = await algebraVault.balanceOf(alice.address);
                await farmingRewardsDistributor.connect(alice).stake(lpBalance, alice.address);

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
                expect(claimableAmounts[0]).to.be.equal(rewardBalance)
                expect(claimableAmounts[1]).to.be.equal(bonusRewardBalance)
            })
        })
    })
});

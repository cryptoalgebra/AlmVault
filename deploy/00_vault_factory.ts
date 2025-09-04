import { UV3Math, AlgebraVaultFactory } from "../types";

const hre = require("hardhat");

async function main() {
    const algebraFactory = "0x2fB84Ae4b1B6aeEc5627268070cF44C678Cd9728"
    const pluginDeployer = "0x0000000000000000000000000000000000000000" // zero address for base pools
    const nftManager = "0x9026d1c84f5834968FE80368b216D7C34109Cf97"
    const eternalFarming = "0xc709aCDA0dBF1a70189bd850e8E8b2659017Fa62"
    const wrapNative = "0x4200000000000000000000000000000000000006"

    const feeRecipient = "0xDeaD1F5aF792afc125812E875A891b038f888258" // algebra fee address
    const ammFee = "100000000000000000" // 10%(100% is 10**18), partner's fees
    const baseFee = "100000000000000000" // 10% 

    const uV3MathFactory = await hre.ethers.getContractFactory("UV3Math");
    const uV3Math = (await uV3MathFactory.deploy()) as UV3Math;

    await uV3Math.deployed()

    const algebraVaultDeployer = await hre.ethers.getContractFactory("AlgebraVaultDeployer", {
        libraries: {
          UV3Math: uV3Math.address,
        },
    });
    const libAlgebraVaultDeployer = await algebraVaultDeployer.deploy();
    await libAlgebraVaultDeployer.deployed()

    const farmingRewardsDistributorDeployer = await hre.ethers.getContractFactory("FarmingRewardsDistributorDeployer");
    const libFarmingRewardsDistributorDeployer = await farmingRewardsDistributorDeployer.deploy();

    await libFarmingRewardsDistributorDeployer.deployed()

    const AlgebraVaultFactoryFactory = await hre.ethers.getContractFactory("AlgebraVaultFactory", {
            libraries: {
                AlgebraVaultDeployer: libAlgebraVaultDeployer.address,
                FarmingRewardsDistributorDeployer: libFarmingRewardsDistributorDeployer.address
            }
        }
    );

    const AlgebraVaultFactory = await AlgebraVaultFactoryFactory.deploy(algebraFactory, pluginDeployer, eternalFarming, nftManager, "ALGEBRA") as AlgebraVaultFactory;

    await AlgebraVaultFactory.deployed()

    console.log("AlgebraVaultFactory to:", AlgebraVaultFactory.address);

    // Set fee configuration
    console.log("Setting fee recipient to:", feeRecipient);
    let tx = await AlgebraVaultFactory.setFeeRecipient(feeRecipient);
    await tx.wait();

    console.log("Setting AMM fees...");
    tx = await AlgebraVaultFactory.setAmmFee(ammFee);
    await tx.wait();
    tx = await AlgebraVaultFactory.setBaseFee(baseFee);
    await tx.wait();

    const AlgebraVaultDepositGuardFactory = await hre.ethers.getContractFactory("AlgebraVaultDepositGuard");
    const AlgebraVaultDepositGuard = await AlgebraVaultDepositGuardFactory.deploy(AlgebraVaultFactory.address, wrapNative) as AlgebraVaultFactory;

    await AlgebraVaultDepositGuard.deployed()

    console.log("AlgebraVaultDepositGuard to:", AlgebraVaultDepositGuard.address);

    await hre.run("verify:verify", {
        address: AlgebraVaultDepositGuard.address,
        constructorArguments: [
            AlgebraVaultFactory.address, 
            wrapNative
        ],
    });

    await hre.run("verify:verify", {
        address: AlgebraVaultFactory.address,
        constructorArguments: [
            algebraFactory, 
            pluginDeployer,
            eternalFarming, 
            nftManager, 
            "ALGEBRA"
        ],
    });
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
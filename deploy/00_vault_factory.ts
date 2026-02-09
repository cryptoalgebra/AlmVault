import { UV3Math, AlgebraVaultFactory, AlgebraVaultDepositGuard } from "../types";
import hre from "hardhat";

async function main() {
    const algebraFactory = "0x99E317c0099F0fB8C5913db976d00fddeDB69583";
    const pluginDeployer = "0x0000000000000000000000000000000000000000";
    const nftManager = "0x50FCbF85d23aF7C91f94842FeCd83d16665d27bA";
    const eternalFarming = "0x49BE8AA6c684b15e0C5450e8Fa0b16Bec1435596";
    const wrapNative = "0x10253594A832f967994b44f33411940533302ACb";

    const feeRecipient = "0xDeaD1F5aF792afc125812E875A891b038f888258";
    const ammFee = "100000000000000000";
    const baseFee = "100000000000000000";

    const uV3MathFactory = await hre.ethers.getContractFactory("UV3Math");
    const uV3Math = await uV3MathFactory.deploy() as UV3Math;
    await uV3Math.waitForDeployment();

    const algebraVaultDeployer = await hre.ethers.getContractFactory("AlgebraVaultDeployer", {
        libraries: {
            UV3Math: await uV3Math.getAddress(),
        },
    });
    const libAlgebraVaultDeployer = await algebraVaultDeployer.deploy();
    await libAlgebraVaultDeployer.waitForDeployment();

    const farmingRewardsDistributorDeployer = await hre.ethers.getContractFactory("FarmingRewardsDistributorDeployer");
    const libFarmingRewardsDistributorDeployer = await farmingRewardsDistributorDeployer.deploy();
    await libFarmingRewardsDistributorDeployer.waitForDeployment();

    const algebraVaultFactoryFactory = await hre.ethers.getContractFactory("AlgebraVaultFactory", {
        libraries: {
            AlgebraVaultDeployer: await libAlgebraVaultDeployer.getAddress(),
            FarmingRewardsDistributorDeployer: await libFarmingRewardsDistributorDeployer.getAddress(),
        },
    });

    const algebraVaultFactory = await algebraVaultFactoryFactory.deploy(
        algebraFactory,
        pluginDeployer,
        eternalFarming,
        nftManager,
        "ALGEBRA"
    ) as AlgebraVaultFactory;
    await algebraVaultFactory.waitForDeployment();

    const factoryAddress = await algebraVaultFactory.getAddress();
    console.log("AlgebraVaultFactory deployed to:", factoryAddress);

    console.log("Setting fee recipient to:", feeRecipient);
    await algebraVaultFactory.setFeeRecipient(feeRecipient);

    console.log("Setting AMM fees...");
    await algebraVaultFactory.setAmmFee(ammFee);
    
    await algebraVaultFactory.setBaseFee(baseFee);

    const algebraVaultDepositGuardFactory = await hre.ethers.getContractFactory("AlgebraVaultDepositGuard");
    const algebraVaultDepositGuard = await algebraVaultDepositGuardFactory.deploy(
        factoryAddress,
        wrapNative
    ) as AlgebraVaultDepositGuard;
    await algebraVaultDepositGuard.waitForDeployment();

    const guardAddress = await algebraVaultDepositGuard.getAddress();
    console.log("AlgebraVaultDepositGuard deployed to:", guardAddress);

    await hre.run("verify:verify", {
        address: guardAddress,
        constructorArguments: [factoryAddress, wrapNative],
    });

    await hre.run("verify:verify", {
        address: factoryAddress,
        constructorArguments: [algebraFactory, pluginDeployer, eternalFarming, nftManager, "ALGEBRA"],
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
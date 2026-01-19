import { UV3Math, AlgebraVaultStableFactory, AlgebraVaultStableDepositGuard } from "../types";
import hre from "hardhat";

async function main() {
    const algebraFactory = "0x3459670786E3ea7AEB1e09518D89eB277A23C68c";
    const pluginDeployer = "0x0000000000000000000000000000000000000000";
    const nftManager = "0x6dCbcdFE2cBB450BAb3D32BcB5661993D1712732";

    const feeRecipient = "0xDeaD1F5aF792afc125812E875A891b038f888258";
    const ammFee = "100000000000000000";
    const baseFee = "100000000000000000";

    const uV3MathFactory = await hre.ethers.getContractFactory("UV3Math");
    const uV3Math = await uV3MathFactory.deploy() as UV3Math;
    await uV3Math.waitForDeployment();

    const algebraVaultStableDeployer = await hre.ethers.getContractFactory("AlgebraVaultStableDeployer", {
        libraries: {
            UV3Math: await uV3Math.getAddress(),
        },
    });
    const libAlgebraVaultStableDeployer = await algebraVaultStableDeployer.deploy();
    await libAlgebraVaultStableDeployer.waitForDeployment();


    const AlgebraVaultStableFactoryFactory = await hre.ethers.getContractFactory("AlgebraVaultStableFactory", {
        libraries: {
            AlgebraVaultStableDeployer: await libAlgebraVaultStableDeployer.getAddress()
        },
    });

    const algebraVaultFactory = await AlgebraVaultStableFactoryFactory.deploy(
        algebraFactory,
        pluginDeployer,
        nftManager,
        "ALGEBRA"
    ) as AlgebraVaultStableFactory;
    await algebraVaultFactory.waitForDeployment();

    const factoryAddress = await algebraVaultFactory.getAddress();
    console.log("AlgebraVaultStableFactory deployed to:", factoryAddress);

    console.log("Setting fee recipient to:", feeRecipient);
    await algebraVaultFactory.setFeeRecipient(feeRecipient);

    console.log("Setting AMM fees...");
    await algebraVaultFactory.setAmmFee(ammFee);

    await algebraVaultFactory.setBaseFee(baseFee);

    const algebraVaultDepositGuardFactory = await hre.ethers.getContractFactory("AlgebraVaultStableDepositGuard");
    const algebraVaultDepositGuard = await algebraVaultDepositGuardFactory.deploy(
        factoryAddress
    ) as AlgebraVaultStableDepositGuard;
    await algebraVaultDepositGuard.waitForDeployment();

    const guardAddress = await algebraVaultDepositGuard.getAddress();
    console.log("AlgebraVaultStableDepositGuard deployed to:", guardAddress);

    await hre.run("verify:verify", {
        address: guardAddress,
        constructorArguments: [factoryAddress],
    });

    await hre.run("verify:verify", {
        address: factoryAddress,
        constructorArguments: [algebraFactory, pluginDeployer, nftManager, "ALGEBRA"],
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
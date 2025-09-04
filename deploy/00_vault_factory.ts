import { UV3Math, AlgebraVaultFactory } from "../types";

const hre = require("hardhat");

async function main() {
    const algebraFactory = "0x41ba59415eC75AC4242dd157F2a7A282F1e75652"
    const pluginDeployer = "0x0000000000000000000000000000000000000000" // zero address for base pools
    const nftManager = "0x578D8A2D07B60b12993559f1DDF90EB2af3eA496"
    const wrapNative = "0x5555555555555555555555555555555555555555"

    const feeRecipient = "0x0000000000000000000000000000000000000000" // algebra fee address
    const ammFee = "100000000000000000" // 10%(100% is 10**18), partner's fees
    const baseFee = "100000000000000000" // 10% 

    const uV3MathFactory = await hre.ethers.getContractFactory("UV3Math");
    const uV3Math = (await uV3MathFactory.deploy()) as UV3Math;

    const algebraVaultDeployer = await hre.ethers.getContractFactory("AlgebraVaultDeployer", {
        libraries: {
          UV3Math: uV3Math.address,
        },
    });
    const libAlgebraVaultDeployer = await algebraVaultDeployer.deploy();

    const AlgebraVaultFactoryFactory = await hre.ethers.getContractFactory("AlgebraVaultFactory", {
            libraries: {
                AlgebraVaultDeployer: libAlgebraVaultDeployer.address,
            }
        }
    );
    const AlgebraVaultFactory = await AlgebraVaultFactoryFactory.deploy(algebraFactory, pluginDeployer, nftManager, "ALGEBRA") as AlgebraVaultFactory;

    await AlgebraVaultFactory.deployed()

    console.log("AlgebraVaultFactory to:", AlgebraVaultFactory.address);

    // Set fee configuration
    console.log("Setting fee recipient to:", feeRecipient);
    await AlgebraVaultFactory.setFeeRecipient(feeRecipient);

    console.log("Setting AMM fees...");
    await AlgebraVaultFactory.setAmmFee(ammFee);
    await AlgebraVaultFactory.setBaseFee(baseFee);

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
import { UV3Math, AlgebraVaultFactory } from "../types";

const hre = require("hardhat");

async function main() {

    const algebraFactory = "0x904Af47469B13b341B41c552c952370b76B69DFA"
    const pluginDeployer = "0x0000000000000000000000000000000000000000" // zero address for base pools
    const nftManager = "0xDE4E488b8F835E8c7Bc9d2d307fff804625aCA76"
    const wrapNative = "0x4200000000000000000000000000000000000006"

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
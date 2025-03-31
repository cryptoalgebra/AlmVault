import { ethers } from "hardhat";
import { UV3Math, AlgebraVaultFactory } from "../types";

const hre = require("hardhat");

async function main() {
    const uV3MathFactory = await ethers.getContractFactory("UV3Math");
    const uV3Math = (await uV3MathFactory.deploy()) as UV3Math;

    const algebraVaultDeployer = await ethers.getContractFactory("AlgebraVaultDeployer", {
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
    const AlgebraVaultFactory = await AlgebraVaultFactoryFactory.deploy(
    "0x5E4F01767A1068C5570c29fDF9bf743b0Aa637d7",
        "0x9ea4459c8DefBF561495d95414b9CF1E2242a3E2",
        "CLAMM"
    ) as AlgebraVaultFactory;

    await AlgebraVaultFactory.deployed()

    console.log("AlgebraVaultFactory to:", AlgebraVaultFactory.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
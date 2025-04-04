import { UV3Math, AlgebraVaultFactory } from "../types";

const hre = require("hardhat");

async function main() {
    const constructorArgs = [
        "0x51a744E9FEdb15842c3080d0937C99A365C6c358",
        "0x05f3bd357D47D159ac7d33f9DBaaCFc65d31976d",
        "0x8aD26dc9f724c9A7319E0E25b907d15626D9a056",
        "CLAMM"
    ]

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
    const AlgebraVaultFactory = await AlgebraVaultFactoryFactory.deploy(
        ...constructorArgs
    ) as AlgebraVaultFactory;

    await AlgebraVaultFactory.deployed()

    console.log("AlgebraVaultFactory to:", AlgebraVaultFactory.address);

    await hre.run("verify:verify", {
        address: AlgebraVaultFactory.address,
        constructorArguments: constructorArgs,
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
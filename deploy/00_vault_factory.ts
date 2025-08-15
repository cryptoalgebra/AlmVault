import { UV3Math, AlgebraVaultFactory } from "../types";

const hre = require("hardhat");

async function main() {
    const algebraFactory = "0xcD58521ecaC7724d1752F941C56490c27bAe9ab0"
    const pluginDeployer = "0xFD209C7e6b19131B2C36550950c66F0E4EbccfF0" // zero address for base pools
    const nftManager = "0x5baD56bfBABEC1A5A7848399762f54566FA22557"
    const eternalFarming = "0xf7cA7d0F8Bbef9BBfEB66Cf2c9C84Eeb2dA60b22"
    const wrapNative = "0x4200000000000000000000000000000000000006"

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
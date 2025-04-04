import { AlgebraVaultFactory } from "../types";

const hre = require("hardhat");

async function main() {
    const constructorArgs = [
        "0x50246Cba8e8186E4c75a06e844BFDdA87395114d", // Vault Factory
        "0x4200000000000000000000000000000000000006",
    ]

    const AlgebraVaultDepositGuardFactory = await hre.ethers.getContractFactory("AlgebraVaultDepositGuard");
    const AlgebraVaultDepositGuard = await AlgebraVaultDepositGuardFactory.deploy(
        ...constructorArgs
    ) as AlgebraVaultFactory;

    await AlgebraVaultDepositGuard.deployed()

    console.log("AlgebraVaultDepositGuard to:", AlgebraVaultDepositGuard.address);

    await hre.run("verify:verify", {
        address: AlgebraVaultDepositGuard.address,
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
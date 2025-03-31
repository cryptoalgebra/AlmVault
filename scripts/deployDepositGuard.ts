import {ethers} from "hardhat";
import { UV3Math, AlgebraVaultFactory } from "../types";

const hre = require("hardhat");

async function main() {
    const AlgebraVaultDepositGuardFactory = await hre.ethers.getContractFactory("AlgebraVaultDepositGuard");
    const AlgebraVaultDepositGuard = await AlgebraVaultDepositGuardFactory.deploy(
    "0x44a48691113c6Ffda540C3Cb9C1250a52fD3d55a", // Vault Factory
        "0x4200000000000000000000000000000000000006",
    ) as AlgebraVaultFactory;

    await AlgebraVaultDepositGuard.deployed()

    console.log("AlgebraVaultDepositGuard to:", AlgebraVaultDepositGuard.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
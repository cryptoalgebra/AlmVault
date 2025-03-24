import { ethers, network, run } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { AlgebraVaultFactory__factory, IAlgebraVault__factory } from "../types";

// For more details on programmatic verification in hardhat see:
// https://hardhat.org/hardhat-runner/plugins/nomicfoundation-hardhat-verify#using-programmatically
describe("Verify All Contracts via Etherscan", async function () {

  const isHardhat = network.name === "hardhat";

  const requisiteData: {
    AMM_NAME: string,
    UV3MATH_LIBRARY?: string;
    Algebra_VAULT_DEPLOYER_LIBRARY?: string;
    Algebra_VAULT_FACTORY?: string;
    REBALANCER_FACTORIES_LOGIC?: string;
    REBALANCER_FACTORIES_ADMIN?: string;
    REBALANCER_FACTORY?: string;
    DEPOSIT_GUARD?: string,
    WRAPPED_CURRENCY?: string,
    UNISWAP_V3_FACTORY?: string;
    BASE_PLUGIN_FACTORY?: string;
    Algebra_Vault_Controller?: string;
  } = {
    AMM_NAME: '',
    UV3MATH_LIBRARY: '',
    Algebra_VAULT_DEPLOYER_LIBRARY: '',
    Algebra_VAULT_FACTORY: '',
    REBALANCER_FACTORIES_LOGIC: '',
    REBALANCER_FACTORIES_ADMIN: '',
    REBALANCER_FACTORY: '',
    DEPOSIT_GUARD: '',
    WRAPPED_CURRENCY: '',
    UNISWAP_V3_FACTORY: '',
    BASE_PLUGIN_FACTORY: '',
    Algebra_Vault_Controller: '',
  };

  let deployer: SignerWithAddress, governor: SignerWithAddress, lp: SignerWithAddress;

  before(async () => {

    if (isHardhat) {
      throw new Error(`To verify on a specific etherscan(not hardhat) specify "--network" cmd flag`);
    }

    const signers = await ethers.getSigners();
    [deployer, governor, lp,] = signers;

    // validate all requisite data and populate requisite data in allData before attempting to proceed with steps

    const {
      AMM_NAME,
      UNISWAP_V3_FACTORY,
      Algebra_VAULT_FACTORY,
      UV3MATH_LIBRARY,
      Algebra_VAULT_DEPLOYER_LIBRARY,
      REBALANCER_FACTORIES_LOGIC,
      REBALANCER_FACTORIES_ADMIN,
      REBALANCER_FACTORY,
      DEPOSIT_GUARD,
      WRAPPED_CURRENCY,
      BASE_PLUGIN_FACTORY,
      Algebra_Vault_Controller
    } = requisiteData;

    // - - - - - Validate AMM_NAME - - - - -
    if (!AMM_NAME) {
      throw new Error(`Undefined AMM_NAME`);
    }

    // - - - - - Validate UNISWAP_V3_FACTORY - - - - -
    if (!UNISWAP_V3_FACTORY) {
      throw new Error(`Undefined UNISWAP_V3_FACTORY`);
    }

    // - - - - - Validate Algebra_VAULT_FACTORY - - - - -
    if (!Algebra_VAULT_FACTORY) {
      throw new Error(`Undefined Algebra_VAULT_FACTORY`);
    }

    // - - - - - Validate UV3MATH_LIBRARY - - - - -
    if (!UV3MATH_LIBRARY) {
      throw new Error(`Undefined UV3MATH_LIBRARY`);
    }

    // - - - - - Validate Algebra_VAULT_DEPLOYER_LIBRARY - - - - -
    if (!Algebra_VAULT_DEPLOYER_LIBRARY) {
      throw new Error(`Undefined Algebra_VAULT_DEPLOYER_LIBRARY`);
    }

    // - - - - - Validate REBALANCER_FACTORIES_LOGIC - - - - -
    if (!REBALANCER_FACTORIES_LOGIC) {
      throw new Error(`Undefined REBALANCER_FACTORIES_LOGIC`);
    }

    // - - - - - Validate REBALANCER_FACTORIES_ADMIN - - - - -
    if (!REBALANCER_FACTORIES_ADMIN) {
      throw new Error(`Undefined REBALANCER_FACTORIES_ADMIN`);
    }

    // - - - - - Validate REBALANCER_FACTORY - - - - -
    if (!REBALANCER_FACTORY) {
      throw new Error(`Undefined REBALANCER_FACTORY`);
    }

    // - - - - - Validate DEPOSIT_GUARD - - - - -
    if (!DEPOSIT_GUARD) {
      throw new Error(`Undefined DEPOSIT_GUARD`);
    }

    // - - - - - Validate WRAPPED_CURRENCY - - - - -
    if (!WRAPPED_CURRENCY) {
      throw new Error(`Undefined WRAPPED_CURRENCY`);
    }

    // - - - - - Validate BASE_PLUGIN_FACTORY - - - - -
    if (!BASE_PLUGIN_FACTORY) {
      throw new Error(`Undefined BASE_PLUGIN_FACTORY`);
    }

    // - - - - - Validate Algebra_Vault_Controller - - - - -
    if (!Algebra_Vault_Controller) {
      throw new Error(`Undefined Algebra_Vault_Controller`);
    }

  });

  after(async () => {
    console.log("requisiteData:", requisiteData);
  });

  let shouldSkip = false;
  beforeEach(function () {
    if (shouldSkip) {
      this.skip();
    }
  });

  // afterEach(function () {
  //   if (this.currentTest?.state === 'failed') {
  //     shouldSkip = true;
  //   }
  // });

  it("should verify UV3Math", async () => {

    const {
      UV3MATH_LIBRARY,
      DEPOSIT_GUARD,
    } = requisiteData;

    await run("verify:verify", {
      contract: "contracts/lib/UV3Math.sol:UV3Math",
      address: UV3MATH_LIBRARY,
    });
  });

  it("should verify AlgebraVaultDeployer", async () => {

    const {
      UV3MATH_LIBRARY,
      Algebra_VAULT_DEPLOYER_LIBRARY,
    } = requisiteData;

    // TODO: investigate why AlgebraVaultDeployer doesn't verify
    await run("verify:verify", {
      contract: "contracts/lib/AlgebraVaultDeployer.sol:AlgebraVaultDeployer",
      address: Algebra_VAULT_DEPLOYER_LIBRARY,
      libraries: {
        "contracts/lib/UV3Math.sol:UV3Math": UV3MATH_LIBRARY,
      }
    });
  });

  it("should verify AlgebraVaultFactory", async () => {

    const {
      AMM_NAME,
      UNISWAP_V3_FACTORY,
      BASE_PLUGIN_FACTORY,
      Algebra_VAULT_DEPLOYER_LIBRARY,
      Algebra_VAULT_FACTORY,
    } = requisiteData;

    await run("verify:verify", {
      contract: "contracts/AlgebraVaultFactory.sol:AlgebraVaultFactory",
      address: Algebra_VAULT_FACTORY,
      constructorArguments: [
        UNISWAP_V3_FACTORY,
        BASE_PLUGIN_FACTORY,
        AMM_NAME
      ],
      libraries: {
        "contracts/lib/AlgebraVaultDeployer.sol:AlgebraVaultDeployer": Algebra_VAULT_DEPLOYER_LIBRARY,
      }
    });

  });

  it("should verify AlgebraVault", async () => {

    const {
      Algebra_VAULT_FACTORY,
      Algebra_Vault_Controller,
      UV3MATH_LIBRARY,
    } = requisiteData;

    const vaultFactory = AlgebraVaultFactory__factory.connect(Algebra_VAULT_FACTORY!, deployer);

    const index = 0

    const vaultAddress = await vaultFactory.allVaults(index);

    const vault = IAlgebraVault__factory.connect(vaultAddress, deployer);

    const pool = await vault.pool();
    const allowToken0 = await vault.allowToken0();
    const allowToken1 = await vault.allowToken1();

    await run("verify:verify", {
      contract: "contracts/AlgebraVault.sol:AlgebraVault",
      address: vaultAddress,
      constructorArguments: [
        pool,
        allowToken0,
        allowToken1,
        Algebra_Vault_Controller,
        3600,
        index
      ],
      libraries: {
        "contracts/lib/UV3Math.sol:UV3Math": UV3MATH_LIBRARY,
      },
    });

  });

  it("should verify AlgebraVaultDepositGuard", async () => {

    const {
      Algebra_VAULT_FACTORY,
      WRAPPED_CURRENCY,
      DEPOSIT_GUARD,
    } = requisiteData;

    await run("verify:verify", {
      contract: "contracts/AlgebraVaultDepositGuard.sol:AlgebraVaultDepositGuard",
      address: DEPOSIT_GUARD,
      constructorArguments: [
        Algebra_VAULT_FACTORY,
        WRAPPED_CURRENCY,
      ],
    });

  });

});

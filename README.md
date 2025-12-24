# Algebra ALM Vault

Algebra Automated Liquidity Manager (ALM) Vault - automated liquidity management system for Algebra DEX. Provides a simple interface for managing concentrated liquidity positions with automatic rebalancing.

## Description

AlgebraVault provides a fungible liquidity interface for Algebra DEX, enabling both single-sided and dual-sided liquidity provision. The system includes:

- **AlgebraVault**: main contract for liquidity management
- **AlgebraVaultFactory**: factory for creating new vaults  
- **AlgebraVaultDepositGuard**: deposit protection with additional checks
- **FarmingRewardsDistributor**: farming rewards distribution

## Security Audit

The project has been audited by MixBytes:
[🔗 Audit Report](https://github.com/mixbytes/audits_public/tree/master/Algebra%20Finance/Algebra%20ALM)

## Installation and Usage

```bash
# Install dependencies
npm install

# Compile contracts
npx hardhat compile

# Run tests
npx hardhat test

# Run tests with gas report
REPORT_GAS=true npx hardhat test

# Start local node
npx hardhat node
```

## Project Structure

- `contracts/` - core smart contracts
- `test/` - contract tests
- `deploy/` - deployment scripts
- `types/` - generated TypeScript types

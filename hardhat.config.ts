import "@nomicfoundation/hardhat-toolbox";
import "hardhat-contract-sizer";
import type { HardhatUserConfig } from "hardhat/config";
import path from "path";

const env = require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const { MNEMONIC, ETHERSCAN_API_KEY } =
  env.parsed || {};

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 0
      }
    }
  },
  typechain: {
    outDir: "types",
  },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
    },
    baseTestnet: {
      url: `https://base-sepolia-public.nodies.app`,
      chainId: 84532,
      accounts: [`0x${MNEMONIC || '1000000000000000000000000000000000000000000000000000000000000000'}`],
    },
    base: {
      url: `https://1rpc.io/base`,
      chainId: 8453,
      accounts: [`0x${MNEMONIC || '1000000000000000000000000000000000000000000000000000000000000000'}`],
    }
  },
  etherscan: {
    apiKey:  ETHERSCAN_API_KEY,
    customChains: [

        {
        network: 'base',
        chainId: 8453,
        urls: {
          apiURL: 'https://api.basescan.org/api',
          browserURL: 'https://basescan.org/',
        },
      }
    ]
  }
};

export default config;

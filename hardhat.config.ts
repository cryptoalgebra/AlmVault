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
      url: `https://base-sepolia.gateway.tenderly.co`,
      chainId: 84532,
      accounts: [`0x${MNEMONIC || '1000000000000000000000000000000000000000000000000000000000000000'}`],
    },
    base: {
      url: `https://1rpc.io/base`,
      chainId: 8453,
      accounts: [`0x${MNEMONIC || '1000000000000000000000000000000000000000000000000000000000000000'}`],
    },
    hyper: {
      url: `https://rpc.hypurrscan.io`,
      chainId: 999,
      accounts: [`0x${MNEMONIC || '1000000000000000000000000000000000000000000000000000000000000000'}`],
    },
    skaleBaseTestnet: {
      url: 	"https://base-sepolia-testnet.skalenodes.com/v1/jubilant-horrible-ancha",
      accounts: [`0x${MNEMONIC || '1000000000000000000000000000000000000000000000000000000000000000'}`],
      chainId: 324705682,
      timeout: 120000
    },
  },
  etherscan: {
    apiKey: { skaleBaseTestnet: process.env.ETHERSCAN_API_KEY },
    customChains: [
      {
        network: 'hyper',
        chainId: 999,
        urls: {
          apiURL: 'https://www.hyperscan.com/api',
          browserURL: 'https://www.hyperscan.com/',
        },
      },
      {
          network: 'skaleBaseTestnet',
          chainId: 324705682,
          urls: {
          apiURL: 'https://base-sepolia-testnet-explorer.skalenodes.com/api',
          browserURL: 'https://base-sepolia-testnet-explorer.skalenodes.com/',
          },
      },
    ]
  }
};

export default config;

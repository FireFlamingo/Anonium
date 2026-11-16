require("@nomicfoundation/hardhat-toolbox");
require("@semaphore-protocol/hardhat");
require("dotenv").config();

// Sepolia is enabled only when contracts/.env has a DEPLOYER_PRIVATE_KEY. The RPC defaults to a free public node.
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL?.trim() || "https://ethereum-sepolia-rpc.publicnode.com";
const rawKey = process.env.DEPLOYER_PRIVATE_KEY?.trim();
// MetaMask exports keys without the 0x prefix, so add it if missing.
const DEPLOYER_PRIVATE_KEY = rawKey ? (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) : "";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    hardhat: { chainId: 31337 },
    localhost: { url: "http://127.0.0.1:8545", chainId: 31337 },
    ...(/^0x[0-9a-fA-F]{64}$/.test(DEPLOYER_PRIVATE_KEY)
      ?{ sepolia: { url: SEPOLIA_RPC_URL, accounts: [DEPLOYER_PRIVATE_KEY], chainId: 11155111 } }
      : {}),
  },
  mocha: { timeout: 300000 },
};

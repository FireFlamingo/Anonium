import deployments from "@deployments/deployments.json";
import GroupManagerAbi from "@deployments/abi/GroupManager.json";
import WhistleblowVerifierAbi from "@deployments/abi/WhistleblowVerifier.json";
import SemaphoreAbi from "@deployments/abi/ISemaphore.json";

export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID || 31337);
export const IS_LOCAL = CHAIN_ID === 31337;

const CHAINS = {
  31337: { name: "Hardhat Local", rpc: "http://127.0.0.1:8545", explorer: null, currency: "ETH" },
  11155111: { name: "Sepolia", rpc: "https://ethereum-sepolia-rpc.publicnode.com", explorer: "https://sepolia.etherscan.io", currency: "SepoliaETH" },
};

export const CHAIN = {
  id: CHAIN_ID,
  ...(CHAINS[CHAIN_ID] || { name: `Chain ${CHAIN_ID}`, rpc: "", explorer: null, currency: "ETH" }),
  ...(import.meta.env.VITE_RPC_URL ? { rpc: import.meta.env.VITE_RPC_URL } : {}),
};

export const RELAYER_URL = import.meta.env.VITE_RELAYER_URL || "http://localhost:8787";

export const DEPLOYMENT = deployments[String(CHAIN_ID)] || null;

export const ABI = {
  GroupManager: GroupManagerAbi,
  WhistleblowVerifier: WhistleblowVerifierAbi,
  Semaphore: SemaphoreAbi,
};

export const txUrl = (hash) => (CHAIN.explorer ? `${CHAIN.explorer}/tx/${hash}` : null);
export const addressUrl = (addr) => (CHAIN.explorer ? `${CHAIN.explorer}/address/${addr}` : null);

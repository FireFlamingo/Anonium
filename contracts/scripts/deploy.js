// Deploys Semaphore v4 + GroupManager + WhistleblowVerifier and writes addresses/ABIs to ../deployments.
// Usage:  npx hardhat run scripts/deploy.js --network localhost   (or --network sepolia)
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const OUT_DIR = path.resolve(__dirname, "../../deployments");

// Official Semaphore v4 deployments (https://docs.semaphore.pse.dev/deployed-contracts).
const OFFICIAL_SEMAPHORE = {
  "11155111": "0x8A1fd199516489B0Fb7153EB5f075cDAC83c693D", // Sepolia
};

async function main() {
  const { ethers, network, run } = hre;
  const [deployer] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();

  console.log(`Network:  ${network.name} (chainId ${chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance:  ${ethers.formatEther(balance)} ETH\n`);
  if (balance === 0n) {
    throw new Error(`Deployer ${deployer.address} has 0 ETH. Get free Sepolia ETH from https://sepolia-faucet.pk910.de first.`);
  }

  // Public RPCs are load-balanced and can report a stale nonce right after a transaction, which makes the
  // next one fail with "replacement transaction underpriced". Track the nonce locally on live networks.
  const signer = chainId === 31337n ? deployer : new ethers.NonceManager(deployer);

  // Reuse an existing Semaphore deployment if SEMAPHORE_ADDRESS is set (on Sepolia the official v4 one is
  // used by default), otherwise deploy our own.
  let semaphoreAddress = process.env.SEMAPHORE_ADDRESS || OFFICIAL_SEMAPHORE[chainId.toString()];
  if (!semaphoreAddress) {
    const { semaphore } = await run("deploy:semaphore", { logs: true });
    semaphoreAddress = await semaphore.getAddress();
  } else {
    console.log(`Using existing Semaphore v4 at ${semaphoreAddress}`);
  }

  const groupManager = await ethers.deployContract("GroupManager", [semaphoreAddress], signer);
  await groupManager.waitForDeployment();
  console.log(`GroupManager deployed to:        ${await groupManager.getAddress()}`);

  const verifier = await ethers.deployContract("WhistleblowVerifier", [semaphoreAddress, await groupManager.getAddress()], signer);
  await verifier.waitForDeployment();
  console.log(`WhistleblowVerifier deployed to: ${await verifier.getAddress()}`);

  const startBlock = (await verifier.deploymentTransaction().wait()).blockNumber;

  // ── Write deployments/deployments.json (merged by chainId) and ABIs ──
  fs.mkdirSync(path.join(OUT_DIR, "abi"), { recursive: true });
  const file = path.join(OUT_DIR, "deployments.json");
  const all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  all[chainId.toString()] = {
    network: network.name,
    chainId: Number(chainId),
    deployedAt: new Date().toISOString(),
    startBlock,
    deployer: deployer.address,
    Semaphore: semaphoreAddress,
    GroupManager: await groupManager.getAddress(),
    WhistleblowVerifier: await verifier.getAddress(),
  };
  fs.writeFileSync(file, JSON.stringify(all, null, 2));

  for (const name of ["GroupManager", "WhistleblowVerifier"]) {
    const { abi } = await hre.artifacts.readArtifact(name);
    fs.writeFileSync(path.join(OUT_DIR, "abi", `${name}.json`), JSON.stringify(abi, null, 2));
  }
  const { abi: semAbi } = await hre.artifacts.readArtifact("ISemaphore");
  fs.writeFileSync(path.join(OUT_DIR, "abi", "ISemaphore.json"), JSON.stringify(semAbi, null, 2));

  console.log(`\nWrote ${path.relative(process.cwd(), file)} and ABIs.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

// Creates a demo organisation with N employee identities and saves their private identities to
// ../deployments/demo-identities.json so you can import them in the Whistleblower page during a demo.
// Usage:  npx hardhat run scripts/seed-demo.js --network localhost
// Env:    DEMO_ORG="Acme Pharma Ltd."  DEMO_MEMBERS=8
//
// ⚠ Demo only. In real use each employee generates their identity in their own browser and the
//   private key never exists anywhere else.
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { Identity } = require("@semaphore-protocol/core");

const DIR = path.resolve(__dirname, "../../deployments");

async function main() {
  const { ethers } = hre;
  const { chainId } = await ethers.provider.getNetwork();
  const deployments = JSON.parse(fs.readFileSync(path.join(DIR, "deployments.json"), "utf8"))[chainId.toString()];
  if (!deployments) throw new Error(`No deployment for chainId ${chainId}. Run scripts/deploy.js first.`);

  const [admin] = await ethers.getSigners();
  // Local nonce tracking avoids "replacement transaction underpriced" on load-balanced public RPCs.
  const signer = chainId === 31337n ? admin : new ethers.NonceManager(admin);
  const gm = await ethers.getContractAt("GroupManager", deployments.GroupManager, signer);

  const name = process.env.DEMO_ORG || "Acme Pharma Ltd.";
  const count = Number(process.env.DEMO_MEMBERS || 8);

  const tx = await gm.createGroup(name);
  const receipt = await tx.wait();
  const event = receipt.logs.map((l) => { try { return gm.interface.parseLog(l); } catch { return null; } })
    .find((e) => e && e.name === "OrganizationCreated");
  const groupId = event.args.groupId;
  console.log(`Created "${name}" → group #${groupId} (admin ${admin.address})`);

  const identities = Array.from({ length: count }, () => new Identity());
  await (await gm.addMembers(groupId, identities.map((i) => i.commitment))).wait();
  console.log(`Added ${count} member commitments`);

  const outFile = path.join(DIR, "demo-identities.json");
  // Drop stale entries for this chain + group (e.g. after restarting a local node, ids restart at 0).
  const existing = (fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, "utf8")) : []).filter(
    (e) => !(e.chainId === Number(chainId) && e.groupId === groupId.toString())
  );
  identities.forEach((id, i) =>
    existing.push({
      label: `${name} — employee ${i + 1}`,
      chainId: Number(chainId),
      groupId: groupId.toString(),
      privateKey: id.export(),
      commitment: id.commitment.toString(),
    })
  );
  fs.writeFileSync(outFile, JSON.stringify(existing, null, 2));
  console.log(`Saved demo identities to ${path.relative(process.cwd(), outFile)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

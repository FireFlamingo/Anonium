// Anonymous submission relayer.
//
// Why it exists: if a whistleblower sent the transaction from their own wallet, their address would be
// permanently linked to the report on-chain, undoing the anonymity the ZK proof provides. The relayer
// pays gas from its own account, so the chain only ever sees the relayer address + the proof.
//
// The relayer cannot forge or alter reports: the proof binds the report hash, and the contract rejects
// anything that does not verify. Worst case, a malicious relayer can refuse to forward a report.
//
// Privacy: this server never logs IP addresses or request bodies.
import "dotenv/config";
import express from "express";
import cors from "cors";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ethers } from "ethers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEPLOY_DIR = path.resolve(__dirname, "../deployments");

// Hardhat's well-known dev account #9. Used ONLY when no key is configured and the chain is local.
const HARDHAT_DEV_KEY = "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6";

const PORT = Number(process.env.PORT || 8787);
// `npm run start:sepolia` also loads ../contracts/.env, so the Sepolia RPC and key only need to be set once.
const RPC_URL = process.env.RPC_URL || process.env.SEPOLIA_RPC_URL || "http://127.0.0.1:8545";
const ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173").split(",");
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN || 10);

const provider = new ethers.JsonRpcProvider(RPC_URL);
const { chainId } = await provider.getNetwork();
const deployment = JSON.parse(readFileSync(path.join(DEPLOY_DIR, "deployments.json"), "utf8"))[chainId.toString()];
if (!deployment) {
  console.error(`No deployment for chainId ${chainId} in deployments/deployments.json. Deploy the contracts first.`);
  process.exit(1);
}

let key = (process.env.RELAYER_PRIVATE_KEY || (chainId !== 31337n ? process.env.DEPLOYER_PRIVATE_KEY : "") || "").trim();
if (key && !key.startsWith("0x")) key = `0x${key}`;
if (!key) {
  if (chainId !== 31337n) {
    console.error("RELAYER_PRIVATE_KEY is required on non-local networks.");
    process.exit(1);
  }
  key = HARDHAT_DEV_KEY;
}
const wallet = new ethers.Wallet(key, provider);

const verifierAbi = JSON.parse(readFileSync(path.join(DEPLOY_DIR, "abi/WhistleblowVerifier.json"), "utf8"));
const semaphoreAbi = JSON.parse(readFileSync(path.join(DEPLOY_DIR, "abi/ISemaphore.json"), "utf8"));
const verifier = new ethers.Contract(deployment.WhistleblowVerifier, verifierAbi, wallet);
const errorIface = new ethers.Interface([...verifierAbi, ...semaphoreAbi].filter((f) => f.type === "error"));

const FRIENDLY = {
  DuplicateSubmission: "You have already submitted this exact report. Each insider can submit a given report only once.",
  InvalidProof: "The zero-knowledge proof did not verify.",
  ScopeMustEqualSignal: "Proof scope must equal the report hash.",
  UnknownGroup: "This organisation is not registered.",
  Semaphore__MerkleTreeRootIsNotPartOfTheGroup: "Your identity is not part of this organisation's current member set.",
  Semaphore__MerkleTreeRootIsExpired: "The member list changed since your proof was made. Refresh and try again.",
  Semaphore__GroupHasNoMembers: "This organisation has no members yet.",
  Semaphore__MerkleTreeDepthIsNotSupported: "Unsupported Merkle tree depth.",
};

function decodeRevert(err) {
  const data = err?.data || err?.info?.error?.data || err?.error?.data;
  if (typeof data === "string" && data.startsWith("0x")) {
    try {
      const parsed = errorIface.parseError(data);
      if (parsed) return { code: parsed.name, message: FRIENDLY[parsed.name] || parsed.name };
    } catch {}
  }
  return { code: "SubmissionFailed", message: err?.shortMessage || "Transaction failed." };
}

// ── tiny in-memory rate limiter (no IPs are persisted or logged) ──
const hits = new Map();
setInterval(() => hits.clear(), 60_000).unref();
function rateLimit(req, res, next) {
  const k = req.ip;
  const n = (hits.get(k) || 0) + 1;
  hits.set(k, n);
  if (n > RATE_LIMIT_PER_MIN) return res.status(429).json({ error: { code: "RateLimited", message: "Too many submissions. Wait a minute." } });
  next();
}

const isUint = (v) => typeof v === "string" && /^\d{1,78}$/.test(v);
function validateBody(body) {
  const { groupId, proof } = body || {};
  if (!isUint(String(groupId))) return "groupId must be a non-negative integer";
  if (!proof || typeof proof !== "object") return "proof is required";
  for (const f of ["merkleTreeRoot", "nullifier", "message", "scope"]) if (!isUint(proof[f])) return `proof.${f} must be a decimal string`;
  if (!Number.isInteger(proof.merkleTreeDepth) || proof.merkleTreeDepth < 1 || proof.merkleTreeDepth > 32) return "proof.merkleTreeDepth must be 1–32";
  if (!Array.isArray(proof.points) || proof.points.length !== 8 || !proof.points.every(isUint)) return "proof.points must be 8 decimal strings";
  return null;
}

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: ORIGINS }));
app.use(express.json({ limit: "16kb" }));

app.get("/health", async (_req, res) => {
  const balance = await provider.getBalance(wallet.address);
  res.json({
    ok: true,
    chainId: Number(chainId),
    relayer: wallet.address,
    balanceEth: ethers.formatEther(balance),
    verifier: deployment.WhistleblowVerifier,
  });
});

app.post("/submit", rateLimit, async (req, res) => {
  const invalid = validateBody(req.body);
  if (invalid) return res.status(400).json({ error: { code: "BadRequest", message: invalid } });

  const { groupId, proof } = req.body;
  const args = [
    BigInt(groupId),
    {
      merkleTreeDepth: proof.merkleTreeDepth,
      merkleTreeRoot: proof.merkleTreeRoot,
      nullifier: proof.nullifier,
      message: proof.message,
      scope: proof.scope,
      points: proof.points,
    },
  ];

  try {
    // Dry-run first: a failing proof costs the relayer nothing and returns a precise error.
    await verifier.submitReport.staticCall(...args);
  } catch (err) {
    return res.status(422).json({ error: decodeRevert(err) });
  }

  try {
    const tx = await verifier.submitReport(...args);
    const receipt = await tx.wait();
    const log = receipt.logs.map((l) => { try { return verifier.interface.parseLog(l); } catch { return null; } })
      .find((e) => e?.name === "ReportVerified");
    res.json({
      submissionId: log.args.id.toString(),
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      timestamp: Number(log.args.timestamp),
    });
  } catch (err) {
    res.status(502).json({ error: decodeRevert(err) });
  }
});

app.listen(PORT, async () => {
  const bal = ethers.formatEther(await provider.getBalance(wallet.address));
  console.log(`Relayer listening on http://localhost:${PORT}`);
  console.log(`  chainId ${chainId} · verifier ${deployment.WhistleblowVerifier}`);
  console.log(`  relayer ${wallet.address} · balance ${bal} ETH`);
});

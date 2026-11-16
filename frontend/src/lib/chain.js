import { Contract, Interface, JsonRpcProvider } from "ethers";
import { ABI, CHAIN, DEPLOYMENT } from "./config";

export const readProvider = new JsonRpcProvider(CHAIN.rpc, CHAIN.id, { staticNetwork: true });

export function groupManager(runner = readProvider) {
  return new Contract(DEPLOYMENT.GroupManager, ABI.GroupManager, runner);
}

export function verifierContract(runner = readProvider) {
  return new Contract(DEPLOYMENT.WhistleblowVerifier, ABI.WhistleblowVerifier, runner);
}

/** Normalises a struct returned by GroupManager.getOrganization(s). */
export function toOrg(o) {
  return {
    groupId: o.groupId.toString(),
    name: o.name,
    admin: o.admin,
    createdAt: Number(o.createdAt),
    activeMembers: Number(o.activeMembers),
  };
}

export function toSubmission(s) {
  return {
    id: s.id.toString(),
    groupId: s.groupId.toString(),
    signal: s.signal,
    nullifier: s.nullifier,
    merkleTreeRoot: s.merkleTreeRoot,
    timestamp: Number(s.timestamp),
    blockNumber: Number(s.blockNumber),
  };
}

export async function fetchOrganizations() {
  const list = await groupManager().getOrganizations();
  return list.map(toOrg);
}

export async function fetchMembers(groupId) {
  const leaves = await groupManager().getMembers(groupId);
  return leaves.map((l) => BigInt(l));
}

// ── Error decoding ──
const errorIface = new Interface(
  [...ABI.GroupManager, ...ABI.WhistleblowVerifier, ...ABI.Semaphore].filter((f) => f.type === "error")
);

const FRIENDLY = {
  NotGroupAdmin: "Only this organisation's admin can do that. Connect the admin wallet.",
  AlreadyMember: "That identity commitment is already a member.",
  NotMember: "That commitment is not an active member.",
  InvalidCommitment: "That is not a valid identity commitment.",
  EmptyName: "Organisation name cannot be empty.",
  GroupNotFound: "Organisation not found.",
  LeanIMT__LeafGreaterThanSnarkScalarField: "Commitment is larger than the SNARK field. It is not a Semaphore commitment.",
  LeanIMT__LeafAlreadyExists: "That commitment is already in the tree.",
};

export function describeError(err) {
  if (!err) return "Something went wrong.";
  if (err.code === "ACTION_REJECTED" || err?.info?.error?.code === 4001) return "You rejected the request in your wallet.";
  const data = err.data || err?.info?.error?.data || err?.error?.data || err?.revert?.data;
  if (err.revert?.name) return FRIENDLY[err.revert.name] || err.revert.name;
  if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
    try {
      const parsed = errorIface.parseError(data);
      if (parsed) return FRIENDLY[parsed.name] || parsed.name;
    } catch {}
  }
  return err.shortMessage || err.reason || err.message || "Something went wrong.";
}

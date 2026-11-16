// Local identity vault. Private keys live only in this browser's localStorage (and any backup file
// the user exports). Nothing here is ever sent to a server.
import { Identity } from "@semaphore-protocol/core";

const KEY = "zkwb.identities";

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    throw new Error("Browser storage is unavailable. Export a backup file instead.");
  }
  window.dispatchEvent(new Event("zkwb-identities"));
}

export const listIdentities = () => read();

export function createIdentity(label) {
  const id = new Identity();
  return saveIdentity(id.export(), label);
}

export function saveIdentity(privateKey, label) {
  const id = Identity.import(privateKey.trim()); // throws if malformed
  const commitment = id.commitment.toString();
  const list = read();
  if (list.some((x) => x.commitment === commitment)) throw new Error("This identity is already saved in this browser.");
  const entry = {
    commitment,
    privateKey: id.export(),
    label: label?.trim() || `Identity ${list.length + 1}`,
    createdAt: Date.now(),
  };
  write([...list, entry]);
  return entry;
}

export function renameIdentity(commitment, label) {
  write(read().map((x) => (x.commitment === commitment ? { ...x, label } : x)));
}

export function deleteIdentity(commitment) {
  write(read().filter((x) => x.commitment !== commitment));
}

export const loadIdentity = (entry) => Identity.import(entry.privateKey);

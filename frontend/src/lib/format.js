export const short = (s, head = 6, tail = 4) => {
  const str = String(s ?? "");
  return str.length <= head + tail + 1 ? str : `${str.slice(0, head)}…${str.slice(-tail)}`;
};

export const toHex32 = (v) => "0x" + BigInt(v).toString(16).padStart(64, "0");

export const fmtDate = (unixSeconds) =>
  unixSeconds
    ? new Date(unixSeconds * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "—";

export function timeAgo(unixSeconds) {
  const diff = Math.max(0, Date.now() / 1000 - unixSeconds);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return `${Math.floor(diff / 86400)} d ago`;
}

/**
 * Canonical form of a report before hashing: normalise line endings and trim the ends,
 * so a verifier who copies the text through email or a document still gets the same hash.
 */
export const canonicalReport = (text) => text.replace(/\r\n?/g, "\n").trim();

/** SHA-256 of the canonical report text, as a uint256 bigint (the on-chain signal). */
export async function reportSignal(text) {
  const bytes = new TextEncoder().encode(canonicalReport(text));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return BigInt("0x" + hex);
}

/** Accepts 0x-hex or decimal, returns bigint or null. */
export function parseUint(input) {
  const s = String(input ?? "").trim();
  if (!s) return null;
  try {
    if (/^0x[0-9a-fA-F]{1,64}$/.test(s)) return BigInt(s);
    if (/^\d{1,78}$/.test(s)) return BigInt(s);
  } catch {}
  return null;
}

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHead, Section, Chip, Button, Empty, Callout, Hash, KV, Tally } from "../components/ui";
import { describeError, fetchOrganizations, toSubmission, verifierContract } from "../lib/chain";
import { fmtDate, parseUint, reportSignal, short, timeAgo, toHex32 } from "../lib/format";
import { addressUrl } from "../lib/config";

const MODES = [
  { key: "text", label: "Report text" },
  { key: "id", label: "Submission ID" },
  { key: "hash", label: "Report hash" },
  { key: "file", label: "Receipt file" },
];
const PAGE = 10;

export default function Verify() {
  const [params, setParams] = useSearchParams();
  const [mode, setMode] = useState(params.get("hash") ? "hash" : params.get("id") ? "id" : "text");
  const [input, setInput] = useState(params.get("hash") || params.get("id") || "");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [orgs, setOrgs] = useState({});
  const [recent, setRecent] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);

  useEffect(() => {
    fetchOrganizations().then((list) => setOrgs(Object.fromEntries(list.map((o) => [o.groupId, o])))).catch(() => {});
  }, []);

  const loadRecent = useCallback(async (p) => {
    const v = verifierContract();
    const [count, rows] = await Promise.all([v.getSubmissionCount(), v.getRecentSubmissions(p * PAGE, PAGE)]);
    setTotal(Number(count));
    setRecent(rows.map(toSubmission));
  }, []);
  useEffect(() => { loadRecent(page).catch(() => setRecent([])); }, [page, loadRecent]);

  /** Look up by signal and render the verdict. `fromText` marks a hash we computed ourselves. */
  const lookupSignal = useCallback(async (signal, meta = {}) => {
    const v = verifierContract();
    const [verified] = await v.isVerified(signal);
    const subs = verified ? (await v.getSubmissionsBySignal(signal)).map(toSubmission) : [];
    setResult({ verified, signal, submissions: subs, ...meta });
  }, []);

  const run = useCallback(async (m = mode, value = input) => {
    setLoading(true);
    setResult(null);
    try {
      if (m === "text") {
        if (!value.trim()) throw new Error("Paste the report text you received.");
        await lookupSignal(await reportSignal(value), { source: "text" });
      } else if (m === "hash") {
        const s = parseUint(value);
        if (s === null) throw new Error("Enter a 0x… hex hash or a decimal number.");
        await lookupSignal(s, { source: "hash" });
        setParams({ hash: value.trim() }, { replace: true });
      } else if (m === "id") {
        const id = parseUint(value);
        if (id === null) throw new Error("Enter a numeric submission ID.");
        const count = await verifierContract().getSubmissionCount();
        if (id >= count) { setResult({ verified: false, notFoundId: id.toString() }); return; }
        const sub = toSubmission(await verifierContract().getSubmission(id));
        await lookupSignal(sub.signal, { source: "id", focusId: sub.id });
        setParams({ id: id.toString() }, { replace: true });
      }
    } catch (e) {
      setResult({ error: e.message?.startsWith("Enter") || e.message?.startsWith("Paste") ? e.message : describeError(e) });
    } finally {
      setLoading(false);
    }
  }, [mode, input, lookupSignal, setParams]);

  // Auto-run when opened from a link (?id= or ?hash=).
  useEffect(() => {
    if (params.get("id") || params.get("hash")) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setLoading(true);
    setResult(null);
    try {
      const data = JSON.parse(await file.text());
      if (typeof data.report !== "string") throw new Error("Receipt has no report text.");
      // Never trust the hash written in the file: recompute it from the text.
      const signal = await reportSignal(data.report);
      const claimed = data.reportHash ? parseUint(data.reportHash) : null;
      await lookupSignal(signal, { source: "file", reportText: data.report, hashMismatch: claimed !== null && claimed !== signal });
    } catch (err) {
      setResult({ error: err.message?.includes("JSON") ? "That file isn't a valid receipt." : err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <PageHead
        eyebrow="Journalist · regulator · compliance"
        title="Verify a submission"
        lede="Check whether a report you received was submitted by a verified insider. This reads the public verifier contract directly. No account needed, and nothing you paste leaves your browser."
      />

      <Section title="Look up">
        <div className="mt-5 inline-flex flex-wrap border border-[var(--line)] rounded-[3px] bg-[var(--surface)] p-[3px] gap-[2px]" role="tablist">
          {MODES.map((m) => (
            <button
              key={m.key}
              role="tab"
              aria-selected={mode === m.key}
              className={`btn btn-sm ${mode === m.key ? "btn-primary" : "btn-ghost"}`}
              onClick={() => { setMode(m.key); setInput(""); setResult(null); }}
            >
              {m.label}
            </button>
          ))}
        </div>

        <form className="mt-4" onSubmit={(e) => { e.preventDefault(); run(); }}>
          {mode === "text" && (
            <>
              <textarea className="textarea" rows={6} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Paste the full report text exactly as you received it…" />
              <p className="hint">Hashed with SHA-256 in your browser. Line endings and leading/trailing whitespace are normalised.</p>
            </>
          )}
          {mode === "id" && <input className="input mono max-w-xs" value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. 0" inputMode="numeric" />}
          {mode === "hash" && <input className="input mono" value={input} onChange={(e) => setInput(e.target.value)} placeholder="0x…" spellCheck={false} />}
          {mode === "file" ? (
            <label className="btn btn-primary cursor-pointer">
              Choose receipt (.json)
              <input type="file" accept="application/json,.json" className="hidden" onChange={onFile} />
            </label>
          ) : (
            <Button type="submit" className="mt-3" loading={loading}>Verify</Button>
          )}
        </form>

        {result && <Verdict result={result} orgs={orgs} />}
      </Section>

      <Section
        title="Recent verified submissions"
        note="Every report hash logged by the verifier contract. Each one is backed by a valid membership proof."
        right={<Button variant="ghost" size="sm" onClick={() => loadRecent(page)}>Refresh</Button>}
      >
        <div className="card mt-5 table-wrap">
          {recent === null ? <Empty>Loading…</Empty> : recent.length === 0 ? <Empty>No submissions yet.</Empty> : (
            <table className="tbl">
              <thead><tr><th>ID</th><th>Organisation</th><th>Report hash</th><th>When</th><th /></tr></thead>
              <tbody>
                {recent.map((s) => (
                  <tr key={s.id}>
                    <td className="num">#{s.id}</td>
                    <td>{orgs[s.groupId]?.name || `Group #${s.groupId}`}</td>
                    <td className="hash">{short(toHex32(s.signal), 10, 6)}</td>
                    <td className="muted whitespace-nowrap" title={fmtDate(s.timestamp)}>{timeAgo(s.timestamp)}</td>
                    <td className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => { setMode("id"); setInput(s.id); run("id", s.id); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                        Inspect
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {total > PAGE && (
          <div className="flex items-center gap-3 mt-4">
            <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Newer</Button>
            <span className="mono text-[12px] muted">Page {page + 1} of {Math.ceil(total / PAGE)}</span>
            <Button variant="secondary" size="sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}>Older</Button>
          </div>
        )}
      </Section>
    </>
  );
}

function Verdict({ result, orgs }) {
  if (result.error) return <Callout tone="risk" className="mt-6" title="Couldn't check.">{result.error}</Callout>;

  if (result.notFoundId !== undefined) {
    return (
      <div className="verdict risk mt-6">
        <Chip tone="risk" dot>not found</Chip>
        <p className="verdict-title">No submission #{result.notFoundId}</p>
      </div>
    );
  }

  if (!result.verified) {
    return (
      <div className="verdict risk mt-6">
        <Chip tone="risk" dot>not verified</Chip>
        <p className="verdict-title">No verified insider submission matches</p>
        <p className="mid mt-2 mb-0">
          {result.source === "text" || result.source === "file"
            ? "Either this report was never submitted with a valid proof, or the text differs from what was submitted. Even one changed character produces a different hash."
            : "No valid proof has been logged for this hash."}
        </p>
        <div className="mt-4"><span className="eyebrow !text-[10px]">Hash checked</span><br /><span className="hash">{toHex32(result.signal)}</span></div>
      </div>
    );
  }

  const first = result.submissions[0];
  const org = orgs[first.groupId];
  const n = result.submissions.length;

  return (
    <div className="mt-6">
      <div className="verdict ok">
        <div className="flex flex-wrap gap-2">
          <Chip tone="ok" dot>verified insider</Chip>
          {n > 1 && <Chip tone="acc">{n} independent insiders</Chip>}
        </div>
        <p className="verdict-title">Submitted by a member of {org?.name || `group #${first.groupId}`}</p>
        <p className="mid mt-2 mb-0">
          A valid zero-knowledge proof showed the sender held a secret matching one of the organisation's {org?.activeMembers ?? "registered"} member commitments. The proof reveals nothing about which member.
        </p>
      </div>

      {result.hashMismatch && (
        <Callout tone="warn" className="mt-4" title="Receipt hash doesn't match its text.">
          The verdict above uses the hash recomputed from the report text, not the hash written in the file.
        </Callout>
      )}

      {n > 1 && (
        <Tally items={[
          { value: n, label: "Distinct insiders submitted this exact report", tone: "ok" },
          { value: fmtDate(first.timestamp).split(",")[0], label: "First submitted" },
          { value: org?.activeMembers ?? "—", label: "Members in the group" },
        ]} />
      )}

      <div className="mt-5">
        <KV rows={[
          ["Organisation", org ? `${org.name} (group #${org.groupId})` : `Group #${first.groupId}`],
          org && ["Org admin", <a key="a" className="hash" href={addressUrl(org.admin) || undefined} target="_blank" rel="noreferrer">{org.admin}</a>],
          ["Report hash", <Hash key="h" value={toHex32(result.signal)} />],
          ["First verified", fmtDate(first.timestamp)],
        ]} />
      </div>

      {result.reportText && (
        <div className="card card-pad mt-5">
          <div className="eyebrow !mb-2">Report text from receipt</div>
          <p className="m-0 whitespace-pre-wrap mid">{result.reportText}</p>
        </div>
      )}

      <div className="card mt-5 table-wrap">
        <div className="card-head"><span className="h3 !m-0 !text-[14.5px]">On-chain submissions of this report</span></div>
        <table className="tbl">
          <thead><tr><th>ID</th><th>Time</th><th>Block</th><th>Nullifier</th><th>Merkle root used</th></tr></thead>
          <tbody>
            {result.submissions.map((s) => (
              <tr key={s.id} style={result.focusId === s.id ? { background: "var(--accent-soft)" } : undefined}>
                <td className="num">#{s.id}</td>
                <td className="whitespace-nowrap">{fmtDate(s.timestamp)}</td>
                <td className="num">{s.blockNumber}</td>
                <td className="hash" title={s.nullifier.toString()}>{short(s.nullifier.toString(), 8, 6)}</td>
                <td className="hash" title={s.merkleTreeRoot.toString()}>{short(s.merkleTreeRoot.toString(), 8, 6)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Callout className="mt-5" title="What this does and doesn't tell you.">
        It confirms the sender was on {org?.name || "the organisation"}'s member list at the time. It does not confirm the report is true, and it depends on the admin having added only genuine employees.
      </Callout>
    </div>
  );
}

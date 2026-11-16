import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Group, generateProof } from "@semaphore-protocol/core";
import { PageHead, Section, Chip, Button, Field, Empty, Callout, Hash, KV, Spinner } from "../components/ui";
import { useIdentities, useMemberships } from "./Identity";
import { loadIdentity } from "../lib/identities";
import { fetchMembers, verifierContract, describeError } from "../lib/chain";
import { canonicalReport, downloadJson, fmtDate, reportSignal, short, toHex32 } from "../lib/format";
import { CHAIN, RELAYER_URL, txUrl } from "../lib/config";

const STEPS = ["Identity & organisation", "Write report", "Generate proof", "Submit anonymously"];

export default function Report() {
  const identities = useIdentities();
  const { memberships } = useMemberships(identities);
  const [step, setStep] = useState(0);
  const [choice, setChoice] = useState(null); // { commitment, groupId }
  const [text, setText] = useState("");
  const [signal, setSignal] = useState(null);
  const [proofState, setProofState] = useState({ status: "idle" });
  const [submitState, setSubmitState] = useState({ status: "idle" });
  const [relayer, setRelayer] = useState(null);

  // Eligible (identity, organisation) pairs.
  const options = useMemo(() => {
    if (!memberships) return null;
    return identities.flatMap((id) => (memberships[id.commitment] || []).map((org) => ({ id, org })));
  }, [identities, memberships]);

  useEffect(() => {
    if (options?.length && !choice) setChoice({ commitment: options[0].id.commitment, groupId: options[0].org.groupId });
  }, [options, choice]);

  useEffect(() => {
    let alive = true;
    reportSignal(text).then((s) => alive && setSignal(text.trim() ? s : null));
    return () => { alive = false; };
  }, [text]);

  useEffect(() => {
    fetch(`${RELAYER_URL}/health`).then((r) => r.json()).then(setRelayer).catch(() => setRelayer({ ok: false }));
  }, []);

  const selected = options?.find((o) => o.id.commitment === choice?.commitment && o.org.groupId === choice?.groupId);

  const prove = async () => {
    const t0 = performance.now();
    try {
      setProofState({ status: "working", phase: "Fetching the organisation's member list…" });
      const leaves = await fetchMembers(selected.org.groupId);
      const group = new Group(leaves);
      const identity = loadIdentity(selected.id);
      if (group.indexOf(identity.commitment) === -1) throw new Error("Your identity is no longer in this organisation's member list.");

      setProofState({ status: "working", phase: "Downloading proving key (first time only) and computing the zk-SNARK…" });
      await new Promise((r) => setTimeout(r, 50)); // let the UI paint before the heavy work
      const sig = await reportSignal(text);
      const proof = await generateProof(identity, group, sig, sig);

      const used = await verifierContract().nullifierUsed(selected.org.groupId, proof.nullifier);
      setProofState({
        status: "done",
        proof,
        signal: sig,
        anonymitySet: leaves.filter((l) => l !== 0n).length,
        ms: Math.round(performance.now() - t0),
        alreadyUsed: used,
      });
      setStep(3);
    } catch (e) {
      setProofState({ status: "error", message: e.message || String(e) });
    }
  };

  const submit = async () => {
    setSubmitState({ status: "working" });
    try {
      const res = await fetch(`${RELAYER_URL}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupId: selected.org.groupId, proof: proofState.proof }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message || `Relayer error (${res.status})`);
      setSubmitState({ status: "done", ...body });
    } catch (e) {
      setSubmitState({ status: "error", message: e.message === "Failed to fetch" ? "Couldn't reach the relayer. Is it running?" : describeError(e) });
    }
  };

  const receipt = submitState.status === "done" && {
    type: "zk-whistleblow-receipt-v1",
    note: "Share this file (or just the report text) with the journalist or regulator. It contains no information about your identity.",
    chainId: CHAIN.id,
    network: CHAIN.name,
    organization: selected.org.name,
    groupId: selected.org.groupId,
    submissionId: submitState.submissionId,
    reportHash: toHex32(proofState.signal),
    transactionHash: submitState.txHash,
    blockNumber: submitState.blockNumber,
    timestamp: submitState.timestamp,
    report: canonicalReport(text),
    verifyAt: `${location.origin}/verify?id=${submitState.submissionId}`,
  };

  const reset = () => {
    setText(""); setProofState({ status: "idle" }); setSubmitState({ status: "idle" }); setStep(0);
  };

  return (
    <>
      <PageHead
        eyebrow="Whistleblower"
        title="Submit an anonymous report"
        lede="Your browser proves you're a member of the organisation and binds that proof to your report's hash. The report text and your identity never leave this device. Only the proof and the hash do."
      />

      <div className="stepper" role="list">
        {STEPS.map((s, i) => (
          <div key={s} role="listitem" className={i === step ? "cur" : i < step ? "done" : ""}>
            <span className="n">{i < step ? "✓" : i + 1}</span>
            <span>{s}</span>
          </div>
        ))}
      </div>

      {relayer && !relayer.ok && (
        <Callout tone="risk" className="mt-6" title="Relayer offline.">
          You can prepare a proof, but submission needs the relayer at <code className="inline">{RELAYER_URL}</code>. Start it with <code className="inline">npm start</code> in <code className="inline">relayer/</code>.
        </Callout>
      )}

      <div className="wrap-narrow !px-0 !mx-0">
        {/* ── Step 1 ── */}
        {step === 0 && (
          <Section title="Choose identity and organisation" note="Only identities that are already in an organisation's member tree can prove membership.">
            {options === null ? <Empty>Checking your identities…</Empty> : options.length === 0 ? (
              <div className="card mt-5 card-pad">
                <p className="m-0 mid">None of the identities saved in this browser belong to a registered organisation yet.</p>
                <Link to="/identity" className="btn btn-primary mt-4">Go to My identity</Link>
              </div>
            ) : (
              <>
                <div className="mt-5 flex flex-col gap-2">
                  {options.map(({ id, org }) => {
                    const on = choice?.commitment === id.commitment && choice?.groupId === org.groupId;
                    return (
                      <label key={id.commitment + org.groupId} className={`card px-4 py-3 flex items-center gap-3 cursor-pointer ${on ? "!border-[var(--accent)] shadow-[inset_3px_0_0_var(--accent)]" : ""}`}>
                        <input type="radio" name="choice" checked={on} onChange={() => setChoice({ commitment: id.commitment, groupId: org.groupId })} className="accent-[var(--accent)]" />
                        <span className="min-w-0 flex-1">
                          <span className="font-semibold block">{org.name}</span>
                          <span className="text-[13px] muted">as <span className="mid">{id.label}</span> · <span className="mono">{short(id.commitment, 8, 6)}</span></span>
                        </span>
                        <Chip tone={org.activeMembers >= 3 ? "ok" : "todo"}>{org.activeMembers} members</Chip>
                      </label>
                    );
                  })}
                </div>
                {selected && selected.org.activeMembers < 3 && (
                  <Callout tone="warn" className="mt-4" title="Weak anonymity.">
                    This organisation has only {selected.org.activeMembers} member{selected.org.activeMembers > 1 ? "s" : ""}. Your report could be traced to very few people.
                  </Callout>
                )}
                <Button className="mt-6" onClick={() => setStep(1)} disabled={!selected}>Continue</Button>
              </>
            )}
          </Section>
        )}

        {/* ── Step 2 ── */}
        {step === 1 && (
          <Section title="Write your report" note="Describe what you witnessed. Leave out details only you could know (your team, your shifts, files only you accessed). They can identify you even when the proof can't.">
            <div className="mt-5 flex flex-col gap-3">
              <Field label="Report" htmlFor="report">
                <textarea id="report" className="textarea" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder="What happened, when, and what evidence exists…" />
              </Field>
              <div className="card px-4 py-3">
                <div className="eyebrow !mb-1 !text-[10px]">SHA-256 report hash: the on-chain signal</div>
                <span className="hash">{signal ? toHex32(signal) : <span className="muted">Start typing…</span>}</span>
              </div>
              <div className="flex gap-3 mt-3">
                <Button variant="secondary" onClick={() => setStep(0)}>Back</Button>
                <Button onClick={() => { setProofState({ status: "idle" }); setStep(2); }} disabled={canonicalReport(text).length < 20}>Continue</Button>
              </div>
              {text && canonicalReport(text).length < 20 && <p className="hint !mt-0">Write at least 20 characters.</p>}
            </div>
          </Section>
        )}

        {/* ── Step 3 ── */}
        {step === 2 && (
          <Section title="Generate the zero-knowledge proof" note="This runs entirely in your browser. It usually takes a few seconds, longer the first time while the proving key downloads.">
            <div className="mt-5">
              <KV rows={[
                ["Organisation", `${selected.org.name} (group #${selected.org.groupId})`],
                ["Proving as", <span key="p">one of <strong>{selected.org.activeMembers}</strong> members, without revealing which</span>],
                ["Report hash", <span key="h" className="hash">{signal ? toHex32(signal) : "…"}</span>],
              ]} />
            </div>
            {proofState.status === "working" && (
              <div className="card mt-5 card-pad flex items-center gap-3"><Spinner /><span className="mid">{proofState.phase}</span></div>
            )}
            {proofState.status === "error" && <Callout tone="risk" className="mt-5" title="Proof failed.">{proofState.message}</Callout>}
            <div className="flex gap-3 mt-6">
              <Button variant="secondary" onClick={() => setStep(1)} disabled={proofState.status === "working"}>Back</Button>
              <Button onClick={prove} loading={proofState.status === "working"}>Generate proof</Button>
            </div>
          </Section>
        )}

        {/* ── Step 4 ── */}
        {step === 3 && proofState.status === "done" && (
          <Section title={submitState.status === "done" ? "Report verified on-chain" : "Submit through the relayer"}>
            {submitState.status !== "done" && (
              <>
                <p className="sec-note">
                  Proof generated in {(proofState.ms / 1000).toFixed(1)}s. The relayer pays the gas, so your wallet address never touches this report. It can't alter the report: any change breaks the proof.
                </p>
                <div className="mt-5">
                  <KV rows={[
                    ["Anonymity set", `${proofState.anonymitySet} members`],
                    ["Merkle root", <Hash key="r" value={proofState.proof.merkleTreeRoot} display={short(proofState.proof.merkleTreeRoot, 14, 10)} copy={false} />],
                    ["Nullifier", <Hash key="n" value={proofState.proof.nullifier} display={short(proofState.proof.nullifier, 14, 10)} copy={false} />],
                    ["Tree depth", proofState.proof.merkleTreeDepth],
                    ["Relayer", relayer?.ok ? <span key="rl" className="mono text-[12.5px]">{short(relayer.relayer, 10, 6)}</span> : <Chip tone="risk">offline</Chip>],
                  ]} />
                </div>
                {proofState.alreadyUsed && (
                  <Callout tone="warn" className="mt-5" title="Already submitted.">
                    This identity has already submitted this exact report. The contract will reject a second copy (nullifier reuse).
                  </Callout>
                )}
                {submitState.status === "error" && <Callout tone="risk" className="mt-5" title="Submission rejected.">{submitState.message}</Callout>}
                <div className="flex gap-3 mt-6">
                  <Button variant="secondary" onClick={() => setStep(1)} disabled={submitState.status === "working"}>Edit report</Button>
                  <Button onClick={submit} loading={submitState.status === "working"} disabled={!relayer?.ok}>Submit anonymously</Button>
                </div>
              </>
            )}

            {submitState.status === "done" && (
              <>
                <div className="verdict ok mt-5">
                  <Chip tone="ok" dot>verified insider</Chip>
                  <p className="verdict-title">Submission #{submitState.submissionId}</p>
                  <p className="mid mt-2 mb-0">
                    The contract checked your proof and logged the report hash as coming from a member of <strong>{selected.org.name}</strong>. Nothing on-chain identifies you.
                  </p>
                </div>
                <div className="mt-5">
                  <KV rows={[
                    ["Report hash", <Hash key="h" value={receipt.reportHash} />],
                    ["Transaction", txUrl(submitState.txHash)
                      ? <a key="t" href={txUrl(submitState.txHash)} target="_blank" rel="noreferrer" className="hash">{short(submitState.txHash, 12, 8)}</a>
                      : <Hash key="t" value={submitState.txHash} display={short(submitState.txHash, 12, 8)} />],
                    ["Block", <span key="b" className="mono">{submitState.blockNumber}</span>],
                    ["Time", fmtDate(submitState.timestamp)],
                  ]} />
                </div>
                <Callout className="mt-6" title="Next: send the report to the recipient.">
                  Download the receipt and share it, or the report text alone, through a secure channel such as SecureDrop or Signal. They can paste it into the Verify page to confirm it came from a verified insider.
                </Callout>
                <div className="flex flex-wrap gap-3 mt-6">
                  <Button onClick={() => downloadJson(`report-receipt-${submitState.submissionId}.json`, receipt)}>Download receipt</Button>
                  <Link className="btn btn-secondary" to={`/verify?id=${submitState.submissionId}`}>View on Verify page</Link>
                  <Button variant="ghost" onClick={reset}>Write another report</Button>
                </div>
              </>
            )}
          </Section>
        )}
      </div>
    </>
  );
}

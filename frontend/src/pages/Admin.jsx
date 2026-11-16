import { useCallback, useEffect, useMemo, useState } from "react";
import { Group } from "@semaphore-protocol/core";
import { PageHead, Section, Tally, Chip, Button, Field, Empty, Callout, Hash, KV } from "../components/ui";
import { useWallet } from "../context/Wallet";
import { useToast } from "../context/Toast";
import { describeError, fetchMembers, fetchOrganizations, groupManager } from "../lib/chain";
import { fmtDate, parseUint, short } from "../lib/format";
import { addressUrl } from "../lib/config";

const SNARK_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export default function Admin() {
  const wallet = useWallet();
  const toast = useToast();
  const [orgs, setOrgs] = useState(null);
  const [selected, setSelected] = useState(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await fetchOrganizations();
      setOrgs(list);
      return list;
    } catch (e) {
      toast(describeError(e), "risk");
      setOrgs([]);
      return [];
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const mine = useMemo(
    () => (orgs || []).filter((o) => wallet.account && o.admin.toLowerCase() === wallet.account.toLowerCase()),
    [orgs, wallet.account]
  );

  // Default the selection to the first org this wallet administers, else the first org.
  useEffect(() => {
    if (!orgs?.length) return;
    if (selected && orgs.some((o) => o.groupId === selected)) return;
    setSelected((mine[0] || orgs[0]).groupId);
  }, [orgs, mine, selected]);

  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const tx = await groupManager(wallet.signer).createGroup(name.trim());
      const receipt = await tx.wait();
      const gm = groupManager();
      const ev = receipt.logs.map((l) => { try { return gm.interface.parseLog(l); } catch { return null; } }).find((x) => x?.name === "OrganizationCreated");
      toast(`"${name.trim()}" registered as group #${ev?.args.groupId}`, "ok");
      setName("");
      await load();
      if (ev) setSelected(ev.args.groupId.toString());
    } catch (err) {
      toast(describeError(err), "risk");
    } finally {
      setCreating(false);
    }
  };

  const org = orgs?.find((o) => o.groupId === selected);

  return (
    <>
      <PageHead
        eyebrow="Employer / registrar"
        title="Organisations"
        lede="Register your organisation as a Semaphore group and add the identity commitments your employees send you. Commitments are one-way hashes. Even you can't link a later report back to a specific person."
      />

      {!wallet.account && (
        <Callout className="mt-7" title="Read-only view.">
          Connect an admin wallet (top right) to register an organisation or manage members.
        </Callout>
      )}

      <div className="grid gap-8 mt-2 lg:grid-cols-[300px_1fr]">
        <aside>
          <Section title="Registered" className="!mt-10">
            <div className="mt-4 flex flex-col gap-2">
              {orgs === null && <Empty>Loading…</Empty>}
              {orgs?.length === 0 && <Empty>No organisations yet.</Empty>}
              {orgs?.map((o) => {
                const isMine = mine.includes(o);
                return (
                  <button
                    key={o.groupId}
                    onClick={() => setSelected(o.groupId)}
                    className={`card text-left px-4 py-3 cursor-pointer transition-colors ${selected === o.groupId ? "!border-[var(--accent)] shadow-[inset_3px_0_0_var(--accent)]" : "hover:!border-[var(--text-muted)]"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[15px] truncate">{o.name}</span>
                      {isMine && <Chip tone="acc">admin</Chip>}
                    </div>
                    <div className="mono text-[12px] muted mt-1">
                      Group #{o.groupId} · {o.activeMembers} member{o.activeMembers === 1 ? "" : "s"}
                    </div>
                  </button>
                );
              })}
            </div>
          </Section>

          {wallet.account && !wallet.wrongNetwork && (
            <Section title="Register new" className="!mt-10">
              <form onSubmit={create} className="mt-4 flex flex-col gap-3">
                <Field label="Organisation name" htmlFor="org-name" hint="Public. Shown to verifiers next to every report.">
                  <input id="org-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Pharma Ltd." maxLength={80} />
                </Field>
                <Button type="submit" loading={creating} disabled={!name.trim()}>Create group on-chain</Button>
              </form>
            </Section>
          )}
        </aside>

        <div className="min-w-0">
          {org ? <OrgDetail key={org.groupId} org={org} isAdmin={mine.includes(org)} onChanged={load} /> : orgs?.length ? null : (
            <Section title="Nothing selected" className="!mt-10"><Empty>Register an organisation to get started.</Empty></Section>
          )}
        </div>
      </div>
    </>
  );
}

function OrgDetail({ org, isAdmin, onChanged }) {
  const wallet = useWallet();
  const toast = useToast();
  const [leaves, setLeaves] = useState(null);
  const [root, setRoot] = useState(null);
  const [input, setInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(null);

  const refresh = useCallback(async () => {
    const [l, r] = await Promise.all([fetchMembers(org.groupId), groupManager().getMerkleRoot(org.groupId)]);
    setLeaves(l);
    setRoot(r);
  }, [org.groupId]);

  useEffect(() => { refresh().catch((e) => toast(describeError(e), "risk")); }, [refresh, toast]);

  const parsed = useMemo(() => {
    const lines = input.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    const valid = [], invalid = [];
    for (const l of lines) {
      const v = parseUint(l);
      if (v && v > 0n && v < SNARK_FIELD) valid.push(v); else invalid.push(l);
    }
    return { valid: [...new Set(valid)], invalid };
  }, [input]);

  const add = async () => {
    setAdding(true);
    try {
      const gm = groupManager(wallet.signer);
      const tx = parsed.valid.length === 1 ? await gm.addMember(org.groupId, parsed.valid[0]) : await gm.addMembers(org.groupId, parsed.valid);
      await tx.wait();
      toast(`Added ${parsed.valid.length} member${parsed.valid.length > 1 ? "s" : ""}. Merkle root updated.`, "ok");
      setInput("");
      await refresh();
      onChanged();
    } catch (e) {
      toast(describeError(e), "risk");
    } finally {
      setAdding(false);
    }
  };

  const remove = async (commitment, index) => {
    if (!confirm("Remove this member? Proofs made against the old member list stay valid for up to 1 hour (the revocation window).")) return;
    setRemoving(index);
    try {
      // Rebuild the exact on-chain tree to compute the Merkle siblings the contract needs.
      const group = new Group(leaves);
      const { siblings } = group.generateMerkleProof(index);
      const tx = await groupManager(wallet.signer).removeMember(org.groupId, commitment, siblings);
      await tx.wait();
      toast("Member removed. Merkle root updated.", "ok");
      await refresh();
      onChanged();
    } catch (e) {
      toast(describeError(e), "risk");
    } finally {
      setRemoving(null);
    }
  };

  const active = leaves?.filter((l) => l !== 0n).length ?? org.activeMembers;
  const removed = leaves ? leaves.length - active : 0;

  return (
    <>
      <Section
        title={org.name}
        className="!mt-10"
        right={isAdmin ? <Chip tone="acc" dot>You are admin</Chip> : <Chip>Read only</Chip>}
      >
        <Tally
          items={[
            { value: active, label: "Active members (anonymity set)", tone: active >= 3 ? "ok" : "todo" },
            { value: removed, label: "Removed", tone: removed ? "risk" : "" },
            { value: `#${org.groupId}`, label: "Group ID", tone: "acc" },
          ]}
        />
        <div className="mt-5">
          <KV
            rows={[
              ["Admin", <a key="a" href={addressUrl(org.admin) || undefined} target="_blank" rel="noreferrer" className="hash !no-underline">{org.admin}</a>],
              ["Created", fmtDate(org.createdAt)],
              ["Current Merkle root", root !== null ? <Hash key="r" value={root.toString()} display={short(root.toString(), 14, 10)} /> : "…"],
            ]}
          />
        </div>
        {active > 0 && active < 3 && (
          <Callout tone="warn" className="mt-5" title="Small anonymity set.">
            With {active} member{active > 1 ? "s" : ""}, a report narrows the source to very few people. Add more members before anyone reports.
          </Callout>
        )}
      </Section>

      {isAdmin && !wallet.wrongNetwork && (
        <Section title="Add members" note="Paste identity commitments your employees sent you through an internal channel, one per line. Never accept private keys.">
          <div className="mt-4 flex flex-col gap-3">
            <textarea className="textarea mono" rows={4} value={input} onChange={(e) => setInput(e.target.value)} placeholder={"1384937209845729…\n9938475610293847…"} />
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={add} loading={adding} disabled={!parsed.valid.length || parsed.invalid.length > 0}>
                Add {parsed.valid.length || ""} member{parsed.valid.length === 1 ? "" : "s"}
              </Button>
              {parsed.invalid.length > 0 && (
                <span className="text-[13.5px]" style={{ color: "var(--risk)" }}>
                  {parsed.invalid.length} line{parsed.invalid.length > 1 ? "s are" : " is"} not a valid commitment: {short(parsed.invalid[0], 12, 4)}
                </span>
              )}
            </div>
          </div>
        </Section>
      )}

      <Section title="Member tree" note="Leaves of the on-chain Merkle tree in order. The platform stores no names. Removed members leave a zero leaf, as in Semaphore's LeanIMT.">
        <div className="card mt-5 table-wrap">
          {leaves === null ? <Empty>Loading…</Empty> : leaves.length === 0 ? <Empty>No members yet.</Empty> : (
            <table className="tbl">
              <thead>
                <tr><th>Leaf</th><th>Identity commitment</th><th>Status</th>{isAdmin && <th />}</tr>
              </thead>
              <tbody>
                {leaves.map((l, i) => (
                  <tr key={i}>
                    <td className="num muted">{i}</td>
                    <td className="hash">{l === 0n ? <span className="muted">0 (removed)</span> : short(l.toString(), 18, 8)}</td>
                    <td>{l === 0n ? <Chip tone="risk">removed</Chip> : <Chip tone="ok">active</Chip>}</td>
                    {isAdmin && (
                      <td className="text-right">
                        {l !== 0n && (
                          <Button variant="danger" size="sm" loading={removing === i} disabled={removing !== null || wallet.wrongNetwork} onClick={() => remove(l, i)}>
                            Remove
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Section>
    </>
  );
}

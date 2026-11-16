import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageHead, Section, Chip, Button, Field, Empty, Callout, Hash } from "../components/ui";
import { useToast } from "../context/Toast";
import { createIdentity, deleteIdentity, listIdentities, saveIdentity } from "../lib/identities";
import { fetchOrganizations, groupManager } from "../lib/chain";
import { downloadJson, short } from "../lib/format";
import { IS_LOCAL, CHAIN_ID } from "../lib/config";

// Demo identities written by contracts/scripts/seed-demo.js (local demo only; may not exist).
const demoFiles = import.meta.glob("../../../deployments/demo-identities.json", { import: "default" });

export function useIdentities() {
  const [list, setList] = useState(listIdentities);
  useEffect(() => {
    const sync = () => setList(listIdentities());
    window.addEventListener("zkwb-identities", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("zkwb-identities", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return list;
}

/** For each saved identity, the organisations whose tree contains it. */
export function useMemberships(identities) {
  const [map, setMap] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const refresh = useCallback(async () => {
    const all = await fetchOrganizations();
    setOrgs(all);
    const gm = groupManager();
    const out = {};
    await Promise.all(
      identities.map(async (id) => {
        const flags = await Promise.all(all.map((o) => gm.isMember(o.groupId, id.commitment)));
        out[id.commitment] = all.filter((_, i) => flags[i]);
      })
    );
    setMap(out);
  }, [identities]);
  useEffect(() => { refresh().catch(() => setMap({})); }, [refresh]);
  return { memberships: map, orgs, refresh };
}

export default function IdentityPage() {
  const toast = useToast();
  const identities = useIdentities();
  const { memberships, refresh } = useMemberships(identities);
  const [label, setLabel] = useState("");
  const [importKey, setImportKey] = useState("");
  const [demo, setDemo] = useState(null);

  useEffect(() => {
    const loader = Object.values(demoFiles)[0];
    // Shown on the local chain, and in dev mode on Sepolia (npm run dev:sepolia) for the course demo.
    if ((IS_LOCAL || import.meta.env.DEV) && loader) loader().then((d) => setDemo(d.filter((x) => x.chainId === CHAIN_ID))).catch(() => {});
  }, []);

  const make = () => {
    try {
      const e = createIdentity(label || undefined);
      setLabel("");
      toast("New identity created and saved in this browser. Export a backup now.", "ok");
      downloadBackup(e);
    } catch (err) {
      toast(err.message, "risk");
    }
  };

  const doImport = (key, lbl) => {
    try {
      saveIdentity(key, lbl);
      toast("Identity imported.", "ok");
      return true;
    } catch (err) {
      toast(err.message.includes("already") ? err.message : "That is not a valid Semaphore private key.", "risk");
      return false;
    }
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      doImport(data.privateKey, data.label);
    } catch {
      toast("Couldn't read that backup file.", "risk");
    }
  };

  return (
    <>
      <PageHead
        eyebrow="Employee onboarding"
        title="Your private identity"
        lede="Your identity is a secret key generated in this browser. You give your employer only its public commitment. Later you can prove you're one of the employees without revealing which one."
      />

      <div className="grid gap-x-10 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0">
          <Section
            title="Saved in this browser"
            right={identities.length > 0 && <Button variant="ghost" size="sm" onClick={refresh}>Refresh status</Button>}
          >
            {identities.length === 0 ? (
              <div className="card mt-5"><Empty>No identities yet. Create one to get started.</Empty></div>
            ) : (
              <div className="mt-2">
                {identities.map((id) => {
                  const orgs = memberships?.[id.commitment];
                  const tone = orgs === undefined ? "" : orgs.length ? "ok" : "todo";
                  return (
                    <div key={id.commitment} className={`row ${tone}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <h3 className="h3 !m-0">{id.label}</h3>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => downloadBackup(id)}>Export backup</Button>
                          <Button
                            variant="ghost" size="sm"
                            onClick={() => confirm("Delete this identity from this browser? Without a backup you can never prove membership with it again.") && deleteIdentity(id.commitment)}
                          >Delete</Button>
                        </div>
                      </div>
                      <div className="eyebrow !mb-1 !text-[10px]">Public commitment: send this to your employer</div>
                      <Hash value={id.commitment} />
                      <div className="mt-3 flex flex-wrap gap-2">
                        {orgs === undefined ? <Chip>checking membership…</Chip>
                          : orgs.length ? orgs.map((o) => <Chip key={o.groupId} tone="ok" dot>member of {o.name}</Chip>)
                          : <Chip tone="todo" dot>not yet added to any organisation</Chip>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {identities.some((id) => memberships?.[id.commitment]?.length) && (
              <Link to="/report" className="btn btn-primary mt-6">Submit a report →</Link>
            )}
          </Section>

          <Section title="Onboarding steps">
            <ol className="steps">
              <li><h3 className="h3">Create an identity</h3><p>Use a personal device, not a work laptop. A backup file downloads automatically.</p></li>
              <li><h3 className="h3">Send the commitment to HR</h3><p>Through a normal internal channel. The commitment is safe to share: it can't be reversed into your key.</p></li>
              <li><h3 className="h3">Wait to be added</h3><p>The admin adds it to the on-chain tree. The chip above turns green when you're in.</p></li>
              <li><h3 className="h3">Keep the backup safe</h3><p>If you lose it there is no recovery. You'd have to be re-added with a new identity.</p></li>
            </ol>
          </Section>
        </div>

        <aside>
          <Section title="Create">
            <div className="mt-4 flex flex-col gap-3">
              <Field label="Label (only stored locally)" htmlFor="id-label">
                <input id="id-label" className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Work identity" maxLength={40} />
              </Field>
              <Button onClick={make}>Generate new identity</Button>
            </div>
          </Section>

          <Section title="Import">
            <div className="mt-4 flex flex-col gap-3">
              <Field label="Private key" htmlFor="imp-key">
                <input id="imp-key" className="input mono" value={importKey} onChange={(e) => setImportKey(e.target.value)} placeholder="Base64 private key" autoComplete="off" spellCheck={false} />
              </Field>
              <Button variant="secondary" disabled={!importKey.trim()} onClick={() => doImport(importKey) && setImportKey("")}>Import key</Button>
              <label className="btn btn-secondary cursor-pointer">
                Restore from backup file
                <input type="file" accept="application/json,.json" className="hidden" onChange={onFile} />
              </label>
            </div>
          </Section>

          {demo?.length > 0 && (
            <Section title="Demo identities" note="Seeded by the demo script. In real use these would exist only on each employee's own device.">
              <div className="card mt-4">
                {demo.map((d) => {
                  const saved = identities.some((x) => x.commitment === d.commitment);
                  return (
                    <div key={d.commitment} className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-[var(--line-soft)] last:border-0">
                      <span className="text-[13.5px] min-w-0 truncate" title={d.label}>{d.label.split("—").pop().trim()}</span>
                      {saved ? <Chip tone="ok">saved</Chip> : (
                        <Button variant="ghost" size="sm" onClick={() => doImport(d.privateKey, d.label)}>Import</Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          <Callout tone="warn" className="mt-10" title="Stored in this browser only.">
            Clearing site data deletes your identity. Keep the exported backup somewhere safe and private.
          </Callout>
        </aside>
      </div>
    </>
  );
}

function downloadBackup(entry) {
  downloadJson(`zk-identity-${short(entry.commitment, 6, 0).replace("…", "")}.json`, {
    type: "semaphore-identity-v4",
    warning: "This file is your secret key. Anyone with it can submit reports as a member of your organisation.",
    label: entry.label,
    privateKey: entry.privateKey,
    commitment: entry.commitment,
  });
}

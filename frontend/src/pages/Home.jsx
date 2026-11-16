import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageHead, Section, Tally, Callout } from "../components/ui";
import { fetchOrganizations, verifierContract } from "../lib/chain";

const ROLES = [
  {
    to: "/admin",
    eyebrow: "Employer / registrar",
    title: "Register an organisation",
    body: "Create an on-chain group and add employees' identity commitments. You never learn which commitment belongs to whom.",
    cta: "Manage organisations",
  },
  {
    to: "/identity",
    eyebrow: "Employee",
    title: "Create your private identity",
    body: "Generate a secret identity in your browser and hand only its public commitment to HR. The secret never leaves this device.",
    cta: "Create identity",
  },
  {
    to: "/report",
    eyebrow: "Whistleblower",
    title: "Submit an anonymous report",
    body: "Prove you are one of the organisation's members, without revealing which one, and log your report's hash on-chain.",
    cta: "Write a report",
  },
  {
    to: "/verify",
    eyebrow: "Journalist / regulator",
    title: "Verify a submission",
    body: "Check whether a report you received was submitted by a verified insider, which organisation, and when.",
    cta: "Open dashboard",
  },
];

export default function Home() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [orgs, count] = await Promise.all([fetchOrganizations(), verifierContract().getSubmissionCount()]);
        setStats({
          orgs: orgs.length,
          members: orgs.reduce((a, o) => a + o.activeMembers, 0),
          reports: Number(count),
        });
      } catch {
        setStats({ error: true });
      }
    })();
  }, []);

  return (
    <>
      <PageHead
        eyebrow="Anonymous insider verification · Semaphore v4 · Ethereum"
        title="Prove you work there. Never reveal who you are."
        lede="Whistleblowing channels can't tell a real insider from a rumour, and proving you're an insider usually gives you away. Zero-knowledge proofs separate the two: the receiver gets mathematical certainty that the source is a member of the organisation, and nothing else."
      />

      {stats?.error ? (
        <Callout tone="risk" className="mt-7" title="Can't reach the chain.">
          Start the local node (<code className="inline">npm run node</code> in <code className="inline">contracts/</code>) or check the RPC URL.
        </Callout>
      ) : (
        <Tally
          items={[
            { value: stats?.orgs, label: "Organisations registered", tone: "acc" },
            { value: stats?.members, label: "Insider identities committed" },
            { value: stats?.reports, label: "Reports verified on-chain", tone: "ok" },
          ]}
        />
      )}

      <Section title="Choose your role" note="Each role uses a different part of the platform. Whistleblowers never need a crypto wallet.">
        <div className="grid gap-4 mt-6 sm:grid-cols-2">
          {ROLES.map((r) => (
            <Link key={r.to} to={r.to} className="role-card">
              <p className="eyebrow !mb-2">{r.eyebrow}</p>
              <h3 className="h3 !text-[18px]">{r.title}</h3>
              <p>{r.body}</p>
              <span className="go">{r.cta} →</span>
            </Link>
          ))}
        </div>
      </Section>

      <div className="grid gap-x-12 lg:grid-cols-[1.15fr_1fr]">
        <Section title="How it works">
          <ol className="steps">
            <li>
              <h3 className="h3">The employer registers a group</h3>
              <p>An admin creates the organisation on-chain. Only a Merkle tree of identity commitments is stored, with no names and no personal data.</p>
            </li>
            <li>
              <h3 className="h3">Each employee makes a secret identity</h3>
              <p>Generated locally in the browser. The employee hands over a one-way commitment, and the admin adds it to the tree.</p>
            </li>
            <li>
              <h3 className="h3">The whistleblower proves membership</h3>
              <p>The browser builds a zk-SNARK showing "my secret is one of these leaves" and binds it to the SHA-256 hash of the report. Nothing else leaves the device.</p>
            </li>
            <li>
              <h3 className="h3">The contract verifies and logs it</h3>
              <p>A relayer pays the gas so no wallet is linked to the report. The verifier contract checks the proof and records the hash as a verified insider signal.</p>
            </li>
          </ol>
        </Section>

        <Section title="What the proof reveals">
          <table className="compare">
            <thead>
              <tr><th>Revealed</th><th>Hidden from everyone</th></tr>
            </thead>
            <tbody>
              <tr><td>The sender is a member of Organisation X</td><td>Which member they are</td></tr>
              <tr><td>The report's hash</td><td>The report text (unless shared)</td></tr>
              <tr><td>A nullifier that blocks resubmission</td><td>The identity secret</td></tr>
              <tr><td>The member-list root used</td><td>The Merkle path (which leaf)</td></tr>
            </tbody>
          </table>
          <Callout className="mt-5" title="Anonymity grows with group size.">
            With 8 members, a verified report could have come from any of the 8. Groups of one or two members offer no real anonymity.
          </Callout>
        </Section>
      </div>
    </>
  );
}

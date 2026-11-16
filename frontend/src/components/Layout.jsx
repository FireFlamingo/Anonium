import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { CHAIN, DEPLOYMENT } from "../lib/config";
import WalletButton from "./WalletButton";

const NAV = [
  { to: "/", label: "Overview", end: true },
  { to: "/admin", label: "Organisations" },
  { to: "/identity", label: "My identity" },
  { to: "/report", label: "Submit report" },
  { to: "/verify", label: "Verify" },
];

function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || "");
  const isDark = theme ? theme === "dark" : window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const toggle = () => {
    const next = isDark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("zkwb.theme", next); } catch {}
    setTheme(next);
  };
  return (
    <button className="btn btn-ghost btn-sm" onClick={toggle} aria-label={`Switch to ${isDark ? "light" : "dark"} theme`} title="Toggle theme">
      {isDark ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
      )}
    </button>
  );
}

export default function Layout() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  return (
    <>
      <div className="topbar">
        <div className="wrap topbar-inner">
          <Link to="/" className="brand">
            <img src="/favicon.svg" className="brand-mark" alt="" />
            <span>
              <span className="brand-name">Anonium</span>
              <span className="brand-sub">Anonymous Whistleblower</span>
            </span>
          </Link>
          <nav className="nav hidden md:flex">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}>{n.label}</NavLink>
            ))}
          </nav>
          <div className="topbar-right">
            <span className="chip muted hidden sm:inline-flex" title={`Chain ID ${CHAIN.id}`}>
              <span className="dot" style={{ color: DEPLOYMENT ? "var(--ok)" : "var(--risk)" }} />
              {CHAIN.name}
            </span>
            <ThemeToggle />
            <WalletButton />
          </div>
        </div>
        <nav className="nav md:hidden wrap pb-2">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}>{n.label}</NavLink>
          ))}
        </nav>
      </div>

      <main className="wrap pb-10">
        {!DEPLOYMENT ? (
          <div className="mt-10 callout risk">
            <p>
              <strong>No contracts deployed for chain {CHAIN.id}.</strong> Run{" "}
              <code className="inline">npm run deploy:local</code> in <code className="inline">contracts/</code> (or set{" "}
              <code className="inline">VITE_CHAIN_ID</code> to a chain listed in <code className="inline">deployments/deployments.json</code>).
            </p>
          </div>
        ) : (
          <Outlet />
        )}
        <footer className="foot">
          <div className="flex flex-wrap justify-between gap-4">
            <span>
              Anonymous insider verification with Semaphore v4 zero-knowledge proofs. Report text never leaves your browser.
            </span>
            {DEPLOYMENT && (
              <span className="mono text-[12px]">
                Verifier {DEPLOYMENT.WhistleblowVerifier.slice(0, 10)}… · {CHAIN.name}
              </span>
            )}
          </div>
        </footer>
      </main>
    </>
  );
}

import { useEffect, useRef, useState } from "react";
import { useWallet } from "../context/Wallet";
import { useToast } from "../context/Toast";
import { IS_LOCAL } from "../lib/config";
import { short } from "../lib/format";
import { describeError } from "../lib/chain";

export default function WalletButton() {
  const w = useWallet();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const run = (fn) => async () => {
    setOpen(false);
    try { await fn(); } catch (e) { toast(describeError(e), "risk"); }
  };

  if (w.account && w.wrongNetwork) {
    return <button className="btn btn-danger btn-sm" onClick={run(w.switchNetwork)}>Switch network</button>;
  }

  return (
    <div className="relative" ref={ref}>
      {w.account ? (
        <button className="btn btn-secondary btn-sm" onClick={() => setOpen((o) => !o)}>
          <span className="dot" style={{ color: "var(--ok)" }} />
          <span className="mono">{short(w.account)}</span>
          {w.mode === "dev" && <span className="chip todo !py-0">dev</span>}
        </button>
      ) : (
        <button className="btn btn-primary btn-sm" onClick={() => setOpen((o) => !o)} disabled={w.connecting}>
          {w.connecting ? "Connecting…" : (
            <>
              <span className="hidden sm:inline">Connect admin wallet</span>
              <span className="sm:hidden">Connect</span>
            </>
          )}
        </button>
      )}

      {open && (
        <div className="card absolute right-0 mt-2 w-[290px] z-30 p-2 shadow-lg">
          {w.account ? (
            <>
              <div className="px-3 py-2">
                <div className="eyebrow !mb-1">{w.mode === "dev" ? `Hardhat account #${w.devIndex}` : "Browser wallet"}</div>
                <div className="hash">{w.account}</div>
              </div>
              <button className="btn btn-ghost w-full !justify-start" onClick={run(w.disconnect)}>Disconnect</button>
            </>
          ) : (
            <>
              <p className="text-[13px] muted px-3 pt-2 pb-1 m-0">
                Only organisation admins need a wallet. Whistleblowers submit through the anonymous relayer.
              </p>
              <button className="btn btn-ghost w-full !justify-start" onClick={run(w.connectInjected)} disabled={!w.hasInjected}>
                {w.hasInjected ? "MetaMask / browser wallet" : "MetaMask not detected"}
              </button>
              {IS_LOCAL && (
                <>
                  <div className="divider !my-1" />
                  <div className="eyebrow px-3 pt-2 !mb-1">Local demo accounts</div>
                  {[0, 1, 2].map((i) => (
                    <button key={i} className="btn btn-ghost w-full !justify-start" onClick={run(() => w.connectDev(i))}>
                      Hardhat account #{i}{i === 0 ? " (demo org admin)" : ""}
                    </button>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

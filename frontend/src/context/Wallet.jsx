import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { BrowserProvider, JsonRpcProvider, toBeHex } from "ethers";
import { CHAIN, IS_LOCAL } from "../lib/config";

const WalletCtx = createContext(null);
const MODE_KEY = "zkwb.walletMode";

/**
 * Admin wallet. Two modes:
 *  - "metamask": any injected EIP-1193 wallet (required on Sepolia)
 *  - "dev": an unlocked Hardhat node account (local demo only, no extension needed)
 * Whistleblowers never connect a wallet. Their reports go through the relayer.
 */
export function WalletProvider({ children }) {
  const [mode, setMode] = useState(null);
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [signer, setSigner] = useState(null);
  const [devIndex, setDevIndex] = useState(0);
  const [connecting, setConnecting] = useState(false);

  const hasInjected = typeof window !== "undefined" && !!window.ethereum;

  const connectInjected = useCallback(async () => {
    if (!window.ethereum) throw new Error("No browser wallet found. Install MetaMask.");
    setConnecting(true);
    try {
      const provider = new BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const s = await provider.getSigner();
      const net = await provider.getNetwork();
      setSigner(s);
      setAccount(await s.getAddress());
      setChainId(Number(net.chainId));
      setMode("metamask");
      localStorage.setItem(MODE_KEY, "metamask");
    } finally {
      setConnecting(false);
    }
  }, []);

  const connectDev = useCallback(async (index = 0) => {
    if (!IS_LOCAL) throw new Error("Dev accounts are only available on the local chain.");
    setConnecting(true);
    try {
      const provider = new JsonRpcProvider(CHAIN.rpc, CHAIN.id, { staticNetwork: true });
      const s = await provider.getSigner(index);
      setSigner(s);
      setAccount(await s.getAddress());
      setChainId(CHAIN.id);
      setDevIndex(index);
      setMode("dev");
      localStorage.setItem(MODE_KEY, `dev:${index}`);
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setMode(null);
    setAccount(null);
    setSigner(null);
    setChainId(null);
    localStorage.removeItem(MODE_KEY);
  }, []);

  const switchNetwork = useCallback(async () => {
    const hex = toBeHex(CHAIN.id);
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    } catch (e) {
      if (e.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{ chainId: hex, chainName: CHAIN.name, rpcUrls: [CHAIN.rpc], nativeCurrency: { name: CHAIN.currency, symbol: "ETH", decimals: 18 } }],
        });
      } else throw e;
    }
  }, []);

  // Restore the previous session silently.
  useEffect(() => {
    let saved = null;
    try { saved = localStorage.getItem(MODE_KEY); } catch {}
    if (saved?.startsWith("dev:") && IS_LOCAL) connectDev(Number(saved.split(":")[1])).catch(() => {});
    else if (saved === "metamask" && window.ethereum) {
      window.ethereum.request({ method: "eth_accounts" }).then((accs) => accs.length && connectInjected()).catch(() => {});
    }
  }, [connectDev, connectInjected]);

  // React to MetaMask account / network changes.
  useEffect(() => {
    if (!window.ethereum || mode !== "metamask") return;
    const onAccounts = (accs) => (accs.length ? connectInjected() : disconnect());
    const onChain = () => connectInjected();
    window.ethereum.on?.("accountsChanged", onAccounts);
    window.ethereum.on?.("chainChanged", onChain);
    return () => {
      window.ethereum.removeListener?.("accountsChanged", onAccounts);
      window.ethereum.removeListener?.("chainChanged", onChain);
    };
  }, [mode, connectInjected, disconnect]);

  const value = useMemo(
    () => ({
      mode, account, signer, chainId, devIndex, connecting, hasInjected,
      wrongNetwork: !!account && chainId !== CHAIN.id,
      connectInjected, connectDev, disconnect, switchNetwork,
    }),
    [mode, account, signer, chainId, devIndex, connecting, hasInjected, connectInjected, connectDev, disconnect, switchNetwork]
  );

  return <WalletCtx.Provider value={value}>{children}</WalletCtx.Provider>;
}

export const useWallet = () => useContext(WalletCtx);

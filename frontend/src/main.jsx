import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./index.css";
import Layout from "./components/Layout";
import { WalletProvider } from "./context/Wallet";
import { ToastProvider } from "./context/Toast";
import Home from "./pages/Home";
import Admin from "./pages/Admin";
import IdentityPage from "./pages/Identity";
import Report from "./pages/Report";
import Verify from "./pages/Verify";
import NotFound from "./pages/NotFound";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <WalletProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="admin" element={<Admin />} />
              <Route path="identity" element={<IdentityPage />} />
              <Route path="report" element={<Report />} />
              <Route path="verify" element={<Verify />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </WalletProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>
);

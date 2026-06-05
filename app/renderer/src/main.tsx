import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { initTheme } from "./stores/theme-store";
import "./index.css";

// Apply stored theme before first paint to avoid flash
initTheme();

// React StrictMode double-mount in dev can cause harmless duplicate-key warnings
const origWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  if (String(args[0]).includes("Encountered two children with the same key")) return;
  origWarn(...args);
};


ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { initTheme } from "./stores/theme-store";
import "./index.css";

// Apply stored theme before first paint to avoid flash
initTheme();


ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

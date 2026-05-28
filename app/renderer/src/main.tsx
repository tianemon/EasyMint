import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { electronAPIMock } from "./mock-ipc";
import "./index.css";

if (!window.electronAPI) {
  (window as unknown as Record<string, unknown>).electronAPI = electronAPIMock;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

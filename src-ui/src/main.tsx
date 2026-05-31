import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __SONAR_ROOT__?: ReturnType<typeof createRoot>;
  }
}

const container = document.getElementById("root")!;
const root = window.__SONAR_ROOT__ ?? createRoot(container);
window.__SONAR_ROOT__ = root;

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

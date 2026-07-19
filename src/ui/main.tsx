import "@logseq/libs";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./App.css";

const CLOCK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

function main() {
  logseq.App.registerUIItem("toolbar", {
    key: "logseq-time-log",
    template: `
      <a class="button" data-on-click="show" data-rect title="Time Log">
        ${CLOCK_ICON}
      </a>
    `,
  });

  logseq.provideModel({
    show() {
      logseq.showMainUI();
    },
  });

  const root = document.getElementById("root");
  if (root) {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>
    );
  }
}

logseq.ready(main).catch(console.error);

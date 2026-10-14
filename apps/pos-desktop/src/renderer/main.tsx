import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./App.js";
import { ConfirmProvider } from "./components/ConfirmDialog.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import "./styles.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root element missing from index.html");

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ConfirmProvider>
        <App />
      </ConfirmProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

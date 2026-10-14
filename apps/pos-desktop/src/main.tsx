import React from "react";
import ReactDOM from "react-dom/client";

import { ConfirmProvider } from "@/context/ConfirmContext/index.js";

import { App } from "./App.js";
import { ErrorBoundary } from "./components/ErrorBoundary/ErrorBoundary.js";
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

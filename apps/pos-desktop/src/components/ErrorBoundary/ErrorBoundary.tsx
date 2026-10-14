import { Component, type ErrorInfo, type ReactNode } from "react";

import { errorsService } from "@/services/errorsService.js";

import { Icon } from "../Icon/index.js";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  errorId: string | null;
}

/**
 * Catches a render-time throw anywhere below it so one broken screen doesn't blank the whole
 * counter. Reported through the same errors:reportRenderer channel the main process logs to
 * error_logs, so the reference id shown here is one a manager can look up in Settings' activity
 * log. Per Rule "AI/hardware/background failures must never stop billing": this only ever
 * replaces the crashed subtree, never the app shell (nav rail, offline banner) around it.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { errorId: null };

  static getDerivedStateFromError(): ErrorBoundaryState {
    // Real id filled in by componentDidCatch once reporting resolves; shown as "…" until then.
    return { errorId: "…" };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? (error.stack ?? null) : null;
    errorsService
      .report({ message, stack, componentStack: info.componentStack ?? null, context: "ErrorBoundary" })
      .then((result) => this.setState({ errorId: result.errorId ?? "unknown" }))
      .catch(() => this.setState({ errorId: "unknown" }));
  }

  override render(): ReactNode {
    if (this.state.errorId === null) return this.props.children;
    return (
      <div className="error-page">
        <div className="blueprint error-card">
          <Icon name="alert" size={48} />
          <h2>This screen hit a problem</h2>
          <p className="note">
            Reference: <code>{this.state.errorId}</code>. Any bill in progress was saved automatically and can be
            restored from Billing after reloading.
          </p>
          <button className="btn primary-btn" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}

import { useEffect } from "react";

import { errorsService } from "@/services/errorsService.js";
import { useCrashNoticeStore } from "@/store/crashNoticeStore.js";

/**
 * Crash recovery notice, main-process errors and the window-level error handlers. Mounted by
 * the app root, above the activation and sign-in screens: a crash can happen before anyone
 * signs in, so none of this is gated on `user`.
 */
export function useGlobalErrorReporting(): void {
  const setCrashNotice = useCrashNoticeStore((s) => s.setNotice);

  useEffect(() => {
    // Shown once, on the run right after a renderer crash or hang — the crash itself may have
    // happened before anyone signed in, so this isn't gated on `user`.
    errorsService
      .takeLastCrash()
      .then((crash) => {
        if (crash) setCrashNotice(`Recovered from an earlier crash (ref: ${crash.errorId}).`);
      })
      .catch(() => undefined);
  }, [setCrashNotice]);

  useEffect(() => {
    // Main-process errors outside any screen action (a background job, a bad migration) —
    // reported as they happen, not just at startup.
    return errorsService.onMainError((errorId) => setCrashNotice(`Something went wrong (ref: ${errorId}).`));
  }, [setCrashNotice]);

  useEffect(() => {
    // Catches what an error boundary can't: a throw or rejection outside React's render (an
    // event handler or timer callback the screen didn't already wrap in .catch).
    const onError = (event: ErrorEvent): void => {
      void errorsService.report({
        message: event.message,
        stack: event.error instanceof Error ? (event.error.stack ?? null) : null,
        componentStack: null,
        context: "window.onerror",
      });
    };
    const onRejection = (event: PromiseRejectionEvent): void => {
      const reason: unknown = event.reason;
      void errorsService.report({
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? (reason.stack ?? null) : null,
        componentStack: null,
        context: "unhandledrejection",
      });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
}

import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { resolveNavShortcut } from "@pos/business-logic";

import { useSessionStore } from "@/store/sessionStore.js";

import { useActivationStatus } from "./useActivationStatus.js";
import { visibleRoutes } from "./routeAccess.js";
import { APP_ROUTES, routePath } from "./routeConfig.js";
import type { RouteId } from "./routeConfig.js";

/**
 * Ctrl+<letter> jumps straight to a main section from anywhere — see navShortcuts.ts for why
 * Ctrl and not Shift, and why this is safe to leave live while a text field has focus. The
 * allowed set comes from the same access rule as the nav rail, and the listener only exists
 * while the signed-in shell is mounted, so the keys do nothing on the login screen.
 */
export function useNavShortcuts(): void {
  const navigate = useNavigate();
  const activationStatus = useActivationStatus();
  const userRole = useSessionStore((s) => s.user?.role ?? null);
  const allowed = useMemo(
    () => new Set<string>(visibleRoutes(APP_ROUTES, { activationStatus, userRole }).map((r) => r.id)),
    [activationStatus, userRole],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      // Any open modal (role="dialog") owns the keyboard — switching screens out from under
      // a payment or approval window would be a confusing way to lose track of it.
      const blocked = document.querySelector('[role="dialog"]') !== null;
      const next = resolveNavShortcut(event, allowed, blocked);
      if (next) {
        event.preventDefault();
        navigate(routePath(next as RouteId));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [allowed, navigate]);
}

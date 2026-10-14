import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { useSessionStore } from "@/store/sessionStore.js";

import { canAccessRoute } from "./routeAccess.js";
import { PATH_ACTIVATE, PATH_HOME, PATH_LOGIN } from "./routeConfig.js";
import type { AppRoute } from "./routeConfig.js";
import { useActivationStatus } from "./useActivationStatus.js";

interface RouteGuardProps {
  /** The route being opened; omit it to guard only activation and sign-in (the shell itself). */
  route?: Pick<AppRoute, "roles">;
  children: ReactNode;
}

/** Condition-based guard: activation first, then sign-in, then the route's roles. */
export function RouteGuard({ route = {}, children }: RouteGuardProps): JSX.Element {
  const activationStatus = useActivationStatus();
  const userRole = useSessionStore((s) => s.user?.role ?? null);

  switch (canAccessRoute(route, { activationStatus, userRole })) {
    case "needsActivation":
      return <Navigate to={PATH_ACTIVATE} replace />;
    case "needsLogin":
      return <Navigate to={PATH_LOGIN} replace />;
    case "forbidden":
      // The dashboard has no role list, so this can never bounce in a loop.
      return <Navigate to={PATH_HOME} replace />;
    case "ok":
      return <>{children}</>;
  }
}

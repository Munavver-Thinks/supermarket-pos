import type { ActivationStatus, UserRole } from "@pos/types";

import type { AppRoute } from "./routeConfig.js";

type AccessResult = "ok" | "needsActivation" | "needsLogin" | "forbidden";

interface AccessContext {
  activationStatus: ActivationStatus;
  userRole: UserRole | null;
}

/**
 * The single rule for who may open what, checked in the order the app has always applied it:
 * an unactivated device first, then sign-in, then the route's role list. "not_activated_legacy"
 * and "developer" are never gated (see ActivationScreen). The nav rail, the route guard and the
 * Ctrl+letter shortcuts all call this, so a shortcut can never reach a screen the rail hides.
 */
export function canAccessRoute(route: Pick<AppRoute, "roles">, ctx: AccessContext): AccessResult {
  if (ctx.activationStatus === "unactivated") return "needsActivation";
  if (ctx.userRole === null) return "needsLogin";
  if (route.roles && !route.roles.includes(ctx.userRole)) return "forbidden";
  return "ok";
}

export function visibleRoutes(routes: readonly AppRoute[], ctx: AccessContext): AppRoute[] {
  return routes.filter((route) => canAccessRoute(route, ctx) === "ok");
}

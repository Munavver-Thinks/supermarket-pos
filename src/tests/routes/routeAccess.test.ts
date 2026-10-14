import type { UserRole } from "@pos/types";
import { describe, expect, it } from "vitest";

import { canAccessRoute, visibleRoutes } from "@/routes/routeAccess.js";
import { APP_ROUTES } from "@/routes/routeConfig.js";

const ROLES: UserRole[] = ["owner", "manager", "cashier", "inventory_staff"];

function route(id: string) {
  const found = APP_ROUTES.find((r) => r.id === id);
  if (!found) throw new Error(id);
  return found;
}

describe("canAccessRoute", () => {
  it("sends an unactivated device to activation before anything else", () => {
    expect(canAccessRoute(route("dashboard"), { activationStatus: "unactivated", userRole: "owner" })).toBe("needsActivation");
    expect(canAccessRoute(route("dashboard"), { activationStatus: "unactivated", userRole: null })).toBe("needsActivation");
  });

  it("never gates activated, legacy or developer installs", () => {
    for (const activationStatus of ["activated", "not_activated_legacy", "developer"] as const) {
      expect(canAccessRoute(route("dashboard"), { activationStatus, userRole: "cashier" })).toBe("ok");
    }
  });

  it("asks for sign-in when activated but nobody is signed in", () => {
    expect(canAccessRoute(route("billing"), { activationStatus: "activated", userRole: null })).toBe("needsLogin");
  });

  it("applies each route's role list", () => {
    const ctx = (userRole: UserRole) => ({ activationStatus: "activated" as const, userRole });
    expect(canAccessRoute(route("reports"), ctx("cashier"))).toBe("forbidden");
    expect(canAccessRoute(route("reports"), ctx("manager"))).toBe("ok");
    expect(canAccessRoute(route("employees"), ctx("inventory_staff"))).toBe("forbidden");
    expect(canAccessRoute(route("inventory"), ctx("inventory_staff"))).toBe("ok");
    expect(canAccessRoute(route("mobile"), ctx("manager"))).toBe("forbidden");
    expect(canAccessRoute(route("mobile"), ctx("owner"))).toBe("ok");
  });
});

describe("route table", () => {
  it("keeps the role lists the nav rail has always used", () => {
    const ids = (role: UserRole) =>
      visibleRoutes(APP_ROUTES, { activationStatus: "activated", userRole: role }).map((r) => r.id);
    expect(ids("cashier")).toEqual(["dashboard", "billing", "sales", "customers", "returns", "notifications", "settings", "help"]);
    expect(ids("owner")).toHaveLength(APP_ROUTES.length);
    for (const role of ROLES) expect(ids(role)).toContain("dashboard");
  });

  it("has unique ids and paths", () => {
    expect(new Set(APP_ROUTES.map((r) => r.id)).size).toBe(APP_ROUTES.length);
    expect(new Set(APP_ROUTES.map((r) => r.path)).size).toBe(APP_ROUTES.length);
  });
});

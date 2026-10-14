import type { UiStringKey } from "@pos/business-logic";
import type { UserRole } from "@pos/types";

export type RouteId =
  | "dashboard"
  | "billing"
  | "inventory"
  | "sales"
  | "customers"
  | "purchases"
  | "suppliers"
  | "returns"
  | "reports"
  | "employees"
  | "ai"
  | "notifications"
  | "mobile"
  | "settings"
  | "help";

export interface AppRoute {
  /** Doubles as the screen id the Ctrl+letter shortcuts are bound to (navShortcuts.ts). */
  id: RouteId;
  path: string;
  labelKey: UiStringKey;
  titleKey: UiStringKey;
  /** Roles allowed to open it; absent means every signed-in role. */
  roles?: UserRole[];
}

const MANAGEMENT: UserRole[] = ["owner", "manager"];
const STOCK_ROLES: UserRole[] = ["owner", "manager", "inventory_staff"];

/** The one route table: the nav rail, the page titles, the guards and the shortcuts all read it. */
export const APP_ROUTES: readonly AppRoute[] = [
  { id: "dashboard", path: "/dashboard", labelKey: "nav.dashboard", titleKey: "title.dashboard" },
  { id: "billing", path: "/billing", labelKey: "nav.billing", titleKey: "title.billing" },
  { id: "inventory", path: "/inventory", labelKey: "nav.inventory", titleKey: "title.inventory", roles: STOCK_ROLES },
  { id: "sales", path: "/sales", labelKey: "nav.sales", titleKey: "title.sales" },
  { id: "customers", path: "/customers", labelKey: "nav.customers", titleKey: "title.customers" },
  { id: "purchases", path: "/purchases", labelKey: "nav.purchases", titleKey: "title.purchases", roles: STOCK_ROLES },
  { id: "suppliers", path: "/suppliers", labelKey: "nav.suppliers", titleKey: "title.suppliers", roles: STOCK_ROLES },
  { id: "returns", path: "/returns", labelKey: "nav.returns", titleKey: "title.returns" },
  { id: "reports", path: "/reports", labelKey: "nav.reports", titleKey: "title.reports", roles: MANAGEMENT },
  { id: "employees", path: "/employees", labelKey: "nav.employees", titleKey: "title.employees", roles: MANAGEMENT },
  { id: "ai", path: "/ai", labelKey: "nav.ai", titleKey: "title.ai", roles: MANAGEMENT },
  { id: "notifications", path: "/notifications", labelKey: "nav.notifications", titleKey: "title.notifications" },
  { id: "mobile", path: "/mobile", labelKey: "nav.mobile", titleKey: "title.mobile", roles: ["owner"] },
  { id: "settings", path: "/settings", labelKey: "nav.settings", titleKey: "title.settings" },
  { id: "help", path: "/help", labelKey: "nav.help", titleKey: "title.help" },
];

export const PATH_ACTIVATE = "/activate";
export const PATH_LOGIN = "/login";
export const PATH_HOME = "/dashboard";

export function routePath(id: RouteId): string {
  const route = APP_ROUTES.find((r) => r.id === id);
  if (!route) throw new Error(`Unknown route: ${id}`);
  return route.path;
}

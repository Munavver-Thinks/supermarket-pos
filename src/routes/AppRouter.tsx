import type { ComponentType } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";

import { ActivationScreen } from "@/main-menus/auth/index.js";
import { LoginScreen } from "@/main-menus/auth/index.js";
import {
  AiPage,
  BillingPage,
  CustomersPage,
  DashboardPage,
  EmployeesPage,
  HelpPage,
  InventoryPage,
  MobilePage,
  NotificationsPage,
  PurchasesPage,
  ReportsPage,
  ReturnsPage,
  SalesPage,
  SettingsPage,
  SuppliersPage,
} from "@/pages/index.js";
import { useSessionStore } from "@/store/sessionStore.js";

import { AppLayout } from "./AppLayout.js";
import { APP_ROUTES, PATH_ACTIVATE, PATH_HOME, PATH_LOGIN } from "./routeConfig.js";
import type { RouteId } from "./routeConfig.js";
import { RouteGuard } from "./RouteGuard.js";
import { useActivationStatus } from "./useActivationStatus.js";

const PAGE_BY_ROUTE: Record<RouteId, ComponentType> = {
  dashboard: DashboardPage,
  billing: BillingPage,
  inventory: InventoryPage,
  sales: SalesPage,
  customers: CustomersPage,
  purchases: PurchasesPage,
  suppliers: SuppliersPage,
  returns: ReturnsPage,
  reports: ReportsPage,
  employees: EmployeesPage,
  ai: AiPage,
  notifications: NotificationsPage,
  mobile: MobilePage,
  settings: SettingsPage,
  help: HelpPage,
};

/** Shown instead of the login screen while this device is unactivated (status "unactivated" only). */
function ActivationRoute(): JSX.Element {
  const activation = useSessionStore((s) => s.activationOverride ?? s.context?.activation ?? null);
  const setActivationOverride = useSessionStore((s) => s.setActivationOverride);
  if (!activation || activation.status !== "unactivated") return <Navigate to={PATH_LOGIN} replace />;
  return <ActivationScreen activation={activation} onActivated={setActivationOverride} />;
}

function LoginRoute(): JSX.Element {
  const activationStatus = useActivationStatus();
  const user = useSessionStore((s) => s.user);
  if (activationStatus === "unactivated") return <Navigate to={PATH_ACTIVATE} replace />;
  // Every sign-in lands on the dashboard, whatever the previous user had open.
  if (user) return <Navigate to={PATH_HOME} replace />;
  return <LoginScreen />;
}

export function AppRouter(): JSX.Element {
  const context = useSessionStore((s) => s.context);

  if (!context) {
    return <div style={{ padding: 24 }}>Starting up...</div>;
  }

  return (
    <HashRouter>
      <Routes>
        <Route path={PATH_ACTIVATE} element={<ActivationRoute />} />
        <Route path={PATH_LOGIN} element={<LoginRoute />} />
        <Route
          element={
            <RouteGuard>
              <AppLayout />
            </RouteGuard>
          }
        >
          <Route index element={<Navigate to={PATH_HOME} replace />} />
          {APP_ROUTES.map((route) => {
            const Page = PAGE_BY_ROUTE[route.id];
            return (
              <Route
                key={route.id}
                path={route.path}
                element={
                  <RouteGuard route={route}>
                    <Page />
                  </RouteGuard>
                }
              />
            );
          })}
        </Route>
        <Route path="*" element={<Navigate to={PATH_HOME} replace />} />
      </Routes>
    </HashRouter>
  );
}

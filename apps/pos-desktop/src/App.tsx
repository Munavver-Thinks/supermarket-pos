import { useEffect, useState } from "react";
import { navShortcutLabel, resolveNavShortcut } from "@pos/business-logic";
import type { UiStringKey } from "@pos/business-logic";
import type { ActivationInfo, UserRole } from "@pos/types";

import { errorsService } from "@/services/errorsService.js";
import { sessionService } from "@/services/sessionService.js";

import { ComingSoonScreen } from "./components/ComingSoonScreen.js";
import { Icon, LogoMark } from "./components/icons.js";
import { AlertsBanner } from "./features/alerts/AlertsBanner.js";
import { AlertsNavBadge } from "./features/alerts/AlertsNavBadge.js";
import { AlertsScreen } from "./features/alerts/AlertsScreen.js";
import { ActivationScreen } from "./features/auth/ActivationScreen.js";
import { LoginScreen } from "./features/auth/LoginScreen.js";
import { BillingScreen } from "./features/billing/BillingScreen.js";
import { CustomersScreen } from "./features/customers/CustomersScreen.js";
import { DashboardScreen } from "./features/dashboard/DashboardScreen.js";
import { EmployeesScreen } from "./features/employees/EmployeesScreen.js";
import { InventoryScreen } from "./features/inventory/InventoryScreen.js";
import { PurchasesScreen } from "./features/purchases/PurchasesScreen.js";
import { ReportsScreen } from "./features/reports/ReportsScreen.js";
import { ReturnsScreen } from "./features/returns/ReturnsScreen.js";
import { SalesScreen } from "./features/sales/SalesScreen.js";
import { AppearanceDialog } from "./features/settings/AppearanceDialog.js";
import { SettingsScreen } from "./features/settings/SettingsScreen.js";
import { ThemeQuickSwitch } from "./features/settings/ThemeQuickSwitch.js";
import { SuppliersScreen } from "./features/suppliers/SuppliersScreen.js";
import { useLoadUiLanguage, useT, useUiLanguageStore } from "./i18n/useT.js";
import { useSessionStore } from "./store/sessionStore.js";
import { useApplyTheme } from "./theme/useTheme.js";

type Screen =
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

interface NavItem {
  screen: Screen;
  labelKey: UiStringKey;
  roles?: UserRole[];
}

const NAV_ITEMS: NavItem[] = [
  { screen: "dashboard", labelKey: "nav.dashboard" },
  { screen: "billing", labelKey: "nav.billing" },
  { screen: "inventory", labelKey: "nav.inventory", roles: ["owner", "manager", "inventory_staff"] },
  { screen: "sales", labelKey: "nav.sales" },
  { screen: "customers", labelKey: "nav.customers" },
  { screen: "purchases", labelKey: "nav.purchases", roles: ["owner", "manager", "inventory_staff"] },
  { screen: "suppliers", labelKey: "nav.suppliers", roles: ["owner", "manager", "inventory_staff"] },
  { screen: "returns", labelKey: "nav.returns" },
  { screen: "reports", labelKey: "nav.reports", roles: ["owner", "manager"] },
  { screen: "employees", labelKey: "nav.employees", roles: ["owner", "manager"] },
  { screen: "ai", labelKey: "nav.ai", roles: ["owner", "manager"] },
  { screen: "notifications", labelKey: "nav.notifications" },
  { screen: "mobile", labelKey: "nav.mobile", roles: ["owner"] },
  { screen: "settings", labelKey: "nav.settings" },
  { screen: "help", labelKey: "nav.help" },
];

const SCREEN_TITLE: Record<Screen, UiStringKey> = {
  dashboard: "title.dashboard",
  billing: "title.billing",
  inventory: "title.inventory",
  sales: "title.sales",
  customers: "title.customers",
  purchases: "title.purchases",
  suppliers: "title.suppliers",
  returns: "title.returns",
  reports: "title.reports",
  employees: "title.employees",
  ai: "title.ai",
  notifications: "title.notifications",
  mobile: "title.mobile",
  settings: "title.settings",
  help: "title.help",
};

export function App(): JSX.Element {
  const user = useSessionStore((s) => s.user);
  const setUser = useSessionStore((s) => s.setUser);
  const context = useSessionStore((s) => s.context);
  const setContext = useSessionStore((s) => s.setContext);
  const isOnline = useSessionStore((s) => s.isOnline);
  const setOnline = useSessionStore((s) => s.setOnline);
  const usingDefaultPassword = useSessionStore((s) => s.usingDefaultPassword);
  const t = useT();
  const language = useUiLanguageStore((s) => s.language);
  const setLanguage = useUiLanguageStore((s) => s.setLanguage);
  useLoadUiLanguage();
  useApplyTheme(user?.id ?? null);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [crashNotice, setCrashNotice] = useState<string | null>(null);
  // Overrides context.activation the moment ActivationScreen succeeds, so the gate drops
  // immediately without waiting on another round trip to session:getContext.
  const [activationOverride, setActivationOverride] = useState<ActivationInfo | null>(null);

  // Computed before any hook that needs it, and before the early returns below — a plain
  // derived value, not a hook itself, so it's fine this early regardless.
  const visibleNavItems = NAV_ITEMS.filter((item) => !item.roles || (user ? item.roles.includes(user.role) : false));

  useEffect(() => {
    sessionService.getContext().then(setContext).catch(() => undefined);
  }, [setContext]);

  useEffect(() => {
    // Ctrl+<letter> jumps straight to a main section from anywhere — see navShortcuts.ts for
    // why Ctrl and not Shift, and why this is safe to leave live while a text field has focus.
    const allowed = new Set(visibleNavItems.map((item) => item.screen));
    function onKeyDown(event: KeyboardEvent): void {
      // Any open modal (role="dialog") owns the keyboard — switching screens out from under
      // a payment or approval window would be a confusing way to lose track of it.
      const blocked = document.querySelector('[role="dialog"]') !== null;
      const next = resolveNavShortcut(event, allowed, blocked);
      if (next) {
        event.preventDefault();
        setScreen(next as Screen);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visibleNavItems]);

  useEffect(() => {
    // Shown once, on the run right after a renderer crash or hang — the crash itself may have
    // happened before anyone signed in, so this isn't gated on `user`.
    errorsService
      .takeLastCrash()
      .then((crash) => {
        if (crash) setCrashNotice(`Recovered from an earlier crash (ref: ${crash.errorId}).`);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    // Main-process errors outside any screen action (a background job, a bad migration) —
    // reported as they happen, not just at startup.
    return errorsService.onMainError((errorId) => setCrashNotice(`Something went wrong (ref: ${errorId}).`));
  }, []);

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

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [setOnline]);

  if (!context) {
    return <div style={{ padding: 24 }}>Starting up...</div>;
  }

  const activation = activationOverride ?? context.activation;

  // "not_activated_legacy" and "developer" are never gated — see ActivationScreen's comment.
  if (activation.status === "unactivated") {
    return <ActivationScreen activation={activation} onActivated={setActivationOverride} />;
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <div className="app-shell">
      <nav className={"rail" + (railCollapsed ? " collapsed" : "")}>
        <div className="rail-head">
          <button
            type="button"
            className="rail-toggle"
            aria-label={railCollapsed ? "Expand menu" : "Collapse menu"}
            onClick={() => setRailCollapsed((c) => !c)}
          >
            <LogoMark />
          </button>
          {!railCollapsed && <div className="rail-title">Supermarket POS</div>}
        </div>
        <div className="rail-items">
          {visibleNavItems.map((item) => {
            const shortcut = navShortcutLabel(item.screen);
            return (
              <button
                key={item.screen}
                className={"rail-item" + (screen === item.screen ? " active" : "")}
                title={shortcut ? `${t(item.labelKey)} (${shortcut})` : t(item.labelKey)}
                onClick={() => setScreen(item.screen)}
              >
                <Icon name={item.screen} />
                {!railCollapsed && (
                  <>
                    <span className="rail-label">{t(item.labelKey)}</span>
                    {shortcut && <span className="rail-shortcut">{shortcut}</span>}
                  </>
                )}
                {item.screen === "notifications" && <AlertsNavBadge />}
              </button>
            );
          })}
        </div>
        <div className="rail-foot">
          <div className="rail-avatar">
            {user.displayName
              .split(" ")
              .map((p) => p[0])
              .slice(0, 2)
              .join("")}
          </div>
          {!railCollapsed && (
            <>
              <div className="rail-user">
                <div className="rail-user-name">{user.displayName}</div>
                <button type="button" className="rail-signout" onClick={() => setUser(null)}>
                  {user.role} · {t("shell.signOut")}
                </button>
              </div>
              <ThemeQuickSwitch onMoreOptions={() => setAppearanceOpen(true)} />
              <button
                type="button"
                className="rail-lang"
                onClick={() => void setLanguage(language === "en" ? "ta" : "en", user.id)}
                title="Screen language / திரை மொழி"
              >
                {language === "en" ? "EN | த" : "த | EN"}
              </button>
            </>
          )}
        </div>
      </nav>

      <div className="main-column">
        <header className="app-header">
          <h1>{t(SCREEN_TITLE[screen])}</h1>
        </header>

        {!isOnline && (
          <div className="status-banner offline">
            <Icon name="wifiOff" />
            <span>{t("shell.offlineBanner")}</span>
          </div>
        )}
        {crashNotice && (
          <div className="status-banner crash-banner" role="status">
            <Icon name="info" />
            <span>{crashNotice}</span>
            <button type="button" className="btn btn-ghost" onClick={() => setCrashNotice(null)}>
              Dismiss
            </button>
          </div>
        )}
        <AlertsBanner hidden={screen === "notifications"} onView={() => setScreen("notifications")} />

        {usingDefaultPassword && (
          <div className="status-banner default-password-banner">
            <Icon name="lock" />
            <span>{t("shell.defaultPasswordBanner")}</span>
            {screen !== "settings" && (
              <button className="btn btn-ghost" onClick={() => setScreen("settings")}>
                {t("shell.changePassword")}
              </button>
            )}
          </div>
        )}

        <div className="screen-body">
          {screen === "dashboard" && (
            <DashboardScreen onGoBilling={() => setScreen("billing")} onGoInventory={() => setScreen("inventory")} />
          )}
          {screen === "billing" && <BillingScreen />}
          {screen === "inventory" && <InventoryScreen />}
          {screen === "sales" && <SalesScreen />}
          {screen === "customers" && <CustomersScreen />}
          {screen === "employees" && <EmployeesScreen />}
          {screen === "purchases" && <PurchasesScreen />}
          {screen === "suppliers" && <SuppliersScreen />}
          {screen === "returns" && <ReturnsScreen />}
          {screen === "reports" && <ReportsScreen />}
          {screen === "ai" && (
            <ComingSoonScreen
              icon="ai"
              title="AI Assistant isn't built yet"
              text="Invoice scanning, stock-photo counting and purchasing recommendations are on the roadmap — nothing here is wired up yet."
            />
          )}
          {screen === "notifications" && (
            <AlertsScreen onGoInventory={() => setScreen("inventory")} onGoPurchases={() => setScreen("purchases")} />
          )}
          {screen === "mobile" && (
            <ComingSoonScreen
              icon="mobile"
              title="Owner Mobile isn't built yet"
              text="A companion mobile app for owners to check on the store remotely is on the roadmap."
            />
          )}
          {screen === "settings" && <SettingsScreen />}
          {screen === "help" && (
            <ComingSoonScreen
              icon="help"
              title="Help isn't built yet"
              text="There's no in-app help centre yet — see the project README for setup and the golden path."
            />
          )}
        </div>
      </div>
      {appearanceOpen && <AppearanceDialog onClose={() => setAppearanceOpen(false)} />}
    </div>
  );
}

import { useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { navShortcutLabel } from "@pos/business-logic";

import { Icon, LogoMark } from "@/components/Icon/index.js";
import { AlertsBanner } from "@/features/alerts/index.js";
import { AlertsNavBadge } from "@/features/alerts/index.js";
import { AppearanceDialog } from "@/features/settings/index.js";
import { ThemeQuickSwitch } from "@/features/settings/index.js";
import { useT } from "@/hooks/useT.js";
import { useCrashNoticeStore } from "@/store/crashNoticeStore.js";
import { useSessionStore } from "@/store/sessionStore.js";
import { useUiLanguageStore } from "@/store/uiLanguageStore.js";

import { visibleRoutes } from "./routeAccess.js";
import { APP_ROUTES, routePath } from "./routeConfig.js";
import { useActivationStatus } from "./useActivationStatus.js";
import { useNavShortcuts } from "./useNavShortcuts.js";

/** The signed-in shell: nav rail, page header, status banners, and the active page in an <Outlet/>. */
export function AppLayout(): JSX.Element | null {
  const user = useSessionStore((s) => s.user);
  const setUser = useSessionStore((s) => s.setUser);
  const isOnline = useSessionStore((s) => s.isOnline);
  const usingDefaultPassword = useSessionStore((s) => s.usingDefaultPassword);
  const crashNotice = useCrashNoticeStore((s) => s.notice);
  const setCrashNotice = useCrashNoticeStore((s) => s.setNotice);
  const t = useT();
  const language = useUiLanguageStore((s) => s.language);
  const setLanguage = useUiLanguageStore((s) => s.setLanguage);
  const activationStatus = useActivationStatus();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);

  useNavShortcuts();

  const userRole = user?.role ?? null;
  const navRoutes = useMemo(
    () => visibleRoutes(APP_ROUTES, { activationStatus, userRole }),
    [activationStatus, userRole],
  );
  const current = APP_ROUTES.find((r) => r.path === pathname);

  // The route guard keeps this shell from rendering signed out; this only narrows the type.
  if (!user) return null;

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
          {navRoutes.map((item) => {
            const shortcut = navShortcutLabel(item.id);
            return (
              <button
                key={item.id}
                className={"rail-item" + (pathname === item.path ? " active" : "")}
                title={shortcut ? `${t(item.labelKey)} (${shortcut})` : t(item.labelKey)}
                onClick={() => navigate(item.path)}
              >
                <Icon name={item.id} />
                {!railCollapsed && (
                  <>
                    <span className="rail-label">{t(item.labelKey)}</span>
                    {shortcut && <span className="rail-shortcut">{shortcut}</span>}
                  </>
                )}
                {item.id === "notifications" && <AlertsNavBadge />}
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
          <h1>{current ? t(current.titleKey) : ""}</h1>
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
        <AlertsBanner hidden={pathname === routePath("notifications")} onView={() => navigate(routePath("notifications"))} />

        {usingDefaultPassword && (
          <div className="status-banner default-password-banner">
            <Icon name="lock" />
            <span>{t("shell.defaultPasswordBanner")}</span>
            {pathname !== routePath("settings") && (
              <button className="btn btn-ghost" onClick={() => navigate(routePath("settings"))}>
                {t("shell.changePassword")}
              </button>
            )}
          </div>
        )}

        <div className="screen-body">
          <Outlet />
        </div>
      </div>
      {appearanceOpen && <AppearanceDialog onClose={() => setAppearanceOpen(false)} />}
    </div>
  );
}

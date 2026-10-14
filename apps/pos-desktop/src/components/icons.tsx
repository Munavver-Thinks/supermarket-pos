export type IconName =
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
  | "help"
  | "lock"
  | "bell"
  | "wifiOff"
  | "info"
  | "check"
  | "alert"
  | "printer"
  | "search"
  | "sun"
  | "moon";

/** Stroke icons on a 24x24 grid. Stroke/fill styling lives in the `.icon` CSS rule, so they follow `currentColor`. */
const ICON_PATHS: Record<IconName, JSX.Element> = {
  dashboard: <path d="M3 11l9-8 9 8M5 10v10h14V10" />,
  billing: <path d="M3 7V4h3M18 4h3v3M21 17v3h-3M6 20H3v-3M7 8v8M10 8v8M13 8v8M17 8v8" />,
  inventory: <path d="M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10" />,
  sales: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" />,
  customers: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2 20a7 7 0 0114 0M16 4a3.5 3.5 0 010 7M22 20a7 7 0 00-5-6.7" />
    </>
  ),
  purchases: (
    <>
      <path d="M3 4h2l2.5 11h11L21 7H6.5" />
      <circle cx="9" cy="19" r="1.5" />
      <circle cx="17" cy="19" r="1.5" />
    </>
  ),
  suppliers: (
    <>
      <path d="M2 6h12v10H2zM14 10h4l3 3v3h-7" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  returns: (
    <>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10a6 6 0 010 12h-3" />
    </>
  ),
  reports: <path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3" />,
  employees: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0116 0" />
    </>
  ),
  ai: <path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />,
  notifications: <path d="M6 16V11a6 6 0 0112 0v5l2 2H4zM10 20a2 2 0 004 0" />,
  mobile: (
    <>
      <rect x="6" y="2" width="12" height="20" rx="2" />
      <path d="M11 18h2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 015 .5c0 1.5-2.5 2-2.5 3.5M12 17v.5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 018 0v4" />
    </>
  ),
  bell: <path d="M6 16V11a6 6 0 0112 0v5l2 2H4zM10 20a2 2 0 004 0" />,
  wifiOff: <path d="M2 8.5a15 15 0 0120 0M5 12a10 10 0 0114 0M8.5 15.5a5 5 0 017 0M12 19h.01M3 3l18 18" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.5" />
    </>
  ),
  check: <path d="M5 12l5 5L20 7" />,
  alert: <path d="M12 3l10 18H2zM12 10v5M12 18v.5" />,
  printer: <path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M7 14h10v7H7z" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" />,
};

/** Decorative icon — always paired with a visible text label or a `title`/`aria-label` on its button. */
export function Icon({ name, size = 20 }: { name: IconName; size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="icon" aria-hidden="true">
      {ICON_PATHS[name]}
    </svg>
  );
}

/** The Basket Bill logo — a shopping basket on a green tile. */
export function LogoMark({ size = 32 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <rect width="64" height="64" rx="16" style={{ fill: "var(--brand-500)" }} />
      <path
        d="M20 26a12 12 0 0124 0"
        strokeWidth="4"
        strokeLinecap="round"
        style={{ fill: "none", stroke: "var(--on-brand)" }}
      />
      <path d="M12 26h40l-5 22a4 4 0 01-4 3H21a4 4 0 01-4-3z" style={{ fill: "var(--on-brand)" }} />
      <path
        d="M24 33v11M32 33v11M40 33v11"
        strokeWidth="3.5"
        strokeLinecap="round"
        style={{ stroke: "var(--brand-500)" }}
      />
      <circle cx="51" cy="13" r="5" style={{ fill: "var(--sun-400)" }} />
    </svg>
  );
}

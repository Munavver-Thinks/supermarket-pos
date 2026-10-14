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

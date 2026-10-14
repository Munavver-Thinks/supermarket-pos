/** `YYYY-MM-DD` in the local time zone (what a date input holds). */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function startOfLocalDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0).toISOString();
}

/** Exclusive end: the start of the day *after* the one chosen, so the last day is included. */
export function endOfLocalDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + 1, 0, 0, 0, 0).toISOString();
}

/** "14 Oct 2026, 02:30 pm" style stamp for lists and notices. */
export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

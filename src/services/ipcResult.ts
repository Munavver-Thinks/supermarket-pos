/** Narrows the `T | {ok:false}` that role-gated channels return when access is refused. */
export function isDenied<T>(value: T | { ok: false; error: string }): value is { ok: false; error: string } {
  return typeof value === "object" && value !== null && "ok" in value && (value as { ok: unknown }).ok === false;
}

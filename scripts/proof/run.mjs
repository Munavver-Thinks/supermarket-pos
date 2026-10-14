// One command, one PASS/FAIL table: pnpm proof
// Checks HEAD against the `refactor-baseline` tag (the code before the restructure) without
// anyone reading diffs: the Electron main process and the business logic must be the same code.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const shell = process.platform === "win32";
const BASE = "refactor-baseline";

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", shell, maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** path -> blob id for every file under `prefix` at `rev`. */
function blobs(rev, prefix) {
  const r = run("git", ["ls-tree", "-r", rev, "--", prefix]);
  const map = new Map();
  for (const line of r.out.split("\n")) {
    const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(line.trim());
    if (m) map.set(m[2].slice(prefix.length), m[1]);
  }
  return map;
}

/** True when every added/removed line between two blobs is a comment line. */
function commentOnlyDiff(a, b) {
  const d = run("git", ["diff", "-U0", "--no-color", a, b]);
  const changed = d.out
    .split("\n")
    .filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l))
    .map((l) => l.slice(1).trim());
  return changed.length > 0 && changed.every((l) => l === "" || /^(\/\/|\/\*|\*|\*\/)/.test(l));
}

/** Compare each baseline folder with where it lives now; comment-only edits are allowed and listed. */
function sameCode(pairs) {
  let total = 0;
  const missing = [];
  const changed = [];
  const commentOnly = [];
  for (const [from, to] of pairs) {
    const before = blobs(BASE, from);
    const after = blobs("HEAD", to);
    for (const [file, blob] of before) {
      total += 1;
      const now = after.get(file);
      if (!now) missing.push(from + file);
      else if (now !== blob) (commentOnlyDiff(blob, now) ? commentOnly : changed).push(to + file);
    }
  }
  return { total, missing, changed, commentOnly };
}

const rows = [];
const record = (name, ok, detail) => rows.push({ name, ok, detail });

const electron = sameCode([
  ["apps/pos-desktop/src/main/", "electron/main/"],
  ["apps/pos-desktop/src/preload/", "electron/preload/"],
  ["apps/pos-desktop/src/shared/", "electron/shared/"],
]);
record(
  "electron/ = baseline main process",
  electron.total > 0 && !electron.missing.length && !electron.changed.length,
  `${electron.total} files; changed ${electron.changed.length}; comment-only ${electron.commentOnly.length}; missing ${electron.missing.length}`,
);

const core = sameCode(
  ["business-logic", "database", "types", "validation"].map((p) => [`packages/${p}/src/`, `src/core/${p}/`]),
);
record(
  "src/core = baseline packages",
  core.total > 0 && !core.missing.length && !core.changed.length,
  `${core.total} files; changed ${core.changed.length}; comment-only ${core.commentOnly.length} (${core.commentOnly.map((f) => path.basename(f)).join(", ") || "-"}); missing ${core.missing.length}`,
);
for (const f of [...electron.changed, ...core.changed, ...electron.missing, ...core.missing]) record("  offending file", false, f);

const steps = [
  ["ipc inventory", "node", ["scripts/proof/ipc-inventory.mjs"]],
  [".tsx has JSX", "node", ["scripts/proof/check-extensions.mjs"]],
  ["typecheck", "pnpm", ["typecheck"]],
  ["lint", "pnpm", ["lint"]],
  ["test", "pnpm", ["test"]],
];
for (const [name, cmd, args] of steps) {
  const r = run(cmd, args);
  const last = r.out.trim().split("\n").filter((l) => l.trim()).slice(-1)[0] ?? "";
  record(name, r.ok, r.ok ? "ok" : last.slice(0, 120));
  if (!r.ok) break; // stop at the first failing gate
}

const width = Math.max(...rows.map((r) => r.name.length));
for (const r of rows) process.stdout.write(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}  ${r.detail}\n`);
process.exit(rows.every((r) => r.ok) ? 0 : 1);

// One command, one PASS/FAIL table: pnpm proof
// Checks the refactor against the `refactor-baseline` tag without anyone reading diffs.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const shell = process.platform === "win32";

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", shell });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const rows = [];
function record(name, ok, detail) {
  rows.push({ name, ok, detail });
}

// moves: electron files are untouched renames; packages/ differs only by the one path comment
{
  const status = run("git", ["diff", "-M", "--name-status", "refactor-baseline..HEAD"]);
  const electron = status.out.split("\n").filter((l) => /apps\/pos-desktop\/electron\//.test(l));
  const notRenames = electron.filter((l) => !l.startsWith("R100"));
  record("electron moves are R100", status.ok && electron.length > 0 && notRenames.length === 0, `${electron.length} files, ${notRenames.length} changed`);

  const pk = run("git", ["diff", "-M", "--numstat", "refactor-baseline..HEAD", "--", "packages"]);
  const lines = pk.out.split("\n").filter(Boolean);
  const onlyComment = lines.length === 1 && lines[0].endsWith("packages/database/src/defaultDbPath.ts") && lines[0].startsWith("1\t1\t");
  record("packages/ untouched", pk.ok && onlyComment, `${lines.length} file(s) changed`);
}

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

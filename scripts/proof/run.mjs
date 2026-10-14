// One command, one PASS/FAIL table: pnpm proof
// Checks HEAD against the `refactor-baseline` tag (the code before the restructure) without
// anyone reading diffs: the Electron main process and the business logic must be the same code,
// and every test case that existed then must still exist and pass.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const shell = process.platform === "win32";
const BASE = "refactor-baseline";
const TESTS_DIR = "src/tests/";

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

/** The added and removed lines between two blobs. */
function changedLines(a, b) {
  const d = run("git", ["diff", "-U0", "--no-color", a, b]);
  const lines = d.out.split("\n").filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
  return {
    removed: lines.filter((l) => l.startsWith("-")).map((l) => l.slice(1).trim()),
    added: lines.filter((l) => l.startsWith("+")).map((l) => l.slice(1).trim()),
  };
}

const isComment = (l) => l === "" || /^(\/\/|\/\*|\*|\*\/)/.test(l);

/** Every changed line is a comment. */
function commentOnlyDiff(a, b) {
  const { removed, added } = changedLines(a, b);
  return removed.length + added.length > 0 && [...removed, ...added].every(isComment);
}

/**
 * Only module-path strings changed (a moved test pointing at the same code from its new folder):
 * blanking every "./", "../", "@/", "@shared/", "@pos/" string leaves the same lines, and only
 * import lines (or blank lines from re-grouped imports) moved around.
 */
function pathOnlyDiff(a, b) {
  const { removed, added } = changedLines(a, b);
  const norm = (l) => l.replace(/(["'])(?:\.{1,2}\/|@\/|@shared\/|@pos\/)[^"']*\1/g, '"<path>"');
  const meaningful = (ls) => ls.filter((l) => l !== "").map(norm).sort();
  const r = meaningful(removed);
  const n = meaningful(added);
  return r.length === n.length && r.every((l, i) => l === n[i]);
}

/** Where each baseline file lives now: tests moved to src/tests/, everything else as mapped. */
function sameCode(pairs) {
  let total = 0;
  const missing = [];
  const changed = [];
  const commentOnly = [];
  const pathOnly = [];
  const now = blobs("HEAD", ""); // every tracked file at HEAD, keyed by full path
  for (const [from, to, testsTo] of pairs) {
    for (const [file, blob] of blobs(BASE, from)) {
      total += 1;
      const isTest = /\.test\.tsx?$/.test(file);
      const target = (isTest ? testsTo : to) + file;
      const current = now.get(target);
      if (!current) missing.push(target);
      else if (current === blob) continue;
      else if (!isTest && commentOnlyDiff(blob, current)) commentOnly.push(target);
      else if (isTest && pathOnlyDiff(blob, current)) pathOnly.push(target);
      else changed.push(target);
    }
  }
  return { total, missing, changed, commentOnly, pathOnly };
}

const rows = [];
const record = (name, ok, detail) => rows.push({ name, ok, detail });
const summary = (r) =>
  `${r.total} files; changed ${r.changed.length}; comment-only ${r.commentOnly.length}` +
  `${r.commentOnly.length ? ` (${r.commentOnly.map((f) => path.basename(f)).join(", ")})` : ""}; ` +
  `moved tests path-only ${r.pathOnly.length}; missing ${r.missing.length}`;

const electron = sameCode(
  ["main", "preload", "shared"].map((d) => [`apps/pos-desktop/src/${d}/`, `electron/${d}/`, `${TESTS_DIR}electron/${d}/`]),
);
record("electron/ = baseline main process", electron.total > 0 && !electron.missing.length && !electron.changed.length, summary(electron));

const core = sameCode(
  ["business-logic", "database", "types", "validation"].map((p) => [`packages/${p}/src/`, `src/core/${p}/`, `${TESTS_DIR}core/${p}/`]),
);
record("src/core = baseline packages", core.total > 0 && !core.missing.length && !core.changed.length, summary(core));
for (const f of [...electron.changed, ...core.changed, ...electron.missing, ...core.missing]) record("  offending file", false, f);

// Every test lives in src/tests/.
{
  const files = run("git", ["ls-files", "*.test.ts", "*.test.tsx"]).out.split("\n").filter(Boolean);
  const stray = files.filter((f) => !f.startsWith(TESTS_DIR));
  record("all tests in src/tests/", files.length > 0 && stray.length === 0, `${files.length} test files; outside: ${stray.join(", ") || "none"}`);
}

const steps = [
  ["ipc inventory", "node", ["scripts/proof/ipc-inventory.mjs"]],
  [".tsx has JSX", "node", ["scripts/proof/check-extensions.mjs"]],
  ["typecheck", "pnpm", ["typecheck"]],
  ["lint", "pnpm", ["lint"]],
];
let gatesOk = true;
for (const [name, cmd, args] of steps) {
  const r = run(cmd, args);
  const last = r.out.trim().split("\n").filter((l) => l.trim()).slice(-1)[0] ?? "";
  record(name, r.ok, r.ok ? "ok" : last.slice(0, 120));
  if (!r.ok) {
    gatesOk = false;
    break; // stop at the first failing gate
  }
}

// Tests: run once with a JSON report and check no baseline test case was lost or now fails.
if (gatesOk) {
  const rebuild = run("pnpm", ["rebuild:node"]);
  const report = path.join(os.tmpdir(), `pos-proof-tests-${process.pid}.json`);
  const t = rebuild.ok ? run("npx", ["vitest", "run", "--reporter=json", `--outputFile=${report}`]) : rebuild;
  let detail = "no report";
  let ok = false;
  if (fs.existsSync(report)) {
    const json = JSON.parse(fs.readFileSync(report, "utf8"));
    fs.rmSync(report, { force: true });
    const current = new Set(
      json.testResults.flatMap((f) => f.assertionResults.map((a) => `${[...a.ancestorTitles, a.title].join(" > ")} [${a.status}]`)),
    );
    const baseline = fs
      .readFileSync(path.join(root, "scripts/proof/test-names.baseline.txt"), "utf8")
      .split("\n")
      .filter(Boolean);
    const lost = baseline.filter((n) => !current.has(n));
    ok = t.ok && json.numFailedTests === 0 && lost.length === 0;
    detail = `${json.numPassedTests}/${json.numTotalTests} passed; baseline cases ${baseline.length}, lost or failing ${lost.length}${lost.length ? `: ${lost.slice(0, 3).join(" | ")}` : ""}`;
  }
  record("test (every baseline case passes)", ok, detail);
}

const width = Math.max(...rows.map((r) => r.name.length));
for (const r of rows) process.stdout.write(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}  ${r.detail}\n`);
process.exit(rows.every((r) => r.ok) ? 0 : 1);

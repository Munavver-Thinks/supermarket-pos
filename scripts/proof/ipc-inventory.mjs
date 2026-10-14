// Lists every IPC channel the renderer calls, as a sorted set of "<namespace>.<function>".
//   node scripts/proof/ipc-inventory.mjs --write   regenerate the baseline file from the current tree
//   node scripts/proof/ipc-inventory.mjs           compare the current tree against the baseline
// A call counts when its root is `window.api` (before the refactor) or `posApi()` (after it; the baseline was recorded when the renderer lived in src/renderer), so
// the same script proves nothing was dropped or invented when calls moved behind services/.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baselinePath = path.join(root, "scripts/proof/ipc-inventory.baseline.json");
const rendererDir = "apps/pos-desktop/src";

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function isApiRoot(node) {
  if (ts.isPropertyAccessExpression(node)) {
    return ts.isIdentifier(node.expression) && node.expression.text === "window" && node.name.text === "api";
  }
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "posApi";
}

function collect() {
  const dir = path.join(root, rendererDir);
  const files = sourceFiles(dir);
  const found = new Set();
  for (const file of files) {
    const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
    const visit = (node) => {
      // <root>.<ns>.<fn>
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        isApiRoot(node.expression.expression)
      ) {
        found.add(`${node.expression.name.text}.${node.name.text}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return [...found].sort();
}

const current = collect();
if (process.argv.includes("--write")) {
  fs.writeFileSync(baselinePath, JSON.stringify(current, null, 2) + "\n");
  process.stdout.write(`wrote ${current.length} channels to ${path.relative(root, baselinePath)}\n`);
} else {
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  const missing = baseline.filter((c) => !current.includes(c));
  const extra = current.filter((c) => !baseline.includes(c));
  process.stdout.write(`ipc: ${current.length} channels (baseline ${baseline.length})\n`);
  if (missing.length || extra.length) {
    process.stdout.write(`FAIL missing: ${missing.join(", ") || "-"}  extra: ${extra.join(", ") || "-"}\n`);
    process.exit(1);
  }
  process.stdout.write("PASS\n");
}

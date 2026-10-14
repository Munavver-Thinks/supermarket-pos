// Fails when a .tsx file contains no JSX (it should be .ts). A .ts file with JSX already fails tsc.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const srcDir = path.join(root, "apps/pos-desktop/src");

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : /\.tsx$/.test(e.name) ? [full] : [];
  });
}

function hasJsx(sf) {
  let found = false;
  const visit = (node) => {
    if (found) return;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

const offenders = [];
let count = 0;
for (const file of walk(srcDir)) {
  count += 1;
  const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  if (!hasJsx(sf)) offenders.push(path.relative(root, file));
}

process.stdout.write(`extensions: ${count} .tsx files checked\n`);
if (offenders.length) {
  process.stdout.write(`FAIL .tsx without JSX (rename to .ts):\n  ${offenders.join("\n  ")}\n`);
  process.exit(1);
}
process.stdout.write("PASS\n");

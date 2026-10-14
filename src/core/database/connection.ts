import { createRequire } from "node:module";

import { CamelCasePlugin, Kysely, SqliteDialect } from "kysely";
import type BetterSqlite3 from "better-sqlite3";

import type { Database as Schema } from "./schema.js";

// better-sqlite3 is a native CJS addon. Loading it via a static ESM `import` trips a
// known Node bug (cjs-module-lexer chokes on its export shape once it's externalized out
// of a bundle, e.g. by Vite for the Electron main process) — `createRequire` sidesteps
// Node's ESM interop entirely and just works everywhere this runs (Vitest, Electron main).
const require = createRequire(import.meta.url);
const DatabaseConstructor = require("better-sqlite3") as typeof BetterSqlite3;

export type Db = Kysely<Schema>;

export interface CreateDbOptions {
  /** Absolute path to the SQLite file, or ":memory:" for tests. */
  filePath: string;
}

export function createDb(options: CreateDbOptions): Db {
  const sqlite = new DatabaseConstructor(options.filePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("synchronous = NORMAL");

  return new Kysely<Schema>({
    dialect: new SqliteDialect({ database: sqlite }),
    plugins: [new CamelCasePlugin()],
  });
}

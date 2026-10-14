import { createDb } from "./connection.js";
import { defaultAppDbPath } from "./defaultDbPath.js";
import { runMigrations } from "./migrator.js";

const filePath = process.argv[2] ?? defaultAppDbPath();

const db = createDb({ filePath });
await runMigrations(db);
await db.destroy();

console.warn(`Migrations applied to ${filePath}`);

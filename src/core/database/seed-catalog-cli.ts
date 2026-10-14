import { createDb } from "./connection.js";
import { defaultAppDbPath } from "./defaultDbPath.js";
import { seedGroceryCatalog } from "./repositories/groceryCatalog.js";

const filePath = process.argv[2] ?? defaultAppDbPath();

const db = createDb({ filePath });

const store = await db.selectFrom("stores").select("id").executeTakeFirst();
if (!store) {
  console.error(`No store found in ${filePath} — run first-run setup (and migrations) before seeding the catalog.`);
  await db.destroy();
  process.exit(1);
}

const result = await seedGroceryCatalog(db, store.id);
await db.destroy();

console.warn(
  `Seeded ${result.productsCreated} products across ${result.categoriesCreated} categories and ${result.brandsCreated} brands into ${filePath}`,
);

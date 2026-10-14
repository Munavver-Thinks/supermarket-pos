import { createDb } from "./connection.js";
import { defaultAppDbPath } from "./defaultDbPath.js";
import { seedKiranaCatalog } from "./repositories/kiranaCatalog.js";

const filePath = process.argv[2] ?? defaultAppDbPath();

const db = createDb({ filePath });

const store = await db.selectFrom("stores").select("id").executeTakeFirst();
if (!store) {
  console.error(`No store found in ${filePath} — run first-run setup (and migrations) before seeding the catalog.`);
  await db.destroy();
  process.exit(1);
}

const user = await db.selectFrom("users").select("id").where("storeId", "=", store.id).executeTakeFirst();
if (!user) {
  console.error(`No user found for store ${store.id} in ${filePath} — first-run setup should have created an owner.`);
  await db.destroy();
  process.exit(1);
}

const result = await seedKiranaCatalog(db, store.id, user.id);
await db.destroy();

console.warn(`Seeded ${result.productsCreated} products across ${result.categoriesCreated} categories into ${filePath}`);

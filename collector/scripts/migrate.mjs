// `npm run migrate` with DATABASE_URL set. The admin login applies the same migrations automatically.
import { getDb } from "../lib/db.js";
import { applyMigrations } from "../lib/migrate.js";

const applied = await applyMigrations(getDb());
console.log(applied.length ? "Applied: " + applied.join(", ") : "Nothing to apply; schema is current.");

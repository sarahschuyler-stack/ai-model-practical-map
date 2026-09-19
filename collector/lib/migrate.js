// Applies collector/migrations/*.sql in name order, once each, recording them in schema_migrations.
// Runs from `npm run migrate` and automatically on a successful admin login, so no terminal is needed.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(here, "..", "migrations");

/** Split a migration file into single statements; the Neon HTTP driver runs one statement per query. */
export function splitStatements(sqlText) {
  return sqlText
    .split("\n").filter(l => !l.trim().startsWith("--")).join("\n")
    .split(/;\s*(?:\n|$)/).map(s => s.trim()).filter(Boolean);
}

export async function applyMigrations(db, dir = MIGRATIONS_DIR) {
  await db.q("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await db.q("select name from schema_migrations")).map(r => r.name));
  const files = readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
  const applied = [];
  for (const f of files) {
    if (done.has(f)) continue;
    for (const stmt of splitStatements(readFileSync(join(dir, f), "utf8"))) await db.q(stmt);
    await db.q("insert into schema_migrations (name) values ($1) on conflict do nothing", [f]);
    applied.push(f);
  }
  return applied;
}

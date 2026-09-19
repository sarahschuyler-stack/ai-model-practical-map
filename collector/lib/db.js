// One tiny database facade: db.q(text, params) returns rows. Handlers take it as
// an argument (makeHandler(db)) so the tests can pass a recorder instead of Neon.
import { neon } from "@neondatabase/serverless";

let cached = null;

export function getDb() {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Attach a Neon Postgres database to the Vercel project.");
  const sql = neon(url);
  cached = { q: (text, params = []) => sql.query(text, params) };
  return cached;
}

/** Wraps a makeHandler so the database is only opened on the first request and a missing URL is a readable 500. */
export function withDb(makeHandler) {
  let handler = null;
  return async (req, res) => {
    try {
      if (!handler) handler = makeHandler(getDb());
    } catch (e) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(e.message);
      return;
    }
    return handler(req, res);
  };
}

/** True when the error is Postgres "relation does not exist", i.e. the migration has not run yet. */
export function isMissingTable(e) {
  return !!e && (e.code === "42P01" || /relation .* does not exist/i.test(String(e.message || "")));
}

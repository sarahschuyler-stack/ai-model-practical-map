// Per-source throttling for the admin login. These are serverless functions, so an
// in-memory counter would only ever slow down whoever happened to land on the same
// warm instance; the count lives in Postgres instead, in admin_login_failures
// (migration 0002), and is read on every POST to /admin/login.
//
// Sources are recorded as an HMAC of the client IP keyed by the admin session
// secret, never as the IP itself, so the collector keeps its promise not to store
// IP addresses (see README "Privacy") while still counting per address.
import crypto from "node:crypto";
import { isMissingTable } from "./db.js";

export const WINDOW_SECONDS = 15 * 60;
export const MAX_FAILURES = 8;

/** The DDL for the failures table, kept idempotent and identical to migrations/0002_admin_login_failures.sql. */
export const TABLE_SQL = [
  `create table if not exists admin_login_failures (
     id bigserial primary key,
     source_hash bytea not null,
     created_at timestamptz not null default now()
   )`,
  "create index if not exists admin_login_failures_source_idx on admin_login_failures (source_hash, created_at desc)",
  "create index if not exists admin_login_failures_created_idx on admin_login_failures (created_at desc)",
];

/** The client address Vercel saw, or "unknown" behind a proxy that sends nothing. */
export function clientIp(req) {
  const h = (req && req.headers) || {};
  const fwd = String(h["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = fwd || String(h["x-real-ip"] || "").trim() || (req && req.socket && req.socket.remoteAddress) || "";
  return ip || "unknown";
}

/** An opaque, stable key for one source. Keyed by the admin secret so the raw IP is never stored. */
export function sourceKey(req, cfg) {
  const key = (cfg && cfg.secret) || Buffer.from("pm-admin-throttle");
  return crypto.createHmac("sha256", key).update("login:" + clientIp(req)).digest();
}

/** Runs `fn`, creating the table and retrying once if it is not there yet. */
async function withTable(db, fn) {
  try { return await fn(); }
  catch (e) {
    if (!isMissingTable(e)) throw e;
    // The first successful login applies the migrations, so a brand-new deployment
    // can be guessed at before the table exists. Create it now rather than fail open.
    for (const stmt of TABLE_SQL) await db.q(stmt);
    return fn();
  }
}

/**
 * How this source stands right now: { blocked, failures, retryAfter } where retryAfter
 * is the seconds until the oldest failure in the window ages out.
 */
export async function checkThrottle(db, source, { window = WINDOW_SECONDS, max = MAX_FAILURES } = {}) {
  const [row] = await withTable(db, () => db.q(
    `select count(*)::int as n,
            coalesce(ceil(extract(epoch from (min(created_at) + ($2 * interval '1 second') - now()))), 0)::int as retry_after
       from admin_login_failures
      where source_hash = $1 and created_at > now() - ($2 * interval '1 second')`, [source, window]));
  const failures = (row && row.n) || 0;
  return { blocked: failures >= max, failures, retryAfter: Math.max(1, (row && row.retry_after) || window) };
}

/** Records one failed attempt and drops rows too old to matter. */
export async function recordFailure(db, source, { window = WINDOW_SECONDS } = {}) {
  await withTable(db, () => db.q("insert into admin_login_failures (source_hash) values ($1)", [source]));
  await db.q("delete from admin_login_failures where created_at < now() - ($1 * interval '1 second')", [window * 4]);
}

/** Clears a source's failures after a correct login, so one typo costs nothing later. */
export async function clearFailures(db, source) {
  await withTable(db, () => db.q("delete from admin_login_failures where source_hash = $1", [source]));
}

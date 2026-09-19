// POST /api/track  one JSON envelope per request (sent as text/plain, parsed as JSON regardless).
// The user is resolved from the identity token; sessions are scoped to that user, so nobody can write
// into anyone else's session. Replies carry no data: 204, or 400/401/403/405/429/500 with a short reason.
import crypto from "node:crypto";
import { withDb } from "../lib/db.js";
import { cors, readBody, json, send, MAX_BODY } from "../lib/http.js";
import { parseEnvelope, BadRequest, MAX_BEAT_SECONDS } from "../lib/validate.js";
import { browserFamily } from "../lib/ua.js";

const MIN_BEAT_GAP_SECONDS = 20;
const MAX_EVENTS_PER_SESSION = 2000;

/** Credit at most MAX_BEAT_SECONDS per beat and never more than the wall time since the previous one (plus a
    little slack for clock jitter), so a hostile client cannot inflate its active time. */
export function creditFor(reported, ts, lastActivityAt) {
  const wall = Math.max(0, Math.floor((ts - new Date(lastActivityAt)) / 1000)) + 5;
  return Math.max(0, Math.min(reported, MAX_BEAT_SECONDS, wall));
}

export function makeHandler(db) {
  async function startSession(ev, userId, browser) {
    const [row] = await db.q(
      `insert into sessions (id, user_id, started_at, last_activity_at, referrer, landing_page, browser)
       values ($1, $2, $3, $3, nullif($4, ''), $5, nullif($6, ''))
       on conflict (id) do update set last_activity_at = greatest(sessions.last_activity_at, excluded.last_activity_at), ended_at = null, end_reason = null
       where sessions.user_id = excluded.user_id
       returning (xmax = 0) as inserted`,
      [ev.sid, userId, ev.ts.toISOString(), ev.ref, (ev.path + ev.hash).slice(0, 400), browser]);
    if (!row) return false;                       // the sid belongs to another user
    if (row.inserted) await db.q("update users set total_sessions = total_sessions + 1, last_seen_at = greatest(last_seen_at, $2), updated_at = now() where id = $1", [userId, ev.ts.toISOString()]);
    else await db.q("update users set last_seen_at = greatest(last_seen_at, $2), updated_at = now() where id = $1", [userId, ev.ts.toISOString()]);
    return true;
  }

  return async (req, res) => {
    const c = cors(req, res);
    if (c === "preflight") return;
    if (c === "forbidden") return send(res, 403, "");
    if (req.method !== "POST") return send(res, 405, "", { Allow: "POST, OPTIONS" });
    let ev;
    try { ev = parseEnvelope(await readBody(req, MAX_BODY)); }
    catch (err) { return err instanceof BadRequest ? json(res, 400, { error: err.message }) : json(res, 500, { error: "server error" }); }
    try {
      const hash = crypto.createHash("sha256").update(ev.token).digest();
      const [tok] = await db.q(
        `update identity_tokens set last_used_at = now()
         where token_hash = $1 and expires_at > now() and (last_used_at is null or last_used_at < now() - interval '1 hour')
         returning user_id`, [hash]);
      let userId = tok && tok.user_id;
      if (!userId) {
        const [t2] = await db.q("select user_id from identity_tokens where token_hash = $1 and expires_at > now()", [hash]);
        userId = t2 && t2.user_id;
      }
      if (!userId) return json(res, 401, { error: "unknown or expired identity" });
      const browser = browserFamily(req.headers && req.headers["user-agent"]);
      const ts = ev.ts.toISOString();

      if (ev.type === "start") {
        if (!(await startSession(ev, userId, browser))) return json(res, 403, { error: "session belongs to another user" });
        return send(res, 204, "");
      }

      if (ev.type === "beat" || ev.type === "end") {
        let [s] = await db.q("select id, user_id, last_activity_at from sessions where id = $1", [ev.sid]);
        if (s && s.user_id !== userId) return json(res, 403, { error: "session belongs to another user" });
        if (!s) {
          if (!(await startSession(ev, userId, browser))) return json(res, 403, { error: "session belongs to another user" });
          [s] = await db.q("select id, user_id, last_activity_at from sessions where id = $1", [ev.sid]);
        }
        if (ev.type === "beat" && ev.ts - new Date(s.last_activity_at) < MIN_BEAT_GAP_SECONDS * 1000) return json(res, 429, { error: "beats are limited to one per 20 seconds" });
        const credit = creditFor(ev.active_seconds, ev.ts, s.last_activity_at);
        const endCols = ev.type === "end" ? ", ended_at = $2::timestamptz, end_reason = nullif($4, '')" : "";
        await db.q(
          `update sessions set active_seconds = active_seconds + $3, last_activity_at = greatest(last_activity_at, $2::timestamptz)${endCols}
           where id = $1 and user_id = $5`,
          [ev.sid, ts, credit, ev.type === "end" ? ev.reason : null, userId]);
        await db.q("update users set total_active_seconds = total_active_seconds + $2, last_seen_at = greatest(last_seen_at, $3), updated_at = now() where id = $1", [userId, credit, ts]);
        return send(res, 204, "");
      }

      // event
      let [s] = await db.q("select id, user_id from sessions where id = $1", [ev.sid]);
      if (s && s.user_id !== userId) return json(res, 403, { error: "session belongs to another user" });
      if (!s) {
        if (!(await startSession(ev, userId, browser))) return json(res, 403, { error: "session belongs to another user" });
      }
      const [{ n }] = await db.q("select count(*)::int as n from usage_events where session_id = $1", [ev.sid]);
      if (n >= MAX_EVENTS_PER_SESSION) return json(res, 429, { error: "too many events for this session" });
      await db.q(
        "insert into usage_events (user_id, session_id, event_name, path, feature, metadata, created_at) values ($1, $2, $3, $4, $5, $6::jsonb, $7)",
        [userId, ev.sid, ev.name, (ev.path + ev.hash).slice(0, 400), ev.feature, JSON.stringify(ev.meta || {}), ts]);
      if (ev.name === "page_view") await db.q("update sessions set page_views = page_views + 1 where id = $1", [ev.sid]);
      return send(res, 204, "");
    } catch (err) {
      console.error("track failed:", err);
      return json(res, 500, { error: "server error" });
    }
  };
}

export default withDb(makeHandler);

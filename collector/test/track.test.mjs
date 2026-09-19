import { test } from "node:test";
import assert from "node:assert/strict";
import { makeHandler, creditFor } from "../api/track.js";
import { req, res, fakeDb, knownUser, ORIGIN, TOKEN, USER } from "./helpers.mjs";

const url = "/api/track";
const now = () => new Date().toISOString();
const ev = o => ({ v: 1, type: "start", sid: "sid-abcdefgh", token: TOKEN, ts: now(), path: "/ai-model-practical-map/", hash: "", ref: "https://t.co/x", tz: "America/Chicago", ...o });
const ua = "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

test("15. an unknown token is 401 and writes nothing", async () => {
  const db = fakeDb(() => []);
  const r = res();
  await makeHandler(db)(req({ url, body: ev({}) }), r);
  assert.equal(r.statusCode, 401);
  assert.ok(db.calls.every(c => /identity_tokens/.test(c.text)), "only token lookups ran");
});

test("a text/plain body from the page is parsed as JSON and CORS is set for the page origin", async () => {
  const db = fakeDb(knownUser());
  const r = res();
  await makeHandler(db)(req({ url, origin: ORIGIN, headers: { "content-type": "text/plain;charset=UTF-8", "user-agent": ua }, body: JSON.stringify(ev({})) }), r);
  assert.equal(r.statusCode, 204, r.body);
  assert.equal(r.body, "", "success carries no data");
  assert.equal(r.getHeader("access-control-allow-origin"), ORIGIN);
});

test("9. start inserts the session, stores a coarse browser family and bumps total_sessions once", async () => {
  const db = fakeDb(knownUser());
  await makeHandler(db)(req({ url, headers: { "user-agent": ua }, body: ev({}) }), res());
  const ins = db.find(/insert into sessions/);
  assert.equal(ins.params[0], "sid-abcdefgh");
  assert.equal(ins.params[1], USER);
  assert.equal(ins.params[3], "https://t.co/x");
  assert.equal(ins.params[5], "Chrome/Windows");
  assert.ok(!JSON.stringify(db.calls).includes("AppleWebKit"), "raw user agent is never stored");
  assert.match(ins.text, /where sessions.user_id = excluded.user_id/, "a sid owned by someone else is not taken over");
  assert.ok(db.find(/total_sessions = total_sessions \+ 1/));
});

test("a resumed session (reload) does not count as a new session", async () => {
  const db = fakeDb(knownUser({ session: { id: "sid-abcdefgh", user_id: USER, last_activity_at: now() } }));
  await makeHandler(db)(req({ url, body: ev({}) }), res());
  assert.equal(db.find(/total_sessions = total_sessions \+ 1/), undefined);
  assert.ok(db.find(/set last_seen_at = greatest/));
});

test("15. a session that belongs to another user is refused", async () => {
  const other = { id: "sid-abcdefgh", user_id: "22222222-2222-4222-8222-222222222222", last_activity_at: now() };
  for (const type of ["beat", "end", "event"]) {
    const db = fakeDb(knownUser({ session: other }));
    const r = res();
    await makeHandler(db)(req({ url, body: ev({ type, active_seconds: 10, name: "prompt_copied" }) }), r);
    assert.equal(r.statusCode, 403, type);
    assert.equal(db.find(/update sessions/), undefined);
  }
  const db = fakeDb(t => (/identity_tokens/.test(t) ? [{ user_id: USER }] : /insert into sessions/.test(t) ? [] : undefined));
  const r = res();
  await makeHandler(db)(req({ url, body: ev({}) }), r);
  assert.equal(r.statusCode, 403, "start on a foreign sid");
});

test("11 and 12. a beat credits at most the reported, the cap, and the wall time since the last beat", () => {
  const t = new Date("2026-09-19T12:00:40Z");
  assert.equal(creditFor(30, t, "2026-09-19T12:00:10Z"), 30, "30 reported over 30s wall");
  assert.equal(creditFor(60, t, "2026-09-19T12:00:30Z"), 15, "10s wall + 5s slack caps a 60s claim");
  assert.equal(creditFor(600, t, "2026-09-19T11:00:00Z"), 60, "never more than the cap");
  assert.equal(creditFor(20, t, "2026-09-19T13:00:00Z"), 5, "clock skew backwards gives only the slack");
});

test("a beat updates the session and the user with the credited seconds", async () => {
  const last = new Date(Date.now() - 31000).toISOString();
  const db = fakeDb(knownUser({ session: { id: "sid-abcdefgh", user_id: USER, last_activity_at: last } }));
  const r = res();
  await makeHandler(db)(req({ url, body: ev({ type: "beat", active_seconds: 30 }) }), r);
  assert.equal(r.statusCode, 204, r.body);
  const up = db.find(/update sessions set active_seconds/);
  assert.equal(up.params[2], 30);
  assert.ok(!/ended_at/.test(up.text));
  assert.equal(db.find(/total_active_seconds = total_active_seconds \+ \$2/).params[1], 30);
});

test("beats closer than twenty seconds apart are refused", async () => {
  const db = fakeDb(knownUser({ session: { id: "sid-abcdefgh", user_id: USER, last_activity_at: new Date(Date.now() - 5000).toISOString() } }));
  const r = res();
  await makeHandler(db)(req({ url, body: ev({ type: "beat", active_seconds: 5 }) }), r);
  assert.equal(r.statusCode, 429);
  assert.equal(db.find(/update sessions/), undefined);
});

test("end closes the session with its reason", async () => {
  const db = fakeDb(knownUser({ session: { id: "sid-abcdefgh", user_id: USER, last_activity_at: new Date(Date.now() - 10000).toISOString() } }));
  const r = res();
  await makeHandler(db)(req({ url, body: ev({ type: "end", active_seconds: 8, reason: "pagehide" }) }), r);
  assert.equal(r.statusCode, 204, r.body);
  const up = db.find(/update sessions set active_seconds/);
  assert.match(up.text, /ended_at = \$2::timestamptz, end_reason = nullif\(\$4, ''\)/);
  assert.equal(up.params[3], "pagehide");
  assert.equal(up.params[2], 8);
});

test("a beat for a session the server has not seen creates it first", async () => {
  let created = false;
  const db = fakeDb((t, p) => {
    if (/identity_tokens/.test(t)) return [{ user_id: USER }];
    if (/insert into sessions/.test(t)) { created = true; return [{ inserted: true }]; }
    if (/select id, user_id, last_activity_at from sessions/.test(t)) return created ? [{ id: p[0], user_id: USER, last_activity_at: new Date(Date.now() - 60000).toISOString() }] : [];
  });
  const r = res();
  await makeHandler(db)(req({ url, body: ev({ type: "beat", active_seconds: 30 }) }), r);
  assert.equal(r.statusCode, 204, r.body);
  assert.ok(created);
});

test("10. events are stored with cleaned metadata and page_view bumps the counter", async () => {
  const db = fakeDb(knownUser({ session: { id: "sid-abcdefgh", user_id: USER } }));
  const r = res();
  await makeHandler(db)(req({ url, body: ev({ type: "event", name: "page_view", hash: "#price", meta: { hash: "#price", junk: { a: 1 } } }) }), r);
  assert.equal(r.statusCode, 204, r.body);
  const ins = db.find(/insert into usage_events/);
  assert.equal(ins.params[2], "page_view");
  assert.equal(ins.params[3], "/ai-model-practical-map/#price");
  assert.equal(ins.params[4], "page");
  assert.deepEqual(JSON.parse(ins.params[5]), { hash: "#price" });
  assert.ok(db.find(/page_views = page_views \+ 1/));
});

test("a session with two thousand events takes no more", async () => {
  const db = fakeDb(t => (/count\(\*\)::int as n from usage_events/.test(t) ? [{ n: 2000 }] : knownUser({ session: { id: "sid-abcdefgh", user_id: USER } })(t)));
  const r = res();
  await makeHandler(db)(req({ url, body: ev({ type: "event", name: "prompt_copied" }) }), r);
  assert.equal(r.statusCode, 429);
  assert.equal(db.find(/insert into usage_events/), undefined);
});

test("oversized, malformed and foreign-origin requests never reach the database", async () => {
  const db = fakeDb(knownUser());
  const h = makeHandler(db);
  let r = res(); await h(req({ url, body: "x".repeat(5000) }), r); assert.equal(r.statusCode, 400);
  r = res(); await h(req({ url, body: ev({ sid: "nope" }) }), r); assert.equal(r.statusCode, 400);
  r = res(); await h(req({ url, origin: "https://evil.example", body: ev({}) }), r); assert.equal(r.statusCode, 403);
  r = res(); await h(req({ method: "GET", url }), r); assert.equal(r.statusCode, 405);
  assert.equal(db.calls.length, 0);
});

test("a database failure is a generic 500 that leaks nothing", async () => {
  const r = res();
  await makeHandler(fakeDb(() => { throw new Error("password authentication failed for user neondb_owner"); }))(req({ url, body: ev({}) }), r);
  assert.equal(r.statusCode, 500);
  assert.ok(!r.body.includes("neondb_owner"));
});

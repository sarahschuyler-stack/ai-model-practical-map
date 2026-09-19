import { test } from "node:test";
import assert from "node:assert/strict";
import { req, res, fakeDb } from "./helpers.mjs";

process.env.ADMIN_EMAILS = "Sarah@Example.com, second@example.com";
process.env.ADMIN_KEY = "correct-horse-battery";

const { config, sign, verify, checkLogin, COOKIE } = await import("../lib/admin.js");
const login = await import("../api/admin/login.js");
const usage = await import("../api/admin/usage.js");
const user = await import("../api/admin/user.js");
const exp = await import("../api/admin/export.js");
const logout = await import("../api/admin/logout.js");

const cookie = () => `${COOKIE}=${sign("sarah@example.com")}`;
const XSS = "<script>alert(1)</script>";

/** Rows for every report query, with hostile strings in the places an admin would see. */
function reportDb() {
  return fakeDb(text => {
    if (/^select \(select count\(\*\)::int from users\)/.test(text)) return [{ users: 2, sessions: 5, today: 1, last7: 3, last30: 5, avg_active: 125, total_active: 625, new_week: 1, returning_week: 1 }];
    if (/^with days as/.test(text)) return [{ day: "2026-09-18", sessions: 2, dau: 1, minutes: 4, new_users: 1 }, { day: "2026-09-19", sessions: 3, dau: 2, minutes: 6, new_users: 0 }];
    if (/^select coalesce\(feature, 'other'\) as feature/.test(text)) return [{ feature: "prompt", n: 7 }, { feature: XSS, n: 1 }];
    if (/^select u\.email/.test(text)) return [{ email: XSS + "@x.com", normalized_email: "<script>@x.com", first_seen_at: "2026-09-01T00:00:00Z", last_seen_at: "2026-09-19T10:00:00Z", total_sessions: 3, total_active_seconds: 300, avg_session: 100, top_feature: "prompt" }];
    if (/^select \* from \(/.test(text)) return [{ at: "2026-09-19T15:04:00Z", email: "person@example.com", name: "prompt_copied", metadata: { model_id: XSS } }];
    if (/^select id, email, normalized_email/.test(text)) return [{ id: "u1", email: XSS + "@x.com", normalized_email: "<script>@x.com", first_seen_at: "2026-09-01T00:00:00Z", last_seen_at: "2026-09-19T10:00:00Z", total_sessions: 3, total_active_seconds: 300, avg_session: 100, email_verified_at: null }];
    if (/^select id, started_at/.test(text)) return [{ id: "s1", started_at: "2026-09-19T10:00:00Z", ended_at: null, end_reason: null, active_seconds: 40, page_views: 1, landing_page: "/" + XSS, referrer: null, browser: "Safari/macOS" }];
    if (/^select created_at, event_name/.test(text)) return [{ created_at: "2026-09-19T10:01:00Z", event_name: "recheck_run", feature: "recheck", metadata: { mode: "api" } }];
    if (/^delete from users/.test(text)) return [{ id: "u1" }];
  });
}

test("cookie signing round-trips, and tampering, expiry or an unlisted email fail", () => {
  const cfg = config();
  assert.ok(cfg.ready);
  const v = sign("sarah@example.com", cfg);
  assert.equal(verify(v, cfg), "sarah@example.com");
  assert.equal(verify(v.slice(0, -2) + "xx", cfg), null, "bad mac");
  assert.equal(verify(sign("sarah@example.com", cfg, Date.now() - 13 * 3600 * 1000), cfg), null, "expired");
  assert.equal(verify(sign("stranger@example.com", cfg), cfg), null, "not an admin");
  assert.equal(verify("nonsense", cfg), null);
  assert.equal(verify(v, config({ ADMIN_EMAILS: "sarah@example.com", ADMIN_KEY: "different-key-here" })), null, "a different key means a different secret");
});

test("checkLogin needs a listed email and the exact key; unconfigured is refused", () => {
  assert.deepEqual(checkLogin(" SARAH@example.com ", "correct-horse-battery"), { ok: true, email: "sarah@example.com" });
  assert.equal(checkLogin("sarah@example.com", "wrong").ok, false);
  assert.equal(checkLogin("stranger@example.com", "correct-horse-battery").ok, false, "typing an admin email into the gate is not enough");
  assert.equal(checkLogin("sarah@example.com", "correct-horse-battery", config({})).reason, "not-configured");
  assert.equal(config({ ADMIN_EMAILS: "a@b.co", ADMIN_KEY: "short" }).ready, false, "keys under eight characters are not accepted");
});

test("13. a correct login sets an HttpOnly cookie and applies the migrations", async () => {
  const db = fakeDb(t => (/select name from schema_migrations/.test(t) ? [] : undefined));
  const r = res();
  await login.makeHandler(db)(req({ method: "POST", url: "/admin/login", form: { email: "sarah@example.com", admin_key: "correct-horse-battery" } }), r);
  assert.equal(r.statusCode, 302, r.body);
  assert.equal(r.getHeader("location"), "/admin/usage");
  assert.match(r.getHeader("set-cookie"), /^pm_admin=.+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200$/);
  assert.ok(db.find(/create table if not exists users/), "migration ran");
  assert.ok(db.find(/insert into schema_migrations/));
  const value = r.getHeader("set-cookie").split(";")[0].split("=")[1];
  assert.equal(verify(value), "sarah@example.com");
});

test("14. a wrong key or an unlisted email is refused, and the gate token is worthless here", async () => {
  const db = fakeDb();
  let r = res();
  await login.makeHandler(db)(req({ method: "POST", url: "/admin/login", form: { email: "sarah@example.com", admin_key: "nope-nope-nope" } }), r);
  assert.equal(r.statusCode, 401);
  assert.equal(r.getHeader("set-cookie"), undefined);
  r = res();
  await login.makeHandler(db)(req({ method: "POST", url: "/admin/login", form: { email: "visitor@example.com", admin_key: "correct-horse-battery" } }), r);
  assert.equal(r.statusCode, 401);
  assert.equal(db.calls.length, 0, "no migration on a failed login");
  for (const h of [usage.makeHandler(reportDb()), user.makeHandler(reportDb()), exp.makeHandler(reportDb())]) {
    r = res();
    await h(req({ method: "GET", url: "/admin/usage?email=a@b.co", cookie: `${COOKIE}=${"a".repeat(43)}` }), r);
    assert.equal(r.statusCode, 302);
    assert.equal(r.getHeader("location"), "/admin/login");
  }
});

test("the login form says plainly when the dashboard is not configured", async () => {
  const saved = { e: process.env.ADMIN_EMAILS, k: process.env.ADMIN_KEY };
  delete process.env.ADMIN_EMAILS; delete process.env.ADMIN_KEY;
  try {
    const r = res();
    await login.makeHandler(fakeDb())(req({ method: "GET", url: "/admin/login" }), r);
    assert.equal(r.statusCode, 200);
    assert.match(r.body, /not configured yet/);
    assert.match(r.body, /ADMIN_KEY/);
  } finally { process.env.ADMIN_EMAILS = saved.e; process.env.ADMIN_KEY = saved.k; }
});

test("13. the overview renders for an admin with every value escaped", async () => {
  const r = res();
  await usage.makeHandler(reportDb())(req({ method: "GET", url: "/admin/usage?tz=America/Chicago&from=2026-09-01&to=2026-09-19", cookie: cookie() }), r);
  assert.equal(r.statusCode, 200, r.body.slice(0, 200));
  assert.match(r.getHeader("content-type"), /text\/html/);
  assert.ok(!r.body.includes(XSS), "hostile strings are escaped");
  assert.ok(r.body.includes("&lt;script&gt;"));
  assert.match(r.body, /Unique users/);
  assert.match(r.body, /Daily active users/);
  assert.match(r.body, /person@example\.com — Copied a prompt/);
  assert.match(r.body, /10:04 AM/, "times in the chosen zone");
  assert.match(r.body, /sarah@example\.com/);
  assert.ok(!r.body.includes("<script"), "the page ships no scripts");
});

test("the overview handles an empty database and a missing schema", async () => {
  let r = res();
  await usage.makeHandler(fakeDb(t => (/^select \(select count/.test(t) ? [{ users: 0, sessions: 0, today: 0, last7: 0, last30: 0, avg_active: 0, total_active: 0, new_week: 0, returning_week: 0 }] : [])))(req({ method: "GET", url: "/admin/usage", cookie: cookie() }), r);
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /No users yet/);
  r = res();
  await usage.makeHandler(fakeDb(() => { const e = new Error('relation "users" does not exist'); e.code = "42P01"; throw e; }))(req({ method: "GET", url: "/admin/usage", cookie: cookie() }), r);
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /not created yet/);
});

test("date and sort parameters are validated and applied", () => {
  const r = usage.parseRange({ from: "2026-09-01", to: "2026-09-10", tz: "Europe/London", sort: "usage", q: "sar", page: "2" });
  assert.deepEqual([r.from, r.toInclusive, r.to, r.tz, r.sort, r.q, r.page], ["2026-09-01", "2026-09-10", "2026-09-11", "Europe/London", "usage", "sar", 2]);
  const d = usage.parseRange({ from: "junk", tz: "Mars/Olympus", sort: "drop table", page: "-4" }, new Date("2026-09-19T12:00:00Z"));
  assert.deepEqual([d.from, d.toInclusive, d.tz, d.sort, d.page], ["2026-08-21", "2026-09-19", "UTC", "recent", 1]);
});

test("the user detail page renders and escapes; a bad or unknown email is handled", async () => {
  let r = res();
  await user.makeHandler(reportDb())(req({ method: "GET", url: "/admin/usage/user?email=%3Cscript%3E%40x.com&tz=UTC", cookie: cookie() }), r);
  assert.equal(r.statusCode, 200, "a syntactically valid but hostile email renders escaped");
  assert.ok(!r.body.includes(XSS));
  r = res();
  await user.makeHandler(reportDb())(req({ method: "GET", url: "/admin/usage/user?email=person@x.com", cookie: cookie() }), r);
  assert.equal(r.statusCode, 200, r.body.slice(0, 200));
  assert.ok(!r.body.includes(XSS));
  assert.match(r.body, /Recent sessions/);
  assert.match(r.body, /Ran a Recheck · api/);
  assert.match(r.body, /Safari\/macOS/);
  r = res();
  await user.makeHandler(fakeDb(() => []))(req({ method: "GET", url: "/admin/usage/user?email=nobody@x.com", cookie: cookie() }), r);
  assert.equal(r.statusCode, 404);
});

test("deleting a person requires the confirmation box and cascades through one statement", async () => {
  const db = reportDb();
  let r = res();
  await user.makeHandler(db)(req({ method: "POST", url: "/admin/usage/user", form: { email: "person@x.com", action: "delete" } }), r);
  assert.equal(r.statusCode, 302, "no cookie: to login");
  r = res();
  await user.makeHandler(db)(req({ method: "POST", url: "/admin/usage/user", cookie: cookie(), form: { email: "person@x.com", action: "delete" } }), r);
  assert.equal(r.statusCode, 400);
  assert.equal(db.find(/delete from users/), undefined);
  r = res();
  await user.makeHandler(db)(req({ method: "POST", url: "/admin/usage/user", cookie: cookie(), form: { email: "Person@x.com", action: "delete", confirm: "yes" } }), r);
  assert.equal(r.statusCode, 302);
  assert.deepEqual(db.find(/delete from users/).params, ["person@x.com"]);
});

test("the CSV export needs the cookie and neutralises spreadsheet formulas", async () => {
  const db = fakeDb(t => (/^select u\.email/.test(t) ? [{ email: "=HYPERLINK(\"x\")@evil.com", first_seen_at: "2026-09-01T00:00:00Z", last_seen_at: "2026-09-02T00:00:00Z", total_sessions: 1, total_active_seconds: 10, avg_session: 10, top_feature: null }] : []));
  let r = res();
  await exp.makeHandler(db)(req({ method: "GET", url: "/admin/usage/export.csv" }), r);
  assert.equal(r.statusCode, 302);
  r = res();
  await exp.makeHandler(db)(req({ method: "GET", url: "/admin/usage/export.csv?sort=usage", cookie: cookie() }), r);
  assert.equal(r.statusCode, 200);
  assert.match(r.getHeader("content-type"), /text\/csv/);
  assert.match(r.body, /^email,first_seen/);
  assert.match(r.body, /"'=HYPERLINK\(""x""\)@evil\.com"/);
  assert.equal(exp.cell("plain"), "plain");
  assert.equal(exp.cell("a,b"), '"a,b"');
  assert.equal(db.find(/^select u\.email/).params[1], 5000);
});

test("logout clears the cookie", async () => {
  const r = res();
  await logout.default(req({ method: "POST", url: "/admin/logout", cookie: cookie() }), r);
  assert.equal(r.statusCode, 302);
  assert.match(r.getHeader("set-cookie"), /Max-Age=0/);
});

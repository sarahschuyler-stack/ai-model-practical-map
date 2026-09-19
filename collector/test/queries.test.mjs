import { test } from "node:test";
import assert from "node:assert/strict";
import * as Q from "../lib/queries.js";
import { applyMigrations } from "../lib/migrate.js";
import { fakeDb } from "./helpers.mjs";

const range = { from: "2026-09-01", to: "2026-09-20", tz: "America/Chicago" };

test("report queries only ever parameterise user input", async () => {
  const db = fakeDb();
  await Q.overview(db, range);
  await Q.daily(db, range);
  await Q.features(db, range, "u1");
  await Q.users(db, { sort: "usage", q: "sa%_r'ah", limit: 50, offset: 100 });
  await Q.recent(db, 50);
  await Q.userByEmail(db, "a@b.co");
  await Q.userSessions(db, "u1"); await Q.userEvents(db, "u1"); await Q.userFeaturesAllTime(db, "u1");
  for (const c of db.calls) assert.ok(!/sa%_r/.test(c.text) && !/'ah/.test(c.text), "search text never lands in SQL: " + c.text.slice(0, 60));
  const users = db.find(/^select u\.email/);
  assert.match(users.text, /order by u\.total_active_seconds desc/);
  assert.deepEqual(users.params, ["%sa\\%\\_r'ah%", 50, 100]);
  assert.deepEqual(db.find(/^with days as/).params, ["2026-09-01", "2026-09-20", "America/Chicago"]);
  assert.deepEqual(db.find(/^select coalesce\(feature/).params, ["2026-09-01", "2026-09-20", "America/Chicago", "u1"]);
});

test("an unknown sort falls back to most recent", async () => {
  const db = fakeDb();
  await Q.users(db, { sort: "1; drop table users" });
  assert.match(db.last().text, /order by u\.last_seen_at desc/);
});

test("an inherited property name is not a sort", async () => {
  for (const sort of ["constructor", "toString", "hasOwnProperty", "__proto__", "valueOf", "nonsense"]) {
    const db = fakeDb();
    await Q.users(db, { sort });
    const { text } = db.last();
    assert.match(text, /order by u\.last_seen_at desc limit \$2 offset \$3/, `sort=${sort} must fall back: ` + text);
    assert.ok(!/\[native code\]/.test(text), `sort=${sort} interpolated a function into the SQL: ` + text);
    assert.ok(!/\[object Object\]/.test(text), `sort=${sort} interpolated an object into the SQL: ` + text);
    assert.equal(Q.orderClause(sort), "u.last_seen_at desc");
  }
  assert.equal(Q.orderClause(undefined), "u.last_seen_at desc");
  assert.equal(Q.orderClause("usage"), "u.total_active_seconds desc, u.last_seen_at desc");
});

test("feature rankings exclude automatic events", async () => {
  const db = fakeDb();
  await Q.features(db, range);
  assert.match(db.last().text, /event_name not in \('page_view','route_changed','application_opened','nav_clicked'\)/);
});

test("migrations run once each, in order, and are recorded", async () => {
  let applied = [];
  const db = fakeDb((t, p) => {
    if (/select name from schema_migrations/.test(t)) return applied.map(name => ({ name }));
    if (/insert into schema_migrations/.test(t)) applied.push(p[0]);
  });
  const first = await applyMigrations(db);
  assert.deepEqual(first, ["0001_init.sql", "0002_admin_login_failures.sql"]);
  const n = db.calls.length;
  const second = await applyMigrations(db);
  assert.deepEqual(second, []);
  assert.equal(db.calls.length, n + 2, "the second run only checks");
  assert.ok(db.calls.some(c => /create table if not exists usage_events/.test(c.text)));
});

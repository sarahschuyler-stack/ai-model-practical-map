import { test } from "node:test";
import assert from "node:assert/strict";
import { makeHandler, IDENTITY_DAYS } from "../api/identify.js";
import { req, res, fakeDb, ORIGIN, USER } from "./helpers.mjs";

const url = "/api/identify";
const okDb = (n = 0) => fakeDb(text => {
  if (/insert into users/.test(text)) return [{ id: USER }];
  if (/count\(\*\)::int as n from identity_tokens/.test(text)) return [{ n }];
});

test("rejects non-POST and foreign browser origins; answers preflight", async () => {
  const h = makeHandler(okDb());
  let r = res(); await h(req({ method: "GET", url }), r); assert.equal(r.statusCode, 405);
  r = res(); await h(req({ url, origin: "https://evil.example", body: { v: 1, email: "a@b.co" } }), r); assert.equal(r.statusCode, 403);
  r = res(); await h(req({ method: "OPTIONS", url, origin: ORIGIN }), r); assert.equal(r.statusCode, 204); assert.equal(r.getHeader("access-control-allow-origin"), ORIGIN);
});

test("the identity lasts seven days", () => { assert.equal(IDENTITY_DAYS, 7); });

test("a valid email upserts the user on the normalised address and returns a token; only its hash is stored", async () => {
  const db = okDb();
  const h = makeHandler(db);
  const r = res();
  await h(req({ url, origin: ORIGIN, body: { v: 1, email: " Sarah@Example.com " } }), r);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.getHeader("access-control-allow-origin"), ORIGIN);
  const out = JSON.parse(r.body);
  assert.match(out.token, /^[A-Za-z0-9_-]{43}$/);
  const days = (Date.parse(out.exp) - Date.now()) / 864e5;
  assert.ok(days > 6.9 && days < 7.1, "expires in seven days");
  const upsert = db.find(/insert into users/);
  assert.match(upsert.text, /on conflict \(normalized_email\)/);
  assert.deepEqual(upsert.params, ["Sarah@Example.com", "sarah@example.com"]);
  const ins = db.find(/insert into identity_tokens/);
  assert.ok(Buffer.isBuffer(ins.params[0]) && ins.params[0].length === 32, "sha256 of the token, not the token");
  assert.equal(ins.params[1], USER);
  assert.ok(!JSON.stringify(db.calls).includes(out.token), "the raw token never reaches the database");
});

test("8. two spellings of one email hit the same conflict key", async () => {
  const db = okDb();
  const h = makeHandler(db);
  for (const e of ["sarah@example.com", "SARAH@example.COM"]) await h(req({ url, body: { v: 1, email: e } }), res());
  const keys = db.calls.filter(c => /insert into users/.test(c.text)).map(c => c.params[1]);
  assert.deepEqual(keys, ["sarah@example.com", "sarah@example.com"]);
});

test("bad input gives 400 and never touches the database", async () => {
  const db = okDb();
  const h = makeHandler(db);
  for (const body of [{ v: 1, email: "nope" }, { v: 2, email: "a@b.co" }, "not json", "x".repeat(2000)]) {
    const r = res(); await h(req({ url, body }), r);
    assert.equal(r.statusCode, 400, JSON.stringify(body).slice(0, 30));
  }
  assert.equal(db.calls.length, 0);
});

test("more than twenty sign-ins an hour for one address is rate limited", async () => {
  const r = res();
  await makeHandler(okDb(20))(req({ url, body: { v: 1, email: "a@b.co" } }), r);
  assert.equal(r.statusCode, 429);
});

test("a database failure is a generic 500", async () => {
  const r = res();
  await makeHandler(fakeDb(() => { throw new Error("connection refused: secret-host"); }))(req({ url, body: { v: 1, email: "a@b.co" } }), r);
  assert.equal(r.statusCode, 500);
  assert.ok(!r.body.includes("secret-host"));
});

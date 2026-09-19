import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeEmail, parseEnvelope, parseIdentify, BadRequest } from "../lib/validate.js";
import { browserFamily } from "../lib/ua.js";
import { splitStatements } from "../lib/migrate.js";
import { readFileSync } from "node:fs";

const TOKEN = "b".repeat(43);
const base = { v: 1, type: "start", sid: "sid-12345678", token: TOKEN, ts: new Date().toISOString(), path: "/x/", hash: "#a", ref: "", tz: "UTC" };
const env = o => parseEnvelope(JSON.stringify({ ...base, ...o }));

test("8. the same email in different case and spacing normalises to one user key", () => {
  assert.deepEqual(normalizeEmail(" Sarah@Example.com "), { email: "Sarah@Example.com", normalized: "sarah@example.com" });
  assert.equal(normalizeEmail("sarah@example.com").normalized, normalizeEmail("SARAH@EXAMPLE.COM").normalized);
  for (const bad of ["", "nope", "a@b", "a b@c.com", null, "x@".padEnd(300, "y") + ".com"]) assert.equal(normalizeEmail(bad), null, String(bad));
});

test("parseIdentify requires v:1 and a valid email", () => {
  assert.equal(parseIdentify(JSON.stringify({ v: 1, email: "A@b.co" })).normalized, "a@b.co");
  assert.throws(() => parseIdentify(JSON.stringify({ v: 2, email: "a@b.co" })), BadRequest);
  assert.throws(() => parseIdentify(JSON.stringify({ v: 1, email: "nope" })), /invalid email/);
  assert.throws(() => parseIdentify("not json"), /not JSON/);
  assert.throws(() => parseIdentify(null), /too large/);
  assert.throws(() => parseIdentify("[1]"), /not an object/);
});

test("parseEnvelope accepts the page's shapes and rejects the rest", () => {
  const s = env({});
  assert.equal(s.type, "start"); assert.equal(s.sid, "sid-12345678"); assert.equal(s.active_seconds, 0);
  assert.throws(() => env({ type: "nope" }), /unknown type/);
  assert.throws(() => env({ sid: "short" }), /invalid sid/);
  assert.throws(() => env({ sid: "has space 123456" }), /invalid sid/);
  assert.throws(() => env({ token: "tiny" }), /invalid token/);
  assert.throws(() => env({ v: 0 }), /unsupported version/);
  assert.throws(() => env({ type: "beat", active_seconds: 61 }), /active_seconds/);
  assert.throws(() => env({ type: "beat", active_seconds: -1 }), /active_seconds/);
  assert.throws(() => env({ type: "beat", active_seconds: 1.5 }), /active_seconds/);
  assert.equal(env({ type: "beat", active_seconds: 30 }).active_seconds, 30);
  assert.throws(() => env({ type: "event", name: "Bad Name" }), /event name/);
  assert.throws(() => env({ type: "event" }), /event name/);
  const e = env({ type: "event", name: "prompt_copied", meta: { model_id: "opus", n: 2, ok: true, nested: { a: 1 }, "Bad Key": 1, long: "z".repeat(300) } });
  assert.equal(e.feature, "prompt");
  assert.deepEqual(Object.keys(e.meta).sort(), ["long", "model_id", "n", "ok"]);
  assert.equal(e.meta.long.length, 100);
});

test("a timestamp far from the server clock is replaced, strings are truncated", () => {
  const now = new Date("2026-09-19T12:00:00Z");
  const far = parseEnvelope(JSON.stringify({ ...base, ts: "2020-01-01T00:00:00Z", path: "p".repeat(500) }), now);
  assert.equal(far.ts.toISOString(), now.toISOString());
  assert.equal(far.path.length, 200);
  const near = parseEnvelope(JSON.stringify({ ...base, ts: "2026-09-19T11:59:00Z" }), now);
  assert.equal(near.ts.toISOString(), "2026-09-19T11:59:00.000Z");
  assert.equal(parseEnvelope(JSON.stringify({ ...base, ts: 42 }), now).ts.toISOString(), now.toISOString());
});

test("browserFamily keeps only the family, never the raw string", () => {
  assert.equal(browserFamily("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"), "Safari/macOS");
  assert.equal(browserFamily("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Edg/128.0"), "Edge/Windows");
  assert.equal(browserFamily("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"), "Safari/iOS");
  assert.equal(browserFamily(""), "");
});

test("the migration splits into one statement per table and index", () => {
  const stmts = splitStatements(readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8"));
  assert.equal(stmts.filter(s => /^create table/i.test(s)).length, 4);
  assert.equal(stmts.filter(s => /^create index/i.test(s)).length, 7);
  assert.ok(stmts.every(s => !s.includes("--")));
});

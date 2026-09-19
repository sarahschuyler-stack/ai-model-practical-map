import { test } from "node:test";
import assert from "node:assert/strict";
import { load, memStorage } from "./harness.mjs";

const URL = "https://collector.example.test";
const future = () => new Date(Date.now() + 3 * 864e5).toISOString();

/** A fetch mock that records calls and answers identify with a token. */
function collector({ identify } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, body: init && init.body ? JSON.parse(init.body) : null, init });
    if (url.endsWith("/api/identify")) {
      if (identify === "throw") throw new Error("network down");
      if (identify === "500") return { ok: false, status: 500, json: async () => ({ error: "boom" }) };
      return { ok: true, status: 200, json: async () => ({ token: "tok_abc123", exp: future() }) };
    }
    return { ok: true, status: 204, json: async () => ({}) };
  };
  return { fetch, calls, of: type => calls.filter(c => c.body && c.body.type === type) };
}

test("1. a new visitor sees the gate and the map still renders behind it", () => {
  const p = load();
  try {
    assert.equal(p.el("gate").style.display, "grid");
    assert.ok(p.document.body.classList.contains("gated"));
    assert.match(p.el("modelCards").innerHTML, /GPT-6 Astra/);
    assert.equal(p.track.active, false);
    assert.ok(p.logs.some(l => l[0] === "info" && /COLLECTOR_URL is empty/.test(l[1])));
  } finally { p.track.stop(); }
});

test("2. gate.valid normalises good addresses and rejects bad ones", () => {
  const p = load();
  assert.equal(p.gate.valid("  Sarah@Example.com "), "sarah@example.com");
  for (const bad of ["nope", "a@b", "", null, "a b@c.com", "x@".padEnd(300, "y") + ".com"]) assert.equal(p.gate.valid(bad), null, String(bad));
});

test("2b. an invalid email shows the error and stores nothing", async () => {
  const local = memStorage();
  const p = load({ storage: { local } });
  try {
    p.el("gateEmail").value = "not-an-email";
    assert.equal(await p.gate.submit(), false);
    assert.match(p.el("gateErr").textContent, /valid email/);
    assert.equal(local.getItem("pm_identity"), null);
    assert.equal(p.el("gate").style.display, "grid");
  } finally { p.track.stop(); }
});

test("3. a valid email is identified by the collector, stored, and opens the page with a start event", async () => {
  const local = memStorage(), session = memStorage();
  const c = collector();
  const p = load({ storage: { local, session }, fetch: c.fetch, collectorUrl: URL });
  try {
    p.el("gateEmail").value = "  Sarah@Example.com ";
    assert.equal(await p.gate.submit(), true);
    const id = JSON.parse(local.getItem("pm_identity"));
    assert.equal(id.email, "sarah@example.com");
    assert.equal(id.token, "tok_abc123");
    assert.equal(p.el("gate").style.display, "none");
    assert.ok(!p.document.body.classList.contains("gated"));
    assert.equal(p.el("signOut").textContent, "Switch user · sarah@example.com");
    assert.equal(c.calls[0].url, URL + "/api/identify");
    assert.deepEqual(c.calls[0].body, { v: 1, email: "sarah@example.com" });
    assert.equal(c.calls[0].init.headers["Content-Type"], "text/plain;charset=UTF-8");
    const start = c.of("start")[0];
    assert.ok(start, "start event sent");
    assert.equal(start.body.token, "tok_abc123");
    assert.equal(start.body.sid, session.getItem("pm_sid"));
    assert.equal(start.body.reason, "new");
    assert.ok(!("email" in start.body), "analytics events never carry the email");
    const names = c.of("event").map(e => e.body.name);
    assert.deepEqual(names, ["application_opened", "page_view"]);
  } finally { p.track.stop(); }
});

test("4. a refresh keeps the identity and resumes the same session", () => {
  const local = memStorage(), session = memStorage();
  local.setItem("pm_identity", JSON.stringify({ email: "sarah@example.com", token: "tok_abc123", exp: future() }));
  session.setItem("pm_sid", "sid-from-before-1");
  const c = collector();
  const p = load({ storage: { local, session }, fetch: c.fetch, collectorUrl: URL });
  try {
    assert.equal(p.el("gate").style.display, "none");
    const start = c.of("start")[0];
    assert.equal(start.body.sid, "sid-from-before-1");
    assert.equal(start.body.reason, "resume");
    assert.deepEqual(c.of("event").map(e => e.body.name), ["page_view"], "no application_opened on a resumed session");
  } finally { p.track.stop(); }
});

test("5 and 6. a returning visitor after closing the browser is not asked again and gets a new session", () => {
  const local = memStorage();
  local.setItem("pm_identity", JSON.stringify({ email: "sarah@example.com", token: "tok_abc123", exp: future() }));
  const c = collector();
  const p = load({ storage: { local }, fetch: c.fetch, collectorUrl: URL });
  try {
    assert.equal(p.el("gate").style.display, "none");
    assert.equal(c.calls.filter(x => x.url.endsWith("/api/identify")).length, 0, "identify is not called again");
    assert.equal(c.of("start")[0].body.reason, "new");
  } finally { p.track.stop(); }
});

test("an expired identity is dropped and the gate reopens", () => {
  const local = memStorage();
  local.setItem("pm_identity", JSON.stringify({ email: "sarah@example.com", token: "tok_old", exp: new Date(Date.now() - 1000).toISOString() }));
  const p = load({ storage: { local } });
  try {
    assert.equal(p.el("gate").style.display, "grid");
    assert.equal(local.getItem("pm_identity"), null);
  } finally { p.track.stop(); }
});

test("7. switching user ends the session, forgets the identity and reopens the gate", () => {
  const local = memStorage(), session = memStorage();
  local.setItem("pm_identity", JSON.stringify({ email: "sarah@example.com", token: "tok_abc123", exp: future() }));
  const c = collector();
  const p = load({ storage: { local, session }, fetch: c.fetch, collectorUrl: URL });
  try {
    p.el("signOut").onclick();
    assert.equal(local.getItem("pm_identity"), null);
    assert.equal(session.getItem("pm_sid"), null);
    assert.equal(p.el("gate").style.display, "grid");
    assert.equal(p.el("signOut").textContent, "Switch user");
    const end = p.navigator._beacons.map(b => b.url);
    assert.ok(end.length === 1 && end[0].endsWith("/api/track"), "end goes out as a beacon");
    assert.equal(p.track.active, false);
  } finally { p.track.stop(); }
});

test("16. collector failures never block the visitor", async () => {
  for (const mode of ["throw", "500"]) {
    const local = memStorage();
    const c = collector({ identify: mode });
    const p = load({ storage: { local }, fetch: c.fetch, collectorUrl: URL });
    try {
      p.el("gateEmail").value = "sarah@example.com";
      assert.equal(await p.gate.submit(), true, mode);
      assert.equal(p.el("gate").style.display, "none", mode);
      const id = JSON.parse(local.getItem("pm_identity"));
      assert.equal(id.token, null);
      assert.ok(Date.parse(id.exp) - Date.now() < 2 * 864e5, "local-only identity lasts a day, then identify is retried");
      assert.equal(c.of("start").length, 0, "nothing is tracked without a token");
      assert.equal(p.trackEvent("prompt_copied", { model_id: "opus" }), false);
    } finally { p.track.stop(); }
  }
});

test("16b. a token-less identity is retried at boot and upgraded", async () => {
  const local = memStorage();
  local.setItem("pm_identity", JSON.stringify({ email: "sarah@example.com", token: null, exp: future() }));
  const c = collector();
  const p = load({ storage: { local }, fetch: c.fetch, collectorUrl: URL });
  try {
    await new Promise(r => setTimeout(r, 0));
    assert.equal(JSON.parse(local.getItem("pm_identity")).token, "tok_abc123");
    assert.equal(c.of("start").length, 1);
  } finally { p.track.stop(); }
});

test("with COLLECTOR_URL empty the gate works offline and nothing is fetched", async () => {
  const local = memStorage();
  let fetched = 0;
  const p = load({ storage: { local }, fetch: async () => { fetched++; throw new Error("no"); } });
  try {
    p.el("gateEmail").value = "sarah@example.com";
    assert.equal(await p.gate.submit(), true);
    assert.equal(p.el("gate").style.display, "none");
    const id = JSON.parse(local.getItem("pm_identity"));
    assert.equal(id.token, null);
    assert.ok(Date.parse(id.exp) - Date.now() > (p.IDENTITY_DAYS - 1) * 864e5);
    assert.equal(fetched, 0);
    assert.equal(p.trackEvent("chooser_cleared"), false);
  } finally { p.track.stop(); }
});

test("the identity lasts seven days", () => {
  const p = load();
  assert.equal(p.IDENTITY_DAYS, 7);
});

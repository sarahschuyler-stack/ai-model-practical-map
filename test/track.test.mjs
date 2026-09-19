import { test } from "node:test";
import assert from "node:assert/strict";
import { load, memStorage } from "./harness.mjs";

const URL = "https://collector.example.test";
const future = () => new Date(Date.now() + 3 * 864e5).toISOString();

/** Boot the page already signed in, with a recording fetch. */
function signedIn(opts = {}) {
  const local = memStorage(), session = memStorage();
  local.setItem("pm_identity", JSON.stringify({ email: "sarah@example.com", token: "tok_abc123", exp: future() }));
  const calls = [];
  const fetch = opts.fetch || (async (url, init) => { calls.push({ url, body: JSON.parse(init.body), init }); return { ok: true, status: 204 }; });
  const p = load({ storage: { local, session }, fetch, collectorUrl: URL });
  const beacons = () => p.navigator._beacons.map(b => ({ url: b.url, body: null }));
  return { p, calls, of: type => calls.filter(c => c.body.type === type), events: () => calls.filter(c => c.body.type === "event").map(c => c.body), beacons };
}

async function beaconBodies(p) { return Promise.all(p.navigator._beacons.map(async b => JSON.parse(await b.blob.text()))); }

test("9. a session starts once, ends after five idle minutes, and the next activity starts a fresh one", () => {
  const s = signedIn();
  const { p } = s;
  try {
    assert.equal(s.of("start").length, 1);
    const first = p.track.sid;
    p.track.lastActivity = Date.now() - p.TRACK_IDLE_MS;
    p.track.tick();
    assert.equal(p.track.active, false);
    assert.equal(p.sessionStorage.getItem("pm_sid"), null);
    p.document.fire("click");
    assert.equal(p.track.active, true);
    assert.notEqual(p.track.sid, first);
    assert.equal(s.of("start").length, 2);
    assert.equal(s.of("start")[1].body.reason, "new");
  } finally { p.track.stop(); }
});

test("10. hash navigation and nav clicks are tracked; page_view once", () => {
  const s = signedIn();
  const { p } = s;
  try {
    p.window.location.hash = "#price";
    p.window.fire("hashchange");
    const ev = s.events();
    assert.deepEqual(ev.map(e => e.name), ["application_opened", "page_view", "route_changed"]);
    assert.equal(ev[2].meta.to, "#price");
    assert.equal(ev[2].feature, "route");
  } finally { p.track.stop(); }
});

test("11. active time accrues while visible and recently active, and ships as a summarised beat", () => {
  const s = signedIn();
  const { p } = s;
  try {
    for (let i = 0; i < 30; i++) p.track.tick();
    const beats = s.of("beat");
    assert.equal(beats.length, 1, "one beat after TRACK_BEAT_MS of ticks");
    assert.equal(beats[0].body.active_seconds, 30);
    assert.equal(beats[0].init.keepalive, true);
    assert.equal(beats[0].init.headers["Content-Type"], "text/plain;charset=UTF-8");
    assert.equal(p.track.unsent, 0);
  } finally { p.track.stop(); }
});

test("12. a hidden tab accrues nothing; a background flush sends only what was earned", async () => {
  const s = signedIn();
  const { p } = s;
  try {
    p.document.visibilityState = "hidden";
    for (let i = 0; i < 40; i++) p.track.tick();
    assert.equal(s.of("beat").length, 0, "no beat with zero active seconds");
    p.document.visibilityState = "visible";
    for (let i = 0; i < 5; i++) p.track.tick();
    p.document.visibilityState = "hidden";
    p.document.fire("visibilitychange");
    const bodies = await beaconBodies(p);
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].type, "beat");
    assert.equal(bodies[0].active_seconds, 5);
  } finally { p.track.stop(); }
});

test("pagehide ends the session by beacon but keeps the sid so a reload resumes", async () => {
  const s = signedIn();
  const { p } = s;
  try {
    const sid = p.track.sid;
    p.window.fire("pagehide");
    const bodies = await beaconBodies(p);
    assert.equal(bodies[0].type, "end");
    assert.equal(bodies[0].reason, "pagehide");
    assert.equal(p.sessionStorage.getItem("pm_sid"), sid);
    assert.equal(p.track.end("again"), false, "a second end sends nothing");
  } finally { p.track.stop(); }
});

test("end falls back to keepalive fetch when sendBeacon is missing", () => {
  const s = signedIn();
  const { p } = s;
  try {
    p.navigator.sendBeacon = undefined;
    p.track.end("signout");
    const end = s.of("end")[0];
    assert.ok(end);
    assert.equal(end.init.keepalive, true);
  } finally { p.track.stop(); }
});

test("trackEvent validates names and metadata and never sends the task text", () => {
  const s = signedIn();
  const { p } = s;
  try {
    assert.equal(p.trackEvent("Bad Name"), false);
    assert.equal(p.trackEvent("x"), false);
    assert.equal(p.trackEvent("chooser_recommended", { signals: "code,depth", task_chars: 120, preset: false, nested: { a: 1 }, long: "y".repeat(500), "Bad Key": 1 }), true);
    const ev = s.events().find(e => e.name === "chooser_recommended");
    assert.deepEqual(Object.keys(ev.meta).sort(), ["long", "preset", "signals", "task_chars"]);
    assert.equal(ev.meta.long.length, 100);
    assert.equal(ev.feature, "chooser");
  } finally { p.track.stop(); }
});

test("the chooser, prompt builder and recheck emit their named events", () => {
  const s = signedIn();
  const { p } = s;
  try {
    p.el("task").value = "Fix a bug in the repo and run tests";
    p.el("recommend").onclick();
    p.el("wizSkipAll").onclick();
    p.el("copyPrompt").onclick();
    p.el("editAnswers").onclick();
    p.el("recheck").onclick();
    p.el("rcReset").onclick();
    p.el("clear").onclick();
    const names = s.events().map(e => e.name);
    for (const n of ["chooser_recommended", "prompt_built", "prompt_copied", "prompt_edited", "recheck_opened", "recheck_reset", "chooser_cleared"]) assert.ok(names.includes(n), n);
    const rec = s.events().find(e => e.name === "chooser_recommended");
    assert.match(rec.meta.signals, /code/);
    assert.equal(rec.meta.task_chars, 35);
    assert.ok(!JSON.stringify(s.calls).includes("Fix a bug"), "the task text is never sent");
  } finally { p.track.stop(); }
});

test("a 401 from the collector expires the identity and reopens the gate", async () => {
  const local = memStorage();
  local.setItem("pm_identity", JSON.stringify({ email: "sarah@example.com", token: "tok_revoked", exp: future() }));
  const p = load({ storage: { local }, fetch: async () => ({ ok: false, status: 401 }), collectorUrl: URL });
  try {
    await new Promise(r => setTimeout(r, 0));
    assert.equal(p.el("gate").style.display, "grid");
    assert.equal(local.getItem("pm_identity"), null);
    assert.equal(p.track.active, false);
  } finally { p.track.stop(); }
});

test("a fetch that throws does not break tracking or the page", () => {
  const s = signedIn({ fetch: () => { throw new Error("offline"); } });
  const { p } = s;
  try {
    assert.equal(p.trackEvent("prompt_copied", { model_id: "opus" }), true);
    p.el("task").value = "research the market";
    p.el("recommend").onclick();
    assert.match(p.el("cheap").innerHTML, /capability match/);
  } finally { p.track.stop(); }
});

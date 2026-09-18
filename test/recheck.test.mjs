import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const p = load();
const good = { checked_through: "2026-09-17", changes: [{ kind: "price", model: "opus", title: "Opus price cut", summary: "Input $5 to $4", effective: "2026-09-10", source: "https://www.anthropic.com/pricing", confidence: "high", patch: { input: 4 } }] };

test("parseResult accepts fenced JSON and JSON wrapped in prose", () => {
  const fenced = "Here you go:\n```json\n" + JSON.stringify(good) + "\n```\nHope that helps.";
  const prose = "Sure! " + JSON.stringify(good) + " Let me know if you need more.";
  for (const t of [fenced, prose]) {
    const r = p.parseResult(t);
    assert.equal(r.through, "2026-09-17");
    assert.equal(r.changes.length, 1);
    assert.deepEqual(r.changes[0].patch, { input: 4 });
  }
});

test("parseResult tells truncated JSON apart from missing JSON", () => {
  assert.throws(() => p.parseResult("The model said nothing useful."), /no JSON object found/);
  const cut = JSON.stringify(good).slice(0, -40); // cut off mid-object, still contains an inner "}"
  assert.throws(() => p.parseResult(cut), /incomplete.*cut off/);
  assert.throws(() => p.parseResult('{"checked_through": "2026-09-17", "changes": [{"kind": "pri'), /incomplete/);
  assert.throws(() => p.parseResult('{"a": tru}'), /could not be parsed/);
});

test("hostile or malformed changes are neutralised", () => {
  const r = p.parseResult(JSON.stringify({ checked_through: "2026-09-17", changes: [
    { kind: "price", model: "opus", title: "js", source: "javascript:alert(1)", patch: { input: 4 } },
    { kind: "capability", model: "opus", title: "range", patch: { depth: 99, value: -3, costTier: 9, id: "astra", color: "red" } },
    { kind: "price", model: "not-a-model", title: "unknown", patch: { input: 1 } },
    { kind: "new-model", new_id: "half", title: "incomplete", patch: { name: "Half", input: 1, output: 2 } },
    { kind: "functionality", model: "opus", title: "note only" },
    "garbage", null,
  ] }));
  const [js, range, unknown, half, note] = r.changes;
  assert.equal(js.source, null, "javascript: URLs are dropped");
  assert.deepEqual(range.patch, { depth: 10, value: 0 }, "scores clamp to 0-10; bad tier, id and color dropped");
  assert.equal(unknown.patch, null); assert.match(unknown.note, /not tied to a model/);
  assert.equal(half.patch, null); assert.match(half.note, /incomplete new-model/);
  assert.equal(note.patch, null); assert.match(note.note, /no concrete field change/);
  assert.equal(r.changes.length, 5, "non-object entries are skipped");
});

test("a missing or malformed checked_through falls back to today", () => {
  const r = p.parseResult(JSON.stringify({ changes: [] }));
  assert.equal(r.through, p.todayIso());
  assert.match(p.todayIso(), /^\d{4}-\d{2}-\d{2}$/);
});

test("exampleCost handles null prices on either side", () => {
  assert.equal(p.exampleCost({ input: 10, output: 50 }), "$1.500");
  assert.equal(p.exampleCost({ input: 5, output: null }), "Variable");
  assert.equal(p.exampleCost({ input: null, output: 25 }), "Variable");
});

test("tierFor bands and isoDate prefix", () => {
  assert.deepEqual([3, 8, 15, 30, 31].map(p.tierFor), [1, 2, 3, 4, 5]);
  assert.equal(p.isoDate("2026-09-17T10:00:00Z"), "2026-09-17");
  assert.equal(p.isoDate("yesterday"), null);
});

test("applying a price patch updates the model, the table and the stamp; reset restores the snapshot", () => {
  const q = load();
  q.el("rcPaste").value = JSON.stringify(good);
  q.el("rcLoad").onclick();
  assert.match(q.el("rcFound").textContent, /1 change found/);
  q.el("rcApply").onclick();
  assert.equal(q.models.find(m => m.id === "opus").input, 4);
  assert.match(q.el("pricingRows").innerHTML, /\$4\.00/);
  assert.match(q.el("viewDate").textContent, /September 17, 2026/);
  assert.ok(q.localStorage.getItem("pm_recheck").includes('"input":4'));
  q.el("rcReset").onclick();
  assert.equal(q.models.find(m => m.id === "opus").input, 5);
  assert.equal(q.localStorage.getItem("pm_recheck"), null);
});

function fakeFetch(script) {
  const calls = [];
  const f = async (url, opts) => {
    calls.push({ url, opts, body: JSON.parse(opts.body) });
    const step = script[Math.min(calls.length - 1, script.length - 1)];
    return { ok: step.status < 400, status: step.status, json: async () => step.data };
  };
  f.calls = calls;
  return f;
}
const textReply = (extra = {}) => ({ model: "claude-opus-5", stop_reason: "end_turn", content: [{ type: "text", text: '{"checked_through":"2026-09-17","changes":[]}' }], usage: { input_tokens: 10, output_tokens: 5, server_tool_use: { web_search_requests: 4 } }, ...extra });

test("callClaude sends an abort signal and logs a one-line run summary", async () => {
  const f = fakeFetch([{ status: 200, data: textReply() }]);
  const q = load({ fetch: f });
  const out = await q.callClaude("k", "claude-opus-5", "prompt", () => {});
  assert.equal(out.searches, 4);
  assert.ok(f.calls[0].opts.signal instanceof AbortSignal, "fetch gets an AbortSignal for the timeout");
  assert.equal(f.calls[0].body.max_tokens, 16000);
  const summary = q.logs.find(l => l[0] === "info" && l[1] === "[recheck]");
  assert.ok(summary, "console.info summary emitted");
  assert.equal(summary[2].web_searches, 4);
  assert.equal(summary[2].stop_reason, "end_turn");
});

test("callClaude reports a reply cut off at the output limit instead of handing it to the parser", async () => {
  const q = load({ fetch: fakeFetch([{ status: 200, data: textReply({ stop_reason: "max_tokens" }) }]) });
  await assert.rejects(q.callClaude("k", "claude-opus-5", "p", () => {}), /cut off at the 16,000-token output limit/);
});

test("callClaude continues a paused turn and retries once without the fallback option", async () => {
  const f = fakeFetch([
    { status: 400, data: { error: { message: "fallbacks is not supported" } } },
    { status: 200, data: { stop_reason: "pause_turn", content: [{ type: "server_tool_use" }] } },
    { status: 200, data: textReply() },
  ]);
  const q = load({ fetch: f });
  const statuses = [];
  const out = await q.callClaude("k", "claude-opus-5", "p", s => statuses.push(s));
  assert.equal(f.calls.length, 3);
  assert.ok(!("fallbacks" in f.calls[1].body), "fallback option removed after the 400");
  assert.ok(!("anthropic-beta" in f.calls[1].opts.headers), "beta header removed with it");
  assert.equal(f.calls[2].body.messages.length, 2, "paused assistant turn resent");
  assert.match(statuses[0], /continuation 1 of 5/);
  assert.match(out.text, /checked_through/);
});

test("network failure surfaces as a readable error", async () => {
  const q = load({ fetch: async () => { throw new TypeError("Failed to fetch"); } });
  await assert.rejects(q.callClaude("k", "m", "p", () => {}), /network error: Failed to fetch/);
});

test("Apply keeps two different changes that share a title, and reports true duplicates as skipped", () => {
  const q = load();
  const load2 = (changes) => { q.el("rcPaste").value = JSON.stringify({ checked_through: "2026-09-17", changes }); q.el("rcLoad").click(); q.el("rcApply").click(); };
  load2([{ kind: "price", model: "opus", title: "Price update", summary: "Input $5 to $4", patch: { input: 4 } }]);
  assert.match(q.el("rcStatus").textContent, /^Applied 1 change\. Current view/);
  // Same headline, different content: must be kept.
  load2([{ kind: "price", model: "opus", title: "Price update", summary: "Output $25 to $20", patch: { output: 20 } }]);
  assert.equal(q.rc.state.applied.length, 2);
  assert.equal(q.models.find(m => m.id === "opus").output, 20);
  assert.match(q.el("rcStatus").textContent, /^Applied 1 change\./);
  // Exact replay of an earlier change: skipped, and the status line says so instead of counting it.
  load2([{ kind: "price", model: "opus", title: "Price update", summary: "Input $5 to $4", patch: { input: 4 } }]);
  assert.equal(q.rc.state.applied.length, 2);
  assert.match(q.el("rcStatus").textContent, /Applied 0 changes\. 1 was already applied earlier and skipped\./);
  assert.ok(q.sameChange(q.rc.state.applied[0], q.rc.state.applied[0]));
  assert.ok(!q.sameChange(q.rc.state.applied[0], q.rc.state.applied[1]));
});

test("callClaude names the continuation budget when the search never finishes, not a parsing error", async () => {
  const paused = { status: 200, data: { stop_reason: "pause_turn", content: [{ type: "server_tool_use" }] } };
  const f = fakeFetch([paused, paused, paused, paused, paused, paused, paused]);
  const q = load({ fetch: f });
  await assert.rejects(q.callClaude("k", "claude-opus-5", "p", () => {}), /still running after 5 continuations/);
  assert.equal(f.calls.length, 6, "one initial call plus five continuations");
  const summary = q.logs.find(l => l[0] === "info" && l[1] === "[recheck]");
  assert.equal(summary[2].continuations, 5);
});

test("the applied-change list is capped: oldest entries drop first, with a console warning, and state stays replayable", () => {
  const q = load();
  const many = Array.from({ length: q.MAX_APPLIED + 5 }, (_, i) => ({ kind: "capability", model: "opus", title: "tweak " + i, summary: "s" + i, patch: { depth: (i % 100) / 10 } }));
  q.el("rcPaste").value = JSON.stringify({ checked_through: "2026-09-17", changes: many });
  q.el("rcLoad").click();
  q.el("rcApply").click();
  assert.equal(q.rc.state.applied.length, q.MAX_APPLIED);
  assert.equal(q.rc.state.applied[0].title, "tweak 5", "the five oldest were dropped");
  assert.ok(q.logs.some(l => l[0] === "warn" && /capped at 200; dropped the 5 oldest/.test(l[1])));
  const saved = JSON.parse(q.localStorage.getItem("pm_recheck"));
  assert.equal(saved.applied.length, q.MAX_APPLIED);
  // The last applied patch wins on replay, in a fresh load from the same storage.
  const q2 = load({ storage: { local: q.localStorage } });
  assert.equal(q2.models.find(m => m.id === "opus").depth, ((q.MAX_APPLIED + 4) % 100) / 10);
});

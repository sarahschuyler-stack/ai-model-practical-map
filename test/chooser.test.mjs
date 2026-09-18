import { test } from "node:test";
import assert from "node:assert/strict";
import { load, presets } from "./harness.mjs";

const p = load();
const pick = t => { const r = p.recommend(t); return [r.cheap.name, r.premium.name, r.balanced.name]; };
const signals = t => Object.fromEntries(Object.entries(p.recommend(t).n).filter(([, v]) => v > 0));

test("keywords match on word boundaries: substring traps produce no signals", () => {
  for (const t of [
    "rapidly compile a list of capital cities",          // "api" inside rapidly / capital
    "the newest contest results",                         // "test" inside contest
    "a concurrent webhook handler",                       // "current" inside concurrent, "web" inside webhook
    "welcome message for the webinar",                    // "web" inside webinar
    "apply the prefix rule",                              // "fix" inside prefix
  ]) assert.deepEqual(signals(t), {}, t);
});

test("real keywords still fire, including plurals and word-initial stems", () => {
  const n = p.recommend("debug the API, run the tests, then search the web for current sources").n;
  assert.ok(n.code >= 4.4, "api + debug + test(s)");
  assert.ok(n.breadth >= 4.4 && n.research >= 4.4, "search + web + current + sources");
  assert.ok(p.recommend("explain the reasoning").n.depth > 0, "reason matches reasoning");
});

test("the stakes signal is shared: Step 1 depth need and Step 2 complexity agree", () => {
  const t = presets()["Executive analysis"].toLowerCase();
  const r = p.recommend(t);
  const cx = p.complexity(r.n, t);
  assert.ok(r.n.depth >= 6, "chooser sees the job as deep, depth=" + r.n.depth);
  assert.ok(cx >= 6, "Step 2 sees the job as hard, cx=" + cx);
  assert.ok(Math.abs(r.n.depth - cx) < 1.5, "the two panels no longer contradict each other");
  assert.ok(p.matchSignals(r.n).length > 0, "at least one signal chip is shown");
});

test("golden: preset picks (cheap / premium / balanced). Changing tuning must update this on purpose.", () => {
  const pr = presets();
  assert.deepEqual(pick(pr["Wide research"]),      ["Gemini 3.8 Flash", "Grok 4.6",    "Grok 4.6"]);
  assert.deepEqual(pick(pr["Deep coding"]),        ["DeepSeek V4 family", "GPT-6 Astra", "DeepSeek V4 family"]);
  assert.deepEqual(pick(pr["Huge document set"]),  ["Gemini 3.8 Flash", "GPT-6 Astra", "Gemini 3.8 Flash"]);
  assert.deepEqual(pick(pr["Routine build"]),      ["Gemini 3.8 Flash", "GPT-6 Astra", "Claude Sonnet 5"]);
  assert.deepEqual(pick(pr["Executive analysis"]), ["Gemini 3.8 Flash", "GPT-6 Astra", "Grok 4.6"]);
  assert.deepEqual(pick(pr["Agent orchestration"]),["Gemini 3.8 Flash", "GPT-6 Astra", "Gemini 3.8 Flash"]);
});

test("golden: preset signal bands", () => {
  const pr = presets();
  const n = k => p.recommend(pr[k]).n;
  assert.ok(n("Wide research").breadth >= 9 && n("Wide research").research >= 9);
  assert.ok(n("Deep coding").code >= 8 && n("Deep coding").depth >= 6);
  assert.ok(n("Huge document set").long >= 8);
  assert.ok(n("Routine build").discipline >= 8);
  assert.ok(n("Agent orchestration").agent >= 6);
});

test("an input with no signals shows the general-purpose notice; a real task hides it", () => {
  const q = load();
  q.el("task").value = "write a birthday poem";
  q.el("recommend").onclick();
  assert.equal(q.el("chooserNote").style.display, "block");
  assert.match(q.el("cheap").innerHTML, /general-purpose task/);
  q.el("task").value = presets()["Deep coding"];
  q.el("recommend").onclick();
  assert.equal(q.el("chooserNote").style.display, "none");
  q.el("clear").onclick();
  assert.equal(q.el("chooserNote").style.display, "none");
});

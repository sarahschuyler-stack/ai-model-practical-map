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
  assert.deepEqual(pick(pr["Routine build"]),      ["DeepSeek V4 family", "Claude Sonnet 5", "Claude Sonnet 5"]);
  assert.deepEqual(pick(pr["Executive analysis"]), ["Gemini 3.8 Flash", "GPT-6 Astra", "Grok 4.6"]);
  assert.deepEqual(pick(pr["Agent orchestration"]),["Gemini 3.8 Flash", "GPT-6 Astra", "Gemini 3.8 Flash"]);
});

/* The eight axes a need-vector carries, in the order capability() weights them. */
const AXES = ["breadth", "depth", "agent", "code", "long", "research", "multi", "discipline"];
const vector = over => Object.fromEntries(AXES.map(k => [k, over.includes(k) ? 10 : 0]));
/* all-zeros, all-tens, every single-axis maximum and every double-axis maximum: 1 + 1 + 8 + 28 = 38. */
const probeVectors = () => {
  const v = [{ label: "all-zeros", n: vector([]) }, { label: "all-tens", n: vector(AXES) }];
  AXES.forEach(a => v.push({ label: a, n: vector([a]) }));
  for (let i = 0; i < AXES.length; i++) for (let j = i + 1; j < AXES.length; j++)
    v.push({ label: `${AXES[i]}+${AXES[j]}`, n: vector([AXES[i], AXES[j]]) });
  return v;
};

test("the capability threshold actually excludes models on demanding jobs", () => {
  const v = probeVectors();
  assert.equal(v.length, 38, "the probe is the documented 38 vectors");
  let discriminating = 0;
  for (const { label, n } of v) {
    const t = p.capableThreshold(n);
    const below = p.models.filter(m => p.capability(m, n) < t);
    if (below.length) discriminating++;
    if (label === "all-zeros") assert.equal(below.length, 0, "a brief that asks for nothing rules nobody out");
    assert.ok(below.length < p.models.length, `${label} leaves at least one capable model`);
  }
  // Before the fix this was 0 of 38: the 0.8 need floor put every model in a 7.5-9.9 band whatever the job.
  assert.ok(discriminating >= 30, `only ${discriminating} of 38 vectors exclude anyone`);
});

/* Free-text jobs a real visitor might type, spanning the shapes the chooser claims to tell apart. */
const JOBS = {
  coding: "Debug a failing API endpoint in our TypeScript repo and implement the fix with tests.",
  legal: "Review hundreds of contracts and case file PDFs, reconcile contradictions and flag the clauses that matter.",
  longContext: "Summarise a 700,000 token codebase with a million token context window in one pass.",
  liveResearch: "Research current competitors across the web, Reddit and social sources and find the latest news about them.",
  agentic: "Run a long-running autonomous agent that calls tools, executes multi-step workflows and keeps going end-to-end.",
  writing: "Write and polish a warm personal essay in my own voice about learning to bake sourdough.",
  bulk: "Classify a million short support messages into ten buckets. Keep cost low; it is a straightforward routine job.",
  gibberish: "florp the wibbly grondle, quaxing sideways",
};

test("picks vary with the job: the cheap and balanced slots are not fixed", () => {
  const triples = Object.fromEntries(Object.entries(JOBS).map(([k, t]) => [k, pick(t)]));
  const distinct = new Set(Object.values(triples).map(x => x.join("|")));
  // Before the fix all eight jobs produced one of only two cheap picks and a near-constant triple.
  assert.ok(distinct.size >= 6, `only ${distinct.size} distinct pick-triples: ${[...distinct].join("  /  ")}`);
  // The cheap slot sorts by cost tier first, so on jobs both tier-1 models can do it can only ever be one of those two;
  // what the fix buys is that the threshold now decides WHICH, and escalates out of tier 1 when neither clears the bar.
  assert.ok(new Set(Object.values(triples).map(x => x[0])).size >= 2, "the cheap slot moves with the job");
  assert.ok(new Set(Object.values(triples).map(x => x[2])).size >= 4, "the balanced slot moves with the job");
  // Pure writing has no axis of its own in this model, so it lands on the general-purpose default, same as gibberish.
  assert.deepEqual(triples.writing, triples.gibberish, "no writing axis exists; both fall back to the default");
});

test("a gibberish job still falls back to the general-purpose default", () => {
  const r = p.recommend(JOBS.gibberish);
  assert.deepEqual(p.matchSignals(r.n), [], "nothing in it signals anything");
  const none = p.recommend("");
  assert.deepEqual(pick(JOBS.gibberish), pick(""), "same picks as a brief with no opinion at all");
  // With no needs at all, capability() scores the model's overall profile rather than dividing by zero.
  for (const m of p.models) assert.ok(Number.isFinite(p.capability(m, none.n)), m.name + " scores a finite capability");
});

test("a single unambiguous long-context cue surfaces long-context models", () => {
  const n = p.recommend(JOBS.longContext).n;
  // One "million token" hit scores 2.2, which the old `n.long > 3` gate sat just above, so it was discarded entirely.
  assert.ok(n.long >= 6, "one 'million token' hit is no longer discarded, long=" + n.long);
  const cap = m => p.capability(m, n);
  const holders = p.models.filter(m => m.long >= 9.7), shorter = p.models.filter(m => m.long <= 8.5);
  assert.ok(shorter.length && holders.length, "the roster has both kinds of model");
  const worstHolder = Math.min(...holders.map(cap)), bestShort = Math.max(...shorter.map(cap));
  assert.ok(worstHolder > bestShort, `long-context models rank above short ones (${worstHolder} vs ${bestShort})`);
  const nemotron = p.models.find(m => m.id === "nemotron");
  assert.ok(cap(nemotron) > bestShort, "Nemotron 3 Ultra (long 10) now beats every short-context model");
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

test("keywords are matched literally even when they contain regex characters", () => {
  assert.ok(p.hasWord("port the c++ module", "c++"));
  assert.ok(!p.hasWord("the ccc module", "c++"), "+ is not a quantifier");
  assert.ok(p.hasWord("migrate to node.js today", "node.js"));
  assert.ok(!p.hasWord("nodexjs", "node.js"), ". is not a wildcard");
  assert.ok(p.hasWord("costs $5 each", "$5"));
});

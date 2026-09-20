// The prompt forge: the optional Fable 5.1 pass that rewrites the built-in draft into a
// doctorate-level brief for whichever model the user is targeting. The rules that matter are
// that the draft is never lost, that a stale brief is dropped rather than shown for the wrong
// model, and that the call itself is an authoring call — no web search, Fable, with the system
// contract attached.
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const JOB = "Read a very large codebase, find the root cause of an intermittent accounting bug, challenge the architecture, implement a safe fix and verify it with tests.";
const FORGED = "# Role\nYou are the executing model. Do the thing properly.";

function reply(text, extra = {}) {
  return { model: "claude-fable-5-1", stop_reason: "end_turn", content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 5 }, ...extra };
}
function fakeFetch(steps) {
  const calls = [];
  let i = 0;
  const f = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url, body, opts });
    const s = steps[Math.min(i++, steps.length - 1)];
    return { ok: s.status < 400, status: s.status, json: async () => s.data };
  };
  f.calls = calls;
  return f;
}
// Walk the page the way a user does: describe the job, get recommendations, skip to the prompt.
function atOutput(fetchImpl) {
  const p = load({ fetch: fetchImpl });
  p.el("task").value = JOB;
  p.el("recommend").onclick();
  p.el("wizSkipAll").onclick();
  return p;
}

test("the built-in draft is what you see before any forge call, and the Fable panel offers to rewrite it", () => {
  const p = atOutput();
  assert.equal(p.forge.view, "draft");
  assert.match(p.el("promptOut").value, /^# Role/, "the deterministic draft is in the box");
  assert.equal(p.el("fgViews").style.display, "none", "no version toggle until there is something to toggle");
  assert.equal(p.el("fgRun").textContent, "Forge with Fable");
  assert.equal(p.el("fgTarget").textContent, p.resolveTarget().m.name);
});

test("forging sends an authoring call to Fable — no web search, the system contract attached — and shows the result", async () => {
  const f = fakeFetch([{ status: 200, data: reply(FORGED) }]);
  const p = atOutput(f);
  const draft = p.el("promptOut").value;
  p.el("fgKey").value = "sk-ant-test";
  await p.el("fgRun").onclick();

  const body = f.calls[0].body;
  assert.equal(body.model, "claude-fable-5-1", "the forge always runs on Fable, whatever the target model is");
  assert.ok(!("tools" in body), "authoring needs no web search tool");
  assert.equal(body.max_tokens, p.FORGE_MAX_TOKENS);
  assert.match(body.system, /principal prompt engineer/);
  assert.match(body.system, /Acceptance criteria/);
  assert.match(body.system, /Failure modes/);

  const sent = body.messages[0].content;
  const target = p.resolveTarget().m;
  assert.match(sent, new RegExp("Name: " + target.name), "the target model is named so the brief is tuned to it");
  assert.ok(sent.includes(JOB), "the requester's own words go through verbatim");
  assert.ok(sent.includes(draft), "the deterministic draft goes along as the floor to beat");

  assert.equal(p.el("promptOut").value, FORGED, "the box now shows the Fable brief");
  assert.equal(p.forge.view, "forged");
  assert.equal(p.el("fgViews").style.display, "flex", "both versions are reachable");
  assert.match(p.el("fgMeta").textContent, /claude-fable-5-1/);
});

test("both versions stay available, and edits to each survive a toggle", async () => {
  const p = atOutput(fakeFetch([{ status: 200, data: reply(FORGED) }]));
  const draft = p.el("promptOut").value;
  p.el("fgKey").value = "sk-ant-test";
  await p.el("fgRun").onclick();

  p.el("promptOut").value = FORGED + "\nEdited the Fable one.";
  p.el("fgDraft").onclick();
  assert.equal(p.el("promptOut").value, draft, "back to the untouched built-in draft");

  p.el("promptOut").value = draft + "\nEdited the draft.";
  p.el("fgForged").onclick();
  assert.match(p.el("promptOut").value, /Edited the Fable one\./, "the edited Fable version came back, not the original");
  p.el("fgDraft").onclick();
  assert.match(p.el("promptOut").value, /Edited the draft\./, "and so did the edited draft");
});

test("a failed forge leaves the draft in place and says so", async () => {
  const p = atOutput(async () => { throw new TypeError("Failed to fetch"); });
  const draft = p.el("promptOut").value;
  p.el("fgKey").value = "sk-ant-test";
  await p.el("fgRun").onclick();
  assert.equal(p.el("promptOut").value, draft, "the prompt the user already had is untouched");
  assert.match(p.el("fgStatus").textContent, /Fable could not write this one: network error/);
  assert.match(p.el("fgStatus").textContent, /draft below is unchanged/);
  assert.equal(p.el("fgViews").style.display, "none");
});

test("no key is an explanation, not a lost prompt", async () => {
  const p = atOutput();
  const draft = p.el("promptOut").value;
  await p.el("fgRun").onclick();
  assert.match(p.el("fgStatus").textContent, /needs one/);
  assert.equal(p.el("promptOut").value, draft);
});

test("switching the target model drops the brief written for the old one", async () => {
  const p = atOutput(fakeFetch([{ status: 200, data: reply(FORGED) }]));
  p.el("fgKey").value = "sk-ant-test";
  await p.el("fgRun").onclick();
  assert.equal(p.forge.view, "forged");

  const before = p.resolveTarget().m.id;
  const other = p.qsa(".target").find(b => b.dataset.t !== p.pb.target && p.pb.rec[b.dataset.t] && p.pb.rec[b.dataset.t].id !== before);
  other.onclick();
  assert.notEqual(p.resolveTarget().m.id, before, "the target really changed");
  assert.equal(p.forge.forged, "", "the stale brief is gone");
  assert.equal(p.forge.view, "draft");
  assert.match(p.el("fgStatus").textContent, /Forge again/);
  assert.match(p.el("promptOut").value, /^# Role/, "the draft for the new target is showing");
});

test("a reply wrapped in a code fence despite the contract is unwrapped, and stray whitespace trimmed", () => {
  const p = load();
  assert.equal(p.stripFence("```markdown\n# Role\nDo it.\n```"), "# Role\nDo it.");
  assert.equal(p.stripFence("```\n# Role\n```"), "# Role");
  assert.equal(p.stripFence("  # Role\nUse ```code``` inline.  "), "# Role\nUse ```code``` inline.");
  assert.equal(p.stripFence(""), "");
});

test("the key is remembered for the tab only when asked, and shared with the Recheck field on load", async () => {
  const p = atOutput(fakeFetch([{ status: 200, data: reply(FORGED) }]));
  p.el("fgKey").value = "sk-ant-test";
  p.el("fgRemember").checked = true;
  await p.el("fgRun").onclick();
  assert.equal(p.sessionStorage.getItem("pm_apikey"), "sk-ant-test");
  assert.equal(p.localStorage.getItem("pm_apikey"), null, "never written to disk");

  const back = load({ storage: { session: p.sessionStorage, local: p.localStorage } });
  assert.equal(back.el("fgKey").value, "sk-ant-test");
  assert.equal(back.el("rcKey").value, "sk-ant-test");
});

// Drives the page the way a user does: presses buttons, ticks boxes, walks
// the wizard. These are the handlers the September 2026 review found
// invisible to the suite because the old harness returned [] from every
// querySelectorAll.
import { test } from "node:test";
import assert from "node:assert/strict";
import { load, presets } from "./harness.mjs";

const startFrom = (name) => {
  const q = load();
  q.el("task").value = presets()[name];
  q.el("recommend").click();
  return q;
};

test("preset buttons fill the task box and run the chooser", () => {
  const q = load();
  const buttons = q.qsa(".preset");
  assert.equal(buttons.length, 6, "six presets wired from the static markup");
  buttons[1].click();
  assert.equal(q.el("task").value, presets()["Deep coding"]);
  assert.equal(q.el("results").style.display, "grid");
  assert.match(q.el("premium").innerHTML, /GPT-6 Astra/);
  assert.equal(q.el("prompt").style.display, "block", "Step 2 opens after Step 1");
});

test("plan buttons change the subscription verdict and are remembered", () => {
  const q = startFrom("Deep coding");
  const claudeCard = q.el("subs").querySelectorAll(".subcard").find(c => c.dataset.s === "claude");
  const max = claudeCard.querySelectorAll(".plan").find(b => b.dataset.p === "max100");
  assert.ok(!max.classList.contains("on"), "Pro is the default plan");
  max.click();
  assert.equal(q.pb.plans.claude, "max100");
  assert.deepEqual(JSON.parse(q.localStorage.getItem("pm_plans")), { chatgpt: "plus", claude: "max100" });
  const again = q.el("subs").querySelectorAll(".subcard").find(c => c.dataset.s === "claude");
  assert.ok(again.querySelectorAll(".plan").find(b => b.dataset.p === "max100").classList.contains("on"), "re-render marks the new plan");
  // A fresh load in the same browser starts from the saved plan.
  const q2 = load({ storage: { local: q.localStorage } });
  q2.el("task").value = presets()["Deep coding"]; q2.el("recommend").click();
  assert.equal(q2.pb.plans.claude, "max100");
});

test("ladder rungs and target chips retarget the prompt", () => {
  const q = startFrom("Routine build");
  const rung = q.el("subs").querySelectorAll(".rung").find(b => b.dataset.t === "m:claude:opus");
  rung.click();
  assert.equal(q.pb.target, "m:claude:opus");
  assert.match(q.el("wizard").innerHTML, /Prompt for Claude Opus 5/);
  const chip = q.el("targets").querySelectorAll(".target").find(b => b.dataset.t === "premium");
  chip.click();
  assert.equal(q.pb.target, "premium");
  assert.ok(chip.className.includes("target"));
  // "Best regardless of price" for a routine, spec-following build is now Claude Sonnet 5, not GPT-6 Astra: the capability
  // score reflects the job's axes (discipline 8.8, code 4.4), and Sonnet leads discipline 9.8 to Astra's 9.0. The chip still
  // retargets — the prompt above this line was addressed to Claude Opus 5.
  assert.match(q.el("wizard").innerHTML, /Prompt for Claude Sonnet 5/);
});

test("the wizard records choices and text, steps back and forth, and produces a prompt", () => {
  const q = startFrom("Deep coding");
  q.el("wizText").value = "a merged fix with passing tests";
  q.el("wizNext").click();
  assert.equal(q.pb.answers.outcome, "a merged fix with passing tests");
  assert.equal(q.pb.step, 1);
  const choice = q.el("wizard").querySelectorAll(".choice")[0];
  choice.click();
  assert.equal(q.pb.answers.format, "Code changes with explanation");
  assert.ok(q.el("wizard").querySelectorAll(".choice")[0].classList.contains("on"), "selected choice is highlighted");
  q.el("wizBack").click();
  assert.equal(q.pb.step, 0);
  assert.equal(q.el("wizText").value, "a merged fix with passing tests", "text answers survive Back");
  q.el("wizSkipAll").click();
  assert.equal(q.el("output").style.display, "block");
  assert.equal(q.el("wizard").style.display, "none");
  const out = q.el("promptOut").value;
  assert.match(out, /^# Role/);
  assert.match(out, /# Goal\nThe job, in the requester's words:\n> .*intermittent accounting bug/);
  assert.match(out, /Format: Code changes with explanation\./);
  assert.match(out, /Definition of done: a merged fix with passing tests/);
  assert.match(q.el("outTitle").textContent, /Prompt for .* · Best practical overall/);
});

test("Edit answers reopens the wizard where it was; Copy prompt writes to the clipboard", async () => {
  const q = startFrom("Deep coding");
  q.el("wizSkipAll").click();
  q.el("editAnswers").click();
  assert.equal(q.el("output").style.display, "none");
  assert.match(q.el("wizard").innerHTML, /Question 1 of/);
  q.el("wizSkipAll").click();
  await q.el("copyPrompt").onclick();
  assert.equal(q.copied.length, 1);
  assert.equal(q.copied[0], q.el("promptOut").value);
  assert.ok(q.el("copied").classList.contains("show"), "the Copied indicator lights up");
  clearTimeout(q.pb.ct); // the 1.8s hide timer would otherwise keep the test process alive
});

test("a subscription target explains where to run the prompt", () => {
  const q = startFrom("Executive analysis");
  q.el("targets").querySelectorAll(".target").find(b => b.dataset.t === "chatgpt").click();
  q.el("wizSkipAll").click();
  assert.match(q.el("outTitle").textContent, /Your ChatGPT/);
  assert.match(q.el("tips").innerHTML, /Where to run it|Fallback tier|Using this with/);
  q.el("editAnswers").click();
  q.el("targets").querySelectorAll(".target").find(b => b.dataset.t === "claude").click();
  q.el("wizSkipAll").click();
  assert.match(q.el("outTitle").textContent, /Your Claude/);
  assert.doesNotMatch(q.el("tips").innerHTML, /Codex/);
});

test("Clear hides results and Step 2", () => {
  const q = startFrom("Wide research");
  q.el("clear").click();
  assert.equal(q.el("task").value, "");
  assert.equal(q.el("results").style.display, "none");
  assert.equal(q.el("prompt").style.display, "none");
});

const twoChanges = { checked_through: "2026-09-17", changes: [
  { kind: "price", model: "opus", title: "Opus price cut", summary: "Input $5 to $4", patch: { input: 4 } },
  { kind: "price", model: "sonnet", title: "Sonnet price cut", summary: "Input $2 to $1.5", patch: { input: 1.5 } },
] };

test("Recheck checkboxes and Select none / Select all control what Apply writes", () => {
  const q = load();
  q.el("recheck").click();
  assert.equal(q.el("rc").style.display, "block");
  q.el("rcPaste").value = JSON.stringify(twoChanges);
  q.el("rcLoad").click();
  const rows = q.el("changes").querySelectorAll(".change");
  assert.equal(rows.length, 2);
  assert.ok(rows.every(r => r.querySelector("input").checked), "everything starts ticked");
  q.el("rcNone").click();
  assert.ok(q.rc.changes.every(c => !c.selected));
  assert.ok(q.el("changes").querySelectorAll(".change").every(r => !r.querySelector("input").checked));
  q.el("rcAll").click();
  // Clicking the row (not the box) toggles it; clicking the box itself fires onchange.
  const [first, second] = q.el("changes").querySelectorAll(".change");
  first.click();
  assert.equal(q.rc.changes.find(c => c.model === "opus").selected, false);
  assert.ok(!first.classList.contains("on"));
  const box = second.querySelector("input"); box.checked = false; box.onchange();
  assert.equal(q.rc.changes.find(c => c.model === "sonnet").selected, false);
  box.checked = true; box.onchange();
  q.el("rcApply").click();
  assert.equal(q.rc.state.applied.length, 1);
  assert.equal(q.rc.state.applied[0].model, "sonnet");
  assert.equal(q.models.find(m => m.id === "opus").input, 5, "unticked change not applied");
  assert.equal(q.models.find(m => m.id === "sonnet").input, 1.5);
  assert.equal(q.rc.changes.length, 1, "applied rows leave the list; the unticked one stays");
  q.el("rcClose").click();
  assert.equal(q.el("rc").style.display, "none");
});

test("resolveTarget carries the subscription key so output text does not depend on label wording", () => {
  const q = startFrom("Executive analysis");
  assert.equal(q.resolveTarget().sub, null);
  q.pb.target = "chatgpt";
  assert.equal(q.resolveTarget().sub, "chatgpt");
  q.pb.target = "m:claude:opus";
  const rt = q.resolveTarget();
  assert.equal(rt.sub, "claude");
  assert.equal(rt.m.id, "opus");
  // Renaming a subscription must not change which advice the output shows.
  q.pb.target = "chatgpt"; q.el("wizSkipAll").click();
  const before = q.el("tips").innerHTML;
  q.el("editAnswers").click();
  const saved = q.pb.subs; q.el("wizSkipAll").click();
  assert.equal(q.el("tips").innerHTML, before);
  assert.equal(q.pb.subs, saved);
});

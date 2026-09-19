// Storage failures used to be swallowed in four empty catch blocks
// (review weakness #3). These tests run the page against a storage that
// throws on every call, as a browser with site data blocked does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { load, presets, blockedStorage } from "./harness.mjs";

const warnings = q => q.logs.filter(l => l[0] === "warn" && String(l[1]).startsWith("[storage]"));

test("blocked storage at boot is reported once in the console and once on the page, and the map still renders", () => {
  const q = load({ storage: { local: blockedStorage(), session: blockedStorage() } });
  assert.equal(q.models.length, 12, "published snapshot still drawn");
  assert.match(q.el("modelCards").innerHTML, /GPT-6 Astra/);
  assert.equal(q.el("storageNote").style.display, "block");
  assert.match(q.el("storageNote").textContent, /not letting the page save/);
  assert.ok(warnings(q).length >= 1, "console warning emitted");
});

test("a failed Recheck save still applies the change for this visit and tells the user it will not persist", () => {
  const q = load({ storage: { local: blockedStorage() } });
  q.el("rcPaste").value = JSON.stringify({ checked_through: "2026-09-17", changes: [{ kind: "price", model: "opus", title: "cut", summary: "s", patch: { input: 4 } }] });
  q.el("rcLoad").click();
  q.el("rcApply").click();
  assert.equal(q.models.find(m => m.id === "opus").input, 4, "applied in memory");
  assert.match(q.el("storageNote").textContent, /applied Recheck changes/);
  assert.equal(warnings(q).filter(w => /applied Recheck changes/.test(w[1])).length, 1, "boot read and this save share one cause, logged once");
  q.el("rcReset").click();
  assert.equal(q.models.find(m => m.id === "opus").input, 5);
});

test("a failed plan save is reported and the same cause is only logged once", () => {
  const q = load({ storage: { local: blockedStorage() } });
  q.el("task").value = presets()["Deep coding"]; q.el("recommend").click();
  // The plan read failed once already; two saves now fail in a row. The card re-renders between them so re-query each time.
  q.el("subs").querySelectorAll(".plan").find(b => b.dataset.p === "max100").click();
  q.el("subs").querySelectorAll(".plan").find(b => b.dataset.p === "max200").click();
  assert.equal(q.pb.plans.claude, "max200", "the choice still works for this visit");
  assert.equal(warnings(q).filter(w => /plan choices/.test(w[1])).length, 1, "one read and two write failures of the same cause are logged once");
  assert.match(q.el("storageNote").textContent, /plan choices/);
});

test("unreadable saved Recheck state falls back to the snapshot with a warning", () => {
  const local = { getItem: k => (k === "pm_recheck" ? "{not json" : null), setItem() {}, removeItem() {} };
  const q = load({ storage: { local } });
  assert.deepEqual(q.rc.state, { asOf: "2026-09-16", applied: [] });
  assert.ok(warnings(q).some(w => /applied Recheck changes/.test(w[1])));
});

test("a working browser shows no storage notice", () => {
  const q = load();
  q.el("task").value = presets()["Deep coding"]; q.el("recommend").click();
  assert.equal(q.el("storageNote").style.display, "none");
  assert.equal(warnings(q).length, 0);
});

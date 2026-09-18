import { test } from "node:test";
import assert from "node:assert/strict";
import { load, presets } from "./harness.mjs";

test("inline script loads, boots, and renders the published snapshot", () => {
  const p = load();
  assert.equal(p.models.length, 12);
  assert.equal(p.PUBLISHED_AS_OF, "2026-09-16");
  assert.match(p.el("modelCards").innerHTML, /GPT-6 Astra/);
  assert.match(p.el("pricingRows").innerHTML, /Claude Opus 5/);
  assert.equal(p.document.title, "AI Model Practical Map — September 2026");
});

test("all six presets are present and each produces three picks", () => {
  const p = load();
  const pr = presets();
  assert.equal(Object.keys(pr).length, 6);
  for (const text of Object.values(pr)) {
    const r = p.recommend(text);
    for (const k of ["cheap", "premium", "balanced"]) assert.ok(r[k] && r[k].name, k);
  }
});

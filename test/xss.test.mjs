import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const PAYLOAD = '<img src=x onerror=alert(1)>';
const hostile = { name: PAYLOAD, desc: PAYLOAD, best: PAYLOAD, tags: [PAYLOAD] };
const SCORES = Object.fromEntries(["breadth","depth","agent","code","long","research","multi","discipline","value"].map(k => [k, 5]));

test("cleanPatch keeps HTML as text and never admits id or color", () => {
  const p = load();
  const out = p.cleanPatch({ ...hostile, id: "astra", color: "red", input: 1, output: 2 });
  assert.equal(out.name, PAYLOAD, "text is preserved as data; escaping happens at render time");
  assert.ok(!("id" in out) && !("color" in out));
});

test("a hostile Recheck patch renders as literal text in cards, pricing and results", () => {
  const p = load();
  const ch = p.normalizeChange({ kind: "capability", model: "opus", title: "x", patch: hostile }, 0);
  p.rc.state.applied.push(ch);
  p.applyState();
  for (const id of ["modelCards", "pricingRows"]) {
    const html = p.el(id).innerHTML;
    assert.ok(html.includes("&lt;img"), id + " escapes");
    assert.ok(!html.includes("<img"), id + " has no raw tag");
  }
  const r = p.recommend("difficult production coding bug");
  const m = { ...p.models.find(x => x.id === "opus"), cap: 9 };
  const el = p.el("premium");
  p.renderRec(el, "02", m, r.n, "premium");
  assert.ok(el.innerHTML.includes("&lt;img") && !el.innerHTML.includes("<img"), "renderRec escapes");
});

test("a hostile new-model entry (name, vendor, tags) renders escaped", () => {
  const p = load();
  const ch = p.normalizeChange({ kind: "new-model", new_id: "evil", vendor: PAYLOAD, title: "t", patch: { ...hostile, input: 1, output: 2, ...SCORES } }, 1);
  assert.ok(ch.patch, "new-model entry accepted");
  p.rc.state.applied.push(ch);
  p.applyState();
  assert.equal(p.models.length, 13);
  const cards = p.el("modelCards").innerHTML, rows = p.el("pricingRows").innerHTML;
  assert.ok(!cards.includes("<img") && !rows.includes("<img"));
  assert.ok(cards.includes("&lt;img") && rows.includes("&lt;img"));
});

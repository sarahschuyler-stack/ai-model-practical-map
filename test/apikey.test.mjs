import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; };
const okReply = { model: "claude-opus-5", stop_reason: "end_turn", content: [{ type: "text", text: '{"checked_through":"2026-09-17","changes":[]}' }], usage: { server_tool_use: { web_search_requests: 3 } } };
const mockFetch = () => async () => ({ ok: true, status: 200, json: async () => okReply });

test("a legacy key left in localStorage is purged at boot and not prefilled", () => {
  const local = mem(); local.setItem("pm_apikey", "sk-ant-old");
  const p = load({ storage: { local } });
  assert.equal(local.getItem("pm_apikey"), null);
  assert.equal(p.el("rcKey").value, "");
  assert.equal(p.el("rcRemember").checked, false);
});

test("a key remembered in sessionStorage is restored for this tab only", () => {
  const session = mem(); session.setItem("pm_apikey", "sk-ant-tab");
  const p = load({ storage: { session } });
  assert.equal(p.el("rcKey").value, "sk-ant-tab");
  assert.equal(p.el("rcRemember").checked, true);
});

test("running a recheck with remember ticked writes the key to sessionStorage, never localStorage", async () => {
  const local = mem(), session = mem();
  const p = load({ storage: { local, session }, fetch: mockFetch() });
  p.el("rcKey").value = "sk-ant-live"; p.el("rcRemember").checked = true; p.el("rcModel").value = "claude-opus-5";
  await p.el("rcRun").onclick();
  assert.equal(session.getItem("pm_apikey"), "sk-ant-live");
  assert.equal(local.getItem("pm_apikey"), null);
  assert.equal(local.getItem("pm_rcmodel"), "claude-opus-5");
  assert.match(p.el("rcThrough").textContent, /September 17, 2026/);
});

test("running a recheck with remember unticked clears any remembered key", async () => {
  const session = mem(); session.setItem("pm_apikey", "sk-ant-tab");
  const p = load({ storage: { session }, fetch: mockFetch() });
  p.el("rcKey").value = "sk-ant-live"; p.el("rcRemember").checked = false;
  await p.el("rcRun").onclick();
  assert.equal(session.getItem("pm_apikey"), null);
});

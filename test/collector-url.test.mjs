// The harness used to inject the collector URL by string-replacing the exact text
// `const COLLECTOR_URL = "";`, so the whole gate and tracking suite only loaded while the
// analytics feature was switched off. collector/README.md step 6 tells the operator to edit
// that constant to a deployed URL — which silently broke the tests. These tests pin the fix:
// the harness matches the declaration by identifier, and the suite behaves the same whatever
// value index.html ships.
import { test } from "node:test";
import assert from "node:assert/strict";
import { load, memStorage, pageScript, pageCollectorUrl, withCollectorUrl } from "./harness.mjs";

const DEPLOYED = "https://practical-map-collector.vercel.app";

/** index.html as it would look after collector/README.md step 6. */
const deployedPage = withCollectorUrl(pageScript, DEPLOYED);

test("the page ships a COLLECTOR_URL the harness can read", () => {
  assert.equal(typeof pageCollectorUrl(), "string");
});

test("withCollectorUrl rewrites the declaration whatever value it currently holds", () => {
  for (const before of ['const COLLECTOR_URL = "";', `const COLLECTOR_URL = "${DEPLOYED}";`,
                        "const COLLECTOR_URL='http://localhost:3000';", "const   COLLECTOR_URL = `x`  ;"]) {
    const after = withCollectorUrl(before, "https://c.example");
    assert.match(after, /COLLECTOR_URL\s*=\s*"https:\/\/c\.example"/, before);
    assert.equal(after.includes(DEPLOYED), false, before);
  }
  assert.throws(() => withCollectorUrl("const OTHER = 1;", "https://c.example"), /COLLECTOR_URL/);
});

test("with the collector deployed, the page still runs with tracking off when the harness asks", () => {
  const p = load({ pageSource: deployedPage });
  try {
    assert.equal(p.COLLECTOR_URL, "");
    assert.ok(p.logs.some(l => l[0] === "info" && /COLLECTOR_URL is empty/.test(l[1])));
  } finally { p.track.stop(); }
});

test("with the collector deployed, the harness can still inject its own URL", async () => {
  const local = memStorage(), session = memStorage(), calls = [];
  const fetch = async (url, init) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => ({ token: "tok_abc123", exp: new Date(Date.now() + 3 * 864e5).toISOString() }) };
  };
  const p = load({ pageSource: deployedPage, storage: { local, session }, fetch, collectorUrl: "https://collector.example.test" });
  try {
    assert.equal(p.COLLECTOR_URL, "https://collector.example.test");
    p.el("gateEmail").value = "sarah@example.com";
    assert.equal(await p.gate.submit(), true);
    assert.ok(calls.some(u => u === "https://collector.example.test/api/identify"), calls.join(","));
    assert.equal(calls.some(u => u.startsWith(DEPLOYED)), false, "the committed value must not leak into the run");
  } finally { p.track.stop(); }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { html, load } from "./harness.mjs";

/** The connect-src sources from the page's Content-Security-Policy meta tag. */
function connectSrc() {
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
  assert.ok(m, "CSP meta tag present");
  const directive = m[1].split(";").map(s => s.trim()).find(s => s.startsWith("connect-src "));
  assert.ok(directive, "connect-src directive present");
  return directive.split(/\s+/).slice(1);
}

function allowed(origin, sources) {
  return sources.some(s => s === origin || (s.startsWith("https://*.") && origin.endsWith(s.slice("https://*".length)) && origin.startsWith("https://")));
}

test("the CSP lets the page reach Anthropic and the collector, and nothing else", () => {
  const src = connectSrc();
  assert.ok(allowed("https://api.anthropic.com", src));
  assert.ok(allowed("https://practical-map-collector.vercel.app", src), "a Vercel-hosted collector is reachable");
  assert.ok(!allowed("https://evil.example", src));
  assert.ok(!src.includes("*") && !src.includes("'self'"), "no blanket allowance");
});

test("whatever COLLECTOR_URL is set to is covered by the CSP", () => {
  const p = load();
  if (!p.COLLECTOR_URL) return; // empty in the repository; this guards the day it is filled in
  const origin = new URL(p.COLLECTOR_URL).origin;
  assert.ok(allowed(origin, connectSrc()), `${origin} must be listed in connect-src in the CSP meta tag, or every request will be blocked`);
});

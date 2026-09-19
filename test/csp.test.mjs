import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { html, pageCollectorUrl } from "./harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const readme = readFileSync(join(here, "..", "README.md"), "utf8");

/** The whole policy string from the page's Content-Security-Policy meta tag. */
function policy() {
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
  assert.ok(m, "CSP meta tag present");
  return m[1];
}

/** The policy the Security model section of README.md quotes as the one the page ships. */
function documentedPolicy() {
  const m = readme.match(/```\n\s*(default-src[^`]*?)\n\s*```/);
  assert.ok(m, "README.md quotes the policy in a fenced block starting with default-src");
  return m[1].trim();
}

/** The connect-src sources from the page's Content-Security-Policy meta tag. */
function connectSrc() {
  const directive = policy().split(";").map(s => s.trim()).find(s => s.startsWith("connect-src "));
  assert.ok(directive, "connect-src directive present");
  return directive.split(/\s+/).slice(1);
}

function allowed(origin, sources) {
  return sources.some(s => s === origin || (s.startsWith("https://*.") && origin.endsWith(s.slice("https://*".length)) && origin.startsWith("https://")));
}

test("README.md documents the policy the page actually ships, byte for byte", () => {
  // The two drifted apart once already: the README claimed connect-src was limited to api.anthropic.com
  // while the tag also allowed https://*.vercel.app. Whoever changes one must change the other.
  assert.equal(policy(), documentedPolicy());
});

test("the CSP lets the page reach Anthropic, and nothing else", () => {
  const src = connectSrc();
  assert.ok(allowed("https://api.anthropic.com", src));
  assert.ok(!allowed("https://evil.example", src));
  assert.ok(!src.includes("*") && !src.includes("'self'"), "no blanket allowance");
});

test("connect-src names exact origins, never a shared multi-tenant wildcard", () => {
  // A collector origin gets added here at deploy time (collector/README.md step 6). Wildcards such as
  // https://*.vercel.app cover every app anyone has deployed to that domain, so an escaping slip could
  // beacon page state to a stranger; the exfiltration guarantee in the README only holds for exact origins.
  for (const s of connectSrc()) {
    assert.ok(!s.includes("*"), `${s} is a wildcard; name the one exact collector origin instead`);
    assert.doesNotThrow(() => new URL(s), `${s} is not an absolute origin`);
    assert.equal(new URL(s).origin, s.replace(/\/+$/, ""), `${s} should be a bare origin`);
  }
});

test("whatever COLLECTOR_URL is set to is covered by the CSP", () => {
  // Read the committed literal rather than the harness's, which always runs the script with tracking off.
  const shipped = pageCollectorUrl();
  if (!shipped) return; // empty in the repository; this guards the day it is filled in
  const origin = new URL(shipped).origin;
  assert.ok(allowed(origin, connectSrc()), `${origin} must be listed in connect-src in the CSP meta tag, or every request will be blocked`);
});

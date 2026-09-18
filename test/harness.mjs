// Loads the inline script from index.html into a stub DOM so the pure logic
// (chooser, prompt builder, Recheck parsing and rendering) can be exercised
// under `node --test` without a browser. Nothing here is served to users.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");

const start = html.lastIndexOf("<script>");
const end = html.lastIndexOf("</script>");
if (start < 0 || end < start) throw new Error("inline <script> block not found in index.html");
const source = html.slice(start + "<script>".length, end);

// Every function and constant the tests need is returned from the evaluated script.
const EXPORTS = [
  "models", "publishedModels", "PUBLISHED_AS_OF", "patterns", "stakesWords",
  "signal", "needs", "capability", "recommend", "matchSignals", "complexity", "planSubs", "buildPrompt",
  "renderModels", "renderPricing", "renderRec", "exampleCost", "esc", "$",
  "cleanPatch", "normalizeChange", "parseResult", "applyPatch", "applyState", "isoDate", "todayIso", "fmtDate", "tierFor",
  "callClaude", "recheckPrompt", "rc", "pb",
];

function makeElement(id) {
  const listeners = {};
  const el = {
    id, innerHTML: "", textContent: "", value: "", className: "", checked: false, disabled: false,
    style: {}, dataset: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, on) { on === undefined ? (this._s.has(c) ? this._s.delete(c) : this._s.add(c)) : on ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    focus() {}, blur() {}, select() {}, setSelectionRange() {}, scrollIntoView() {}, remove() {},
    querySelectorAll() { return []; }, querySelector() { return null; }, closest() { return null; },
    addEventListener(t, f) { listeners[t] = f; }, appendChild() {},
  };
  return el;
}

export function load({ fetch: fetchImpl, storage } = {}) {
  const elements = new Map();
  const document = {
    title: "",
    body: { appendChild() {} },
    getElementById(id) { if (!elements.has(id)) elements.set(id, makeElement(id)); return elements.get(id); },
    querySelectorAll() { return []; },
    createElement(tag) { return makeElement("<" + tag + ">"); },
    execCommand() { return true; },
  };
  const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; };
  const localStorage = (storage && storage.local) || mem();
  const sessionStorage = (storage && storage.session) || mem();
  const navigator = { clipboard: { writeText: async () => {} } };
  const fetch = fetchImpl || (async () => { throw new Error("fetch is not available in tests; pass a mock"); });
  const window = { location: { reload() {} } };

  const fn = new Function("document", "localStorage", "sessionStorage", "navigator", "fetch", "window",
    source + "\nreturn {" + EXPORTS.map(n => `${n}: typeof ${n} === "undefined" ? undefined : ${n}`).join(",") + "};");
  const api = fn(document, localStorage, sessionStorage, navigator, fetch, window);
  return { ...api, document, localStorage, sessionStorage, el: id => document.getElementById(id) };
}

/** The six presets exactly as the page ships them (data-preset attributes). */
export function presets() {
  const out = {};
  const re = /<button class="preset" data-preset="([^"]+)">([^<]+)<\/button>/g;
  let m; while ((m = re.exec(html))) out[m[2]] = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  return out;
}

export { html };

// Loads the inline script from index.html into a stub DOM so the page logic
// (chooser, prompt builder, Recheck parsing, rendering and the click handlers
// that wire them together) can be exercised under `node --test` without a
// browser. Nothing here is served to users.
//
// The stub DOM is deliberately small. It parses the page's own static markup
// and anything the script assigns to `innerHTML` into a tree of elements that
// support the handful of DOM calls the page makes: getElementById,
// querySelector(All) with a single simple selector (tag, .class or #id),
// closest, dataset, classList, checked/value, and click(). That is enough for
// tests to press the same buttons a user does. Earlier versions returned []
// from every querySelectorAll, which hid the whole interactive layer from the
// suite (September 2026 review, weakness #1).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");

const start = html.lastIndexOf("<script>");
const end = html.lastIndexOf("</script>");
if (start < 0 || end < start) throw new Error("inline <script> block not found in index.html");
const source = html.slice(start + "<script>".length, end);
const bodyStart = html.indexOf("<body>");
const bodyMarkup = html.slice(bodyStart + "<body>".length, start);

// Every function and constant the tests need is returned from the evaluated script.
const EXPORTS = [
  "models", "publishedModels", "PUBLISHED_AS_OF", "patterns", "stakesWords",
  "signal", "needs", "capability", "recommend", "matchSignals", "complexity", "planSubs", "buildPrompt", "hasWord",
  "analyzeJob", "playbooks", "extractRequirements", "extractExclusions", "jobHints",
  "renderModels", "renderPricing", "renderRec", "exampleCost", "esc", "$",
  "cleanPatch", "normalizeChange", "parseResult", "applyPatch", "applyState", "isoDate", "todayIso", "fmtDate", "tierFor",
  "sameChange", "MAX_APPLIED", "storageWarn",
  "callClaude", "recheckPrompt", "rc", "pb", "resolveTarget",
];

let treeVersion = 0; // bumped on every innerHTML assignment so id lookups can cache the flattened tree
const VOID = new Set(["br", "input", "img", "meta", "link", "hr", "i-void"]);
const decode = s => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function parseStyle(s) {
  const out = {};
  String(s || "").split(";").forEach(d => { const i = d.indexOf(":"); if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim(); });
  return out;
}

/** Turn an HTML string into child elements of `parent`. Handles the subset of HTML this page emits. */
function parseInto(parent, markup) {
  parent.children = [];
  parent._text = "";
  const stack = [parent];
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(markup))) {
    if (m[0].startsWith("<!--")) continue;
    const top = stack[stack.length - 1];
    if (m[5] !== undefined) { top._text += decode(m[5]); continue; }
    if (m[1]) { // closing tag: pop to the matching open element
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tagName === m[1].toUpperCase()) { stack.length = i; break; }
      continue;
    }
    const tag = m[2].toLowerCase();
    const el = makeElement(null, tag);
    el.parentNode = top;
    const attrRe = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let a;
    while ((a = attrRe.exec(m[3] || ""))) {
      const name = a[1], raw = a[2] ?? a[3] ?? a[4], val = raw === undefined ? "" : decode(raw);
      el.attributes[name] = val;
      if (name === "id") el.id = val;
      else if (name === "class") { el.className = val; val.split(/\s+/).filter(Boolean).forEach(c => el.classList.add(c)); }
      else if (name === "style") el.style = parseStyle(val);
      else if (name === "checked") el.checked = true;
      else if (name === "disabled") el.disabled = true;
      else if (name === "value") el.value = val;
      else if (name.startsWith("data-")) el.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = val;
    }
    top.children.push(el);
    if (!m[4] && !VOID.has(tag)) stack.push(el);
  }
  // A textarea's text is its value; every element exposes its own text.
  (function finish(el) {
    el.children.forEach(finish);
    if (el.tagName === "TEXTAREA" && el._text) el.value = el._text;
  })(parent);
}

function matches(el, sel) {
  if (sel.startsWith(".")) return el.classList.contains(sel.slice(1));
  if (sel.startsWith("#")) return el.id === sel.slice(1);
  return el.tagName === sel.toUpperCase();
}
function descendants(el, out = []) { for (const c of el.children) { out.push(c); descendants(c, out); } return out; }

function makeElement(id, tag = "div") {
  const listeners = {};
  let innerHTML = "";
  const el = {
    id: id || "", tagName: tag.toUpperCase(), attributes: {}, children: [], parentNode: null, _text: "",
    textContent: "", value: "", className: "", checked: false, disabled: false,
    style: {}, dataset: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, on) { on === undefined ? (this._s.has(c) ? this._s.delete(c) : this._s.add(c)) : on ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    focus() {}, blur() {}, select() {}, setSelectionRange() {}, scrollIntoView() {}, remove() {},
    querySelectorAll(sel) { return descendants(this).filter(e => matches(e, sel)); },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    closest(sel) { let e = this; while (e) { if (e.tagName && matches(e, sel)) return e; e = e.parentNode; } return null; },
    addEventListener(t, f) { listeners[t] = f; }, appendChild(c) { c.parentNode = this; this.children.push(c); },
    /** Simulate a user click: the page assigns `onclick` properties, so call that with a minimal event. */
    click() { if (typeof this.onclick === "function") this.onclick({ target: this, preventDefault() {} }); },
    get text() { return this._text + this.children.map(c => c.text).join(""); },
  };
  Object.defineProperty(el, "innerHTML", {
    get() { return innerHTML; },
    set(v) { innerHTML = String(v); parseInto(el, innerHTML); treeVersion++; },
  });
  return el;
}

const memStorage = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m };
};

/** A storage stub whose every call throws, like a browser with site data blocked. */
const blockedStorage = (msg = "Access is denied for this document") => {
  const boom = () => { throw new DOMException(msg, "SecurityError"); };
  return { getItem: boom, setItem: boom, removeItem: boom };
};

/**
 * Evaluate the page script against stubs.
 * @param {{fetch?: Function, storage?: {local?: object, session?: object}}} opts
 */
export function load({ fetch: fetchImpl, storage } = {}) {
  const root = makeElement("<root>", "body");
  root.innerHTML = bodyMarkup;
  const synthetic = new Map();
  let flatVersion = -1, flat = [];
  const all = () => { if (flatVersion !== treeVersion) { flat = descendants(root); flatVersion = treeVersion; } return flat; };
  const document = {
    title: "",
    body: root,
    getElementById(id) {
      const found = all().find(e => e.id === id);
      if (found) return found;
      if (!synthetic.has(id)) synthetic.set(id, makeElement(id));
      return synthetic.get(id);
    },
    querySelectorAll(sel) { return root.querySelectorAll(sel); },
    querySelector(sel) { return root.querySelector(sel); },
    createElement(tag) { return makeElement(null, tag); },
    execCommand() { return true; },
  };
  const localStorage = (storage && storage.local) || memStorage();
  const sessionStorage = (storage && storage.session) || memStorage();
  const copied = [];
  const navigator = { clipboard: { writeText: async t => { copied.push(t); } } };
  const fetch = fetchImpl || (async () => { throw new Error("fetch is not available in tests; pass a mock"); });
  const window = { location: { reload() {} } };
  const logs = [];
  const consoleStub = {
    log: (...a) => logs.push(["log", ...a]), info: (...a) => logs.push(["info", ...a]),
    warn: (...a) => logs.push(["warn", ...a]), error: (...a) => logs.push(["error", ...a]),
  };

  const fn = new Function("document", "localStorage", "sessionStorage", "navigator", "fetch", "window", "console",
    source + "\nreturn {" + EXPORTS.map(n => `${n}: typeof ${n} === "undefined" ? undefined : ${n}`).join(",") + "};");
  const api = fn(document, localStorage, sessionStorage, navigator, fetch, window, consoleStub);
  return { ...api, document, localStorage, sessionStorage, logs, copied, el: id => document.getElementById(id), qsa: sel => document.querySelectorAll(sel) };
}

/** The six presets exactly as the page ships them (data-preset attributes). */
export function presets() {
  const out = {};
  const re = /<button class="preset" data-preset="([^"]+)">([^<]+)<\/button>/g;
  let m; while ((m = re.exec(html))) out[m[2]] = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  return out;
}

export { html, memStorage, blockedStorage };

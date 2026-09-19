// Server-side validation of everything the page sends. The browser is never trusted:
// the user is resolved from the identity token, never from an email in the body.

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TYPES = new Set(["start", "beat", "end", "event"]);
const SID_RE = /^[A-Za-z0-9-]{8,64}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{40,50}$/;
const NAME_RE = /^[a-z][a-z0-9_]{1,48}$/;
const KEY_RE = /^[a-z][a-z0-9_]{0,30}$/;
export const MAX_BEAT_SECONDS = 60;

export class BadRequest extends Error { constructor(m) { super(m); this.status = 400; } }

/** Trim and lowercase. Nothing cleverer (no Gmail dot folding) so the rule is easy to explain. */
export function normalizeEmail(v) {
  const s = String(v == null ? "" : v).trim();
  const n = s.toLowerCase();
  if (!n || n.length > 254 || !EMAIL_RE.test(n)) return null;
  return { email: s, normalized: n };
}

export function parseJson(textBody) {
  if (textBody == null) throw new BadRequest("body too large");
  let obj;
  try { obj = JSON.parse(textBody); } catch { throw new BadRequest("body is not JSON"); }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new BadRequest("body is not an object");
  return obj;
}

const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

export function parseIdentify(textBody) {
  const o = parseJson(textBody);
  if (o.v !== 1) throw new BadRequest("unsupported version");
  const e = normalizeEmail(o.email);
  if (!e) throw new BadRequest("invalid email");
  return e;
}

/** @returns {{type,sid,token,ts:Date,path,hash,ref,tz,reason,active_seconds,name,feature,meta}} */
export function parseEnvelope(textBody, now = new Date()) {
  const o = parseJson(textBody);
  if (o.v !== 1) throw new BadRequest("unsupported version");
  if (!TYPES.has(o.type)) throw new BadRequest("unknown type");
  if (typeof o.sid !== "string" || !SID_RE.test(o.sid)) throw new BadRequest("invalid sid");
  if (typeof o.token !== "string" || !TOKEN_RE.test(o.token)) throw new BadRequest("invalid token");
  let ts = typeof o.ts === "string" ? new Date(o.ts) : new Date(NaN);
  if (isNaN(ts) || Math.abs(ts - now) > 24 * 3600 * 1000) ts = now;
  const out = {
    type: o.type, sid: o.sid, token: o.token, ts,
    path: str(o.path, 200), hash: str(o.hash, 200), ref: str(o.ref, 200), tz: str(o.tz, 64), reason: str(o.reason, 40),
    active_seconds: 0, name: null, feature: null, meta: null,
  };
  if (o.type === "beat" || o.type === "end") {
    const a = Number(o.active_seconds);
    if (!Number.isInteger(a) || a < 0 || a > MAX_BEAT_SECONDS) throw new BadRequest("invalid active_seconds");
    out.active_seconds = a;
  }
  if (o.type === "event") {
    if (typeof o.name !== "string" || !NAME_RE.test(o.name)) throw new BadRequest("invalid event name");
    out.name = o.name;
    out.feature = o.name.split("_")[0];
    const meta = {};
    let n = 0;
    if (o.meta && typeof o.meta === "object" && !Array.isArray(o.meta)) {
      for (const [k, v] of Object.entries(o.meta)) {
        if (n >= 10) break;
        if (!KEY_RE.test(k)) continue;
        if (typeof v === "string") meta[k] = v.slice(0, 100);
        else if ((typeof v === "number" && Number.isFinite(v)) || typeof v === "boolean") meta[k] = v;
        else continue;
        n++;
      }
    }
    out.meta = meta;
  }
  return out;
}

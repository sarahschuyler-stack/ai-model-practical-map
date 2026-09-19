// Small request/response helpers that work on Vercel's Node functions and on the
// plain objects the tests build. Nothing here touches the database.

export const MAX_BODY = 4096;
export const DEFAULT_ORIGIN = "https://sarahschuyler-stack.github.io";

/** Raw request body as text, or null when it is over `max` bytes. Vercel may have parsed it already. */
export async function readBody(req, max = MAX_BODY) {
  const b = req.body;
  if (typeof b === "string") return b.length > max ? null : b;
  if (Buffer.isBuffer(b)) return b.length > max ? null : b.toString("utf8");
  if (b && typeof b === "object") { const s = JSON.stringify(b); return s.length > max ? null : s; }
  if (typeof req.on !== "function") return "";
  return new Promise(resolve => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > max) { resolve(null); if (req.destroy) req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(null));
  });
}

/** Form fields from a POSTed HTML form. */
export async function formBody(req) {
  const b = req.body;
  if (b && typeof b === "object" && !Buffer.isBuffer(b)) return b;
  const text = await readBody(req, 8192);
  return text == null ? {} : Object.fromEntries(new URLSearchParams(text));
}

export function query(req) {
  const u = new URL(req.url || "/", "http://local");
  return Object.fromEntries(u.searchParams);
}

export function cookies(req) {
  const out = {};
  const raw = (req.headers && req.headers.cookie) || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function send(res, status, body, headers = {}) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(body == null ? "" : body);
}
export const json = (res, status, obj) => send(res, status, JSON.stringify(obj), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
export const html = (res, status, s) => send(res, status, s, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer" });
export const text = (res, status, s) => send(res, status, s, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
export const redirect = (res, loc) => send(res, 302, "", { Location: loc, "Cache-Control": "no-store" });

export function allowedOrigins() {
  return (process.env.ALLOWED_ORIGIN || DEFAULT_ORIGIN).split(",").map(s => s.trim()).filter(Boolean);
}

/**
 * CORS for the two write endpoints. Returns "ok" (headers set or no Origin at all, as from curl),
 * "preflight" (OPTIONS answered) or "forbidden" (a browser origin we do not serve; caller replies 403).
 */
export function cors(req, res) {
  const origin = req.headers && req.headers.origin;
  if (origin) {
    if (!allowedOrigins().includes(origin)) return "forbidden";
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
  if (req.method === "OPTIONS") { send(res, 204, ""); return "preflight"; }
  return "ok";
}

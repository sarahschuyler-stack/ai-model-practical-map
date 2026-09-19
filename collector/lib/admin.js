// Admin login for the dashboard. Gate emails are unverified, so being listed in
// ADMIN_EMAILS is never enough on its own: the admin also presents ADMIN_KEY.
// When magic-link verification exists, the key can be retired (see README).
import crypto from "node:crypto";
import { cookies } from "./http.js";

export const COOKIE = "pm_admin";
export const SESSION_SECONDS = 12 * 3600;

export function config(env = process.env) {
  const emails = String(env.ADMIN_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const key = String(env.ADMIN_KEY || "");
  const ready = emails.length > 0 && key.length >= 8;
  const secret = ready ? crypto.createHash("sha256").update("pm-admin-session:" + key).digest() : null;
  return { emails, key, ready, secret };
}

export function safeEqual(a, b) {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

export function sign(email, cfg = config(), now = Date.now()) {
  const exp = Math.floor(now / 1000) + SESSION_SECONDS;
  const payload = Buffer.from(email).toString("base64url") + "." + exp;
  const mac = crypto.createHmac("sha256", cfg.secret).update(payload).digest("base64url");
  return payload + "." + mac;
}

/** The admin email inside a valid cookie value, or null. */
export function verify(value, cfg = config(), now = Date.now()) {
  if (!cfg.ready || typeof value !== "string") return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [e, exp, mac] = parts;
  const expected = crypto.createHmac("sha256", cfg.secret).update(e + "." + exp).digest("base64url");
  if (!safeEqual(mac, expected)) return null;
  if (!/^\d+$/.test(exp) || Number(exp) * 1000 < now) return null;
  const email = Buffer.from(e, "base64url").toString("utf8");
  return cfg.emails.includes(email) ? email : null;
}

export function checkLogin(email, key, cfg = config()) {
  if (!cfg.ready) return { ok: false, reason: "not-configured" };
  const e = String(email || "").trim().toLowerCase();
  const okKey = safeEqual(key || "", cfg.key);
  const okEmail = cfg.emails.includes(e);
  return okKey && okEmail ? { ok: true, email: e } : { ok: false, reason: "bad-credentials" };
}

export function currentAdmin(req, cfg = config()) {
  return verify(cookies(req)[COOKIE], cfg);
}

export function setSessionCookie(res, value, maxAge = SESSION_SECONDS) {
  res.setHeader("Set-Cookie", `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
}

export function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

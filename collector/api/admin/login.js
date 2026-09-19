// GET /admin/login: the form. POST /admin/login: check ADMIN_EMAILS + ADMIN_KEY, set the signed cookie,
// and apply any pending database migrations so no terminal is ever needed.
import { withDb } from "../../lib/db.js";
import { formBody, html, redirect, send } from "../../lib/http.js";
import { config, checkLogin, sign, setSessionCookie, currentAdmin, MIN_KEY_LENGTH } from "../../lib/admin.js";
import { applyMigrations } from "../../lib/migrate.js";
import { sourceKey, checkThrottle, recordFailure, clearFailures, WINDOW_SECONDS } from "../../lib/throttle.js";
import { layout, esc } from "../../lib/html.js";

function page(msg, cls) {
  const cfg = config();
  const setup = cfg.ready ? "" : `<p class="err">The dashboard is not configured yet. On Vercel, set <code>ADMIN_EMAILS</code> (your email) and <code>ADMIN_KEY</code> (a password you invent, at least ${MIN_KEY_LENGTH} characters), then redeploy.</p>`;
  return layout("Admin login", `<div class="card login">
<p class="muted">Enter an admin email and the admin key set in Vercel.</p>
${setup}
<form method="post" action="/admin/login">
<label>Email<br/><input type="email" name="email" required autocomplete="username" style="width:100%"/></label>
<label>Admin key<br/><input type="password" name="admin_key" required autocomplete="current-password" style="width:100%"/></label>
<button class="primary" type="submit">Log in</button>
${msg ? `<p class="${cls || "err"}">${esc(msg)}</p>` : ""}
</form></div>`);
}

export function makeHandler(db) {
  return async (req, res) => {
    if (req.method === "GET") {
      if (currentAdmin(req)) return redirect(res, "/admin/usage");
      return html(res, 200, page());
    }
    if (req.method !== "POST") return send(res, 405, "", { Allow: "GET, POST" });
    const f = await formBody(req);
    const source = sourceKey(req, config());
    // Count first: a blocked source never gets its key checked at all, so the window
    // holds however fast the guesses arrive and across however many warm instances.
    let gate = { blocked: false, retryAfter: WINDOW_SECONDS };
    try { gate = await checkThrottle(db, source); }
    catch (e) { console.error("login throttle check failed:", e); }
    if (gate.blocked) {
      const mins = Math.max(1, Math.ceil(gate.retryAfter / 60));
      res.setHeader("Retry-After", String(gate.retryAfter));
      return html(res, 429, page(`Too many failed logins from here. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`));
    }
    const r = checkLogin(f.email, f.admin_key);
    if (!r.ok) {
      try { await recordFailure(db, source); }
      catch (e) { console.error("login throttle record failed:", e); }
      await new Promise(rs => setTimeout(rs, 300));
      return html(res, 401, page(r.reason === "not-configured"
        ? `Set ADMIN_EMAILS and ADMIN_KEY (at least ${MIN_KEY_LENGTH} characters) first.`
        : "That email and key do not match."));
    }
    try { await clearFailures(db, source); }
    catch (e) { console.error("login throttle clear failed:", e); }
    try { await applyMigrations(db); }
    catch (e) { console.error("migration failed:", e); return html(res, 500, page("Logged in, but the database setup failed: " + e.message)); }
    setSessionCookie(res, sign(r.email));
    return redirect(res, "/admin/usage");
  };
}

export default withDb(makeHandler);

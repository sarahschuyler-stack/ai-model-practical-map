// GET /admin/login: the form. POST /admin/login: check ADMIN_EMAILS + ADMIN_KEY, set the signed cookie,
// and apply any pending database migrations so no terminal is ever needed.
import { withDb } from "../../lib/db.js";
import { formBody, html, redirect, send } from "../../lib/http.js";
import { config, checkLogin, sign, setSessionCookie, currentAdmin } from "../../lib/admin.js";
import { applyMigrations } from "../../lib/migrate.js";
import { layout, esc } from "../../lib/html.js";

function page(msg, cls) {
  const cfg = config();
  const setup = cfg.ready ? "" : `<p class="err">The dashboard is not configured yet. On Vercel, set <code>ADMIN_EMAILS</code> (your email) and <code>ADMIN_KEY</code> (a password you invent, at least 8 characters), then redeploy.</p>`;
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
    const r = checkLogin(f.email, f.admin_key);
    if (!r.ok) {
      await new Promise(rs => setTimeout(rs, 300));
      return html(res, 401, page(r.reason === "not-configured" ? "Set ADMIN_EMAILS and ADMIN_KEY first." : "That email and key do not match."));
    }
    try { await applyMigrations(db); }
    catch (e) { console.error("migration failed:", e); return html(res, 500, page("Logged in, but the database setup failed: " + e.message)); }
    setSessionCookie(res, sign(r.email));
    return redirect(res, "/admin/usage");
  };
}

export default withDb(makeHandler);

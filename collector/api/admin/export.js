// GET /admin/usage/export.csv  the users table as CSV. Admin cookie required.
import { withDb } from "../../lib/db.js";
import { query, redirect, send } from "../../lib/http.js";
import { currentAdmin } from "../../lib/admin.js";
import * as Q from "../../lib/queries.js";

/** Quote a CSV cell; a leading = + - @ is prefixed so spreadsheets never treat it as a formula. */
export function cell(v) {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function makeHandler(db) {
  return async (req, res) => {
    if (req.method !== "GET") return send(res, 405, "", { Allow: "GET" });
    if (!currentAdmin(req)) return redirect(res, "/admin/login");
    const q = query(req);
    const rows = await Q.users(db, { sort: Q.SORTS.includes(q.sort) ? q.sort : "recent", q: String(q.q || "").slice(0, 100), limit: 5000, offset: 0 });
    const lines = [["email", "first_seen", "last_seen", "sessions", "total_active_seconds", "avg_session_seconds", "top_feature"].join(",")];
    for (const u of rows) lines.push([u.email, u.first_seen_at, u.last_seen_at, u.total_sessions, u.total_active_seconds, u.avg_session, u.top_feature || ""].map(cell).join(","));
    return send(res, 200, lines.join("\r\n") + "\r\n", { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="practical-map-users.csv"', "Cache-Control": "no-store" });
  };
}

export default withDb(makeHandler);

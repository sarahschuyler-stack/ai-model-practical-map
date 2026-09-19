// GET /admin/usage/user?email=  one person's detail. POST with action=delete removes all their data.
import { withDb } from "../../lib/db.js";
import { html, query, redirect, send, formBody } from "../../lib/http.js";
import { currentAdmin } from "../../lib/admin.js";
import * as Q from "../../lib/queries.js";
import { normalizeEmail } from "../../lib/validate.js";
import { layout, esc, fmtWhen, fmtDur, fmtNum, barChart, rankChart, eventLabel, featureLabel } from "../../lib/html.js";
import { parseRange, filterForm } from "./usage.js";

export function renderUser(r, u, { days, feats, sessions, events }) {
  const tiles = [
    ["First visit", fmtWhen(u.first_seen_at, r.tz)], ["Most recent visit", fmtWhen(u.last_seen_at, r.tz)], ["Sessions", fmtNum(u.total_sessions)],
    ["Total active time", fmtDur(u.total_active_seconds)], ["Avg active session", fmtDur(u.avg_session)], ["Email verified", u.email_verified_at ? "yes" : "not yet"],
  ].map(([l, n]) => `<div class="card tile"><div class="n" style="font-size:16px">${esc(n)}</div><div class="l">${esc(l)}</div></div>`).join("");
  const sessRows = sessions.map(s => `<tr><td>${esc(fmtWhen(s.started_at, r.tz))}</td><td>${esc(s.ended_at ? (s.end_reason || "ended") : "open")}</td>
<td class="num">${esc(fmtDur(s.active_seconds))}</td><td class="num">${esc(fmtNum(s.page_views))}</td><td>${esc(s.landing_page || "")}</td><td>${esc(s.referrer || "")}</td><td>${esc(s.browser || "")}</td></tr>`).join("");
  const evRows = events.map(e => `<li><time>${esc(fmtWhen(e.created_at, r.tz))}</time>${esc(eventLabel(e.event_name, e.metadata))}</li>`).join("");
  return `<p><a href="${esc("/admin/usage?tz=" + encodeURIComponent(r.tz))}">← All users</a></p>
<div class="tiles">${tiles}</div>
${filterForm({ ...r, q: undefined }, "/admin/usage/user", { email: u.normalized_email })}
<div class="charts">
${barChart("Sessions by day", days.map(d => ({ label: d.day, value: d.sessions })))}
${barChart("Active minutes by day", days.map(d => ({ label: d.day, value: d.minutes })), " min")}
${rankChart("Features used (all time)", feats.map(f => ({ label: featureLabel(f.feature), value: f.n })))}
</div>
<h2>Recent sessions</h2><div class="card tbl"><table><thead><tr><th>Started</th><th>Ended</th><th class="num">Active</th><th class="num">Views</th><th>Landing</th><th>Referrer</th><th>Browser</th></tr></thead><tbody>${sessRows || '<tr><td colspan="7" class="muted">None yet.</td></tr>'}</tbody></table></div>
<h2>Event history</h2><div class="card"><ul class="activity">${evRows || '<li class="muted">None yet.</li>'}</ul></div>
<h2>Delete this person's data</h2><div class="card"><form method="post" action="/admin/usage/user">
<input type="hidden" name="email" value="${esc(u.normalized_email)}"/><input type="hidden" name="action" value="delete"/>
<label><input type="checkbox" name="confirm" value="yes" required/> Remove ${esc(u.email)} and every session and event, permanently.</label>
<p><button class="danger" type="submit">Delete</button></p></form></div>`;
}

export function makeHandler(db) {
  return async (req, res) => {
    const admin = currentAdmin(req);
    if (!admin) return redirect(res, "/admin/login");
    if (req.method === "POST") {
      const f = await formBody(req);
      const e = normalizeEmail(f.email);
      if (!e || f.action !== "delete" || f.confirm !== "yes") return html(res, 400, layout("User", `<p class="err">Nothing deleted: tick the confirmation box first.</p>`, { admin }));
      try { await Q.deleteUser(db, e.normalized); return redirect(res, "/admin/usage"); }
      catch (err) { console.error("delete failed:", err); return html(res, 500, layout("User", `<p class="err">Delete failed: ${esc(err.message)}</p>`, { admin })); }
    }
    if (req.method !== "GET") return send(res, 405, "", { Allow: "GET, POST" });
    const q = query(req);
    const r = parseRange(q);
    const e = normalizeEmail(q.email);
    if (!e) return html(res, 400, layout("User", `<p class="err">Missing or invalid email.</p>`, { admin, tz: r.tz }));
    try {
      const u = await Q.userByEmail(db, e.normalized);
      if (!u) return html(res, 404, layout("User", `<p class="muted">No user with that email.</p>`, { admin, tz: r.tz }));
      const [days, feats, sessions, events] = await Promise.all([Q.daily(db, r, u.id), Q.userFeaturesAllTime(db, u.id), Q.userSessions(db, u.id, 20), Q.userEvents(db, u.id, 100)]);
      return html(res, 200, layout(u.email, renderUser(r, u, { days, feats, sessions, events }), { admin, tz: r.tz }));
    } catch (err) {
      console.error("user page failed:", err);
      return html(res, 500, layout("User", `<p class="err">Could not load this user: ${esc(err.message)}</p>`, { admin, tz: r.tz }));
    }
  };
}

export default withDb(makeHandler);

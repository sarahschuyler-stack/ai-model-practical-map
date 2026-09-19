// GET /admin/usage: summary tiles, charts, users table, recent activity. Admin cookie required.
import { withDb, isMissingTable } from "../../lib/db.js";
import { html, query, redirect, send } from "../../lib/http.js";
import { currentAdmin } from "../../lib/admin.js";
import * as Q from "../../lib/queries.js";
import { layout, esc, pickTz, dayIn, fmtWhen, fmtTime, fmtDur, fmtNum, barChart, rankChart, eventLabel, featureLabel, TIMEZONES } from "../../lib/html.js";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Range from the query string: inclusive from/to days in tz, returned with an exclusive `to`. */
export function parseRange(q, now = new Date()) {
  const tz = pickTz(q.tz);
  const today = dayIn(now, tz);
  const from = DAY_RE.test(q.from || "") ? q.from : dayIn(new Date(now.getTime() - 29 * 864e5), tz);
  const toInclusive = DAY_RE.test(q.to || "") ? q.to : today;
  const toExclusive = new Date(Date.parse(toInclusive + "T00:00:00Z") + 864e5).toISOString().slice(0, 10);
  return { tz, from, toInclusive, to: toExclusive, sort: Q.SORTS.includes(q.sort) ? q.sort : "recent", q: String(q.q || "").slice(0, 100), page: Math.max(1, parseInt(q.page, 10) || 1) };
}

export function filterForm(r, action = "/admin/usage", hidden = {}) {
  const extra = Object.entries(hidden).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}"/>`).join("");
  return `<form class="filters" method="get" action="${action}">${extra}
<label>From<input type="date" name="from" value="${esc(r.from)}"/></label>
<label>To<input type="date" name="to" value="${esc(r.toInclusive)}"/></label>
<label>Time zone<select name="tz">${TIMEZONES.map(z => `<option value="${z}"${z === r.tz ? " selected" : ""}>${z}</option>`).join("")}</select></label>
${r.q !== undefined ? `<label>Search email<input type="search" name="q" value="${esc(r.q)}" placeholder="name@"/></label>` : ""}
<input type="hidden" name="sort" value="${esc(r.sort || "recent")}"/>
<button type="submit">Apply</button></form>`;
}

const link = (r, extra) => "/admin/usage?" + new URLSearchParams({ from: r.from, to: r.toInclusive, tz: r.tz, sort: r.sort, q: r.q, ...extra }).toString();

export function renderOverview(r, data) {
  const { totals: t, days, feats, users, recent } = data;
  const tiles = [
    ["Unique users", fmtNum(t.users)], ["Sessions in range", fmtNum(t.sessions)], ["Sessions today", fmtNum(t.today)],
    ["Last 7 days", fmtNum(t.last7)], ["Last 30 days", fmtNum(t.last30)], ["Avg active session", fmtDur(t.avg_active)],
    ["Total active time", fmtDur(t.total_active)], ["New users this week", fmtNum(t.new_week)], ["Returning this week", fmtNum(t.returning_week)],
  ].map(([l, n]) => `<div class="card tile"><div class="n">${esc(n)}</div><div class="l">${esc(l)}</div></div>`).join("");
  const charts = `<div class="charts">
${barChart("Daily active users", days.map(d => ({ label: d.day, value: d.dau })))}
${barChart("Sessions by day", days.map(d => ({ label: d.day, value: d.sessions })))}
${barChart("Active minutes by day", days.map(d => ({ label: d.day, value: d.minutes })), " min")}
${barChart("New users by day (returning = active minus new)", days.map(d => ({ label: d.day, value: d.new_users })))}
${rankChart("Most-used features in range", feats.map(f => ({ label: featureLabel(f.feature), value: f.n })))}
</div>`;
  const sorts = `<p class="sorts muted">Sort: ${Q.SORTS.map(s => s === r.sort ? `<b>${s}</b>` : `<a href="${esc(link(r, { sort: s }))}">${s}</a>`).join(" ")} · <a href="${esc("/admin/usage/export.csv?" + new URLSearchParams({ sort: r.sort, q: r.q }))}">Download CSV</a></p>`;
  const rows = users.map(u => `<tr>
<td><a href="${esc("/admin/usage/user?" + new URLSearchParams({ email: u.normalized_email, tz: r.tz }))}">${esc(u.email)}</a></td>
<td>${esc(fmtWhen(u.first_seen_at, r.tz))}</td><td>${esc(fmtWhen(u.last_seen_at, r.tz))}</td>
<td class="num">${esc(fmtNum(u.total_sessions))}</td><td class="num">${esc(fmtDur(u.total_active_seconds))}</td><td class="num">${esc(fmtDur(u.avg_session))}</td>
<td>${esc(featureLabel(u.top_feature))}</td></tr>`).join("");
  const pager = `<p class="muted">${r.page > 1 ? `<a href="${esc(link(r, { page: r.page - 1 }))}">Previous</a> · ` : ""}page ${r.page}${users.length === 50 ? ` · <a href="${esc(link(r, { page: r.page + 1 }))}">Next</a>` : ""}</p>`;
  const activity = recent.map(e => `<li><time>${esc(fmtTime(e.at, r.tz))}</time>${esc(e.email)} — ${esc(eventLabel(e.name, e.metadata))}</li>`).join("");
  return `${filterForm(r)}<div class="tiles">${tiles}</div>${charts}
<h2>Users</h2>${sorts}<div class="card tbl"><table><thead><tr><th>Email</th><th>First seen</th><th>Last seen</th><th class="num">Sessions</th><th class="num">Active time</th><th class="num">Avg session</th><th>Most used</th></tr></thead>
<tbody>${rows || '<tr><td colspan="7" class="muted">No users yet. Open the page, enter an email, and this fills in.</td></tr>'}</tbody></table></div>${pager}
<h2>Recent activity</h2><div class="card"><ul class="activity">${activity || '<li class="muted">Nothing yet.</li>'}</ul></div>`;
}

export function makeHandler(db) {
  return async (req, res) => {
    if (req.method !== "GET") return send(res, 405, "", { Allow: "GET" });
    const admin = currentAdmin(req);
    if (!admin) return redirect(res, "/admin/login");
    const r = parseRange(query(req));
    try {
      const [totals, days, feats, users, recent] = await Promise.all([
        Q.overview(db, r), Q.daily(db, r), Q.features(db, r), Q.users(db, { sort: r.sort, q: r.q, limit: 50, offset: (r.page - 1) * 50 }), Q.recent(db, 50),
      ]);
      return html(res, 200, layout("Usage overview", renderOverview(r, { totals, days, feats, users, recent }), { admin, tz: r.tz }));
    } catch (e) {
      if (isMissingTable(e)) return html(res, 200, layout("Usage overview", `<div class="card"><p>The database tables are not created yet. <a href="/admin/logout">Log out</a> and log in again to create them, or run <code>npm run migrate</code>.</p></div>`, { admin }));
      console.error("usage failed:", e);
      return html(res, 500, layout("Usage overview", `<div class="card"><p class="err">Could not load the report: ${esc(e.message)}</p></div>`, { admin }));
    }
  };
}

export default withDb(makeHandler);

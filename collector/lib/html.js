// Server-rendered HTML for the admin pages: escaping, layout, formatting and inline SVG bar charts.
// No client-side JavaScript; every value passes through esc().

export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export const TIMEZONES = ["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "Europe/London", "Europe/Berlin", "Asia/Tokyo", "Australia/Sydney"];
export function pickTz(tz) { return TIMEZONES.includes(tz) ? tz : "UTC"; }

/** YYYY-MM-DD for a date in a timezone. */
export function dayIn(date, tz) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
export function fmtWhen(v, tz) {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d)) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
}
export function fmtTime(v, tz) {
  const d = new Date(v);
  return isNaN(d) ? "" : new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d);
}
export function fmtDur(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), h = Math.floor(m / 60);
  if (h) return `${h}h ${m % 60}m`;
  return `${m}m ${s % 60}s`;
}
export const fmtNum = n => new Intl.NumberFormat("en-US").format(Number(n) || 0);

/** Human labels for event names on the dashboard. Unknown names are humanised. */
const LABELS = {
  session_started: "Session started", application_opened: "Opened the app", page_view: "Viewed the page", route_changed: "Jumped to a section",
  nav_clicked: "Clicked the nav", chooser_recommended: "Asked for model picks", chooser_preset_used: "Used a preset", chooser_cleared: "Cleared the chooser",
  prompt_plan_changed: "Changed a subscription plan", prompt_target_selected: "Picked a prompt target", prompt_built: "Built a prompt", prompt_copied: "Copied a prompt",
  prompt_edited: "Edited prompt answers", recheck_opened: "Opened Recheck", recheck_run: "Ran a Recheck", recheck_results_loaded: "Loaded Recheck results",
  recheck_applied: "Applied Recheck changes", recheck_reset: "Reset to the snapshot",
};
export function eventLabel(name, meta) {
  let l = LABELS[name] || String(name || "").replace(/_/g, " ").replace(/^./, c => c.toUpperCase());
  if (meta && typeof meta === "object") {
    const bits = [];
    for (const k of ["label", "model_id", "mode", "to", "tier"]) if (meta[k] != null && meta[k] !== "") bits.push(String(meta[k]));
    if (bits.length) l += " · " + bits.join(" · ");
  }
  return l;
}

const FEATURES = { chooser: "Task chooser", prompt: "Prompt builder", recheck: "Recheck", nav: "Navigation", route: "Section jumps", page: "Page views", application: "App opens" };
export const featureLabel = f => FEATURES[f] || (f ? String(f) : "other");

/** A vertical bar chart. points: [{label, value}] in order. */
export function barChart(title, points, unit = "") {
  const W = 640, H = 150, padL = 34, padB = 22, padT = 8;
  const n = points.length || 1;
  const max = Math.max(1, ...points.map(p => Number(p.value) || 0));
  const bw = Math.max(2, Math.floor((W - padL) / n) - 2);
  const bars = points.map((p, i) => {
    const v = Number(p.value) || 0, h = Math.round((H - padB - padT) * v / max);
    const x = padL + i * ((W - padL) / n), y = H - padB - h;
    return `<rect x="${x.toFixed(1)}" y="${y}" width="${bw}" height="${h}" rx="2" fill="#67e8f9" opacity="${v ? 0.9 : 0.25}"><title>${esc(p.label)}: ${esc(fmtNum(v))}${esc(unit)}</title></rect>`;
  }).join("");
  const first = points[0] ? esc(points[0].label) : "", last = points.length > 1 ? esc(points[points.length - 1].label) : "";
  return `<figure class="chart"><figcaption>${esc(title)}</figcaption>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}" preserveAspectRatio="none">
<text x="0" y="${padT + 10}" class="axis">${esc(fmtNum(max))}${esc(unit)}</text><text x="0" y="${H - padB}" class="axis">0</text>
<line x1="${padL}" y1="${H - padB}" x2="${W}" y2="${H - padB}" stroke="#213651"/>
${bars}
<text x="${padL}" y="${H - 6}" class="axis">${first}</text><text x="${W}" y="${H - 6}" class="axis" text-anchor="end">${last}</text>
</svg></figure>`;
}

/** Horizontal bars for a ranked list. rows: [{label, value}] */
export function rankChart(title, rows, unit = "") {
  const max = Math.max(1, ...rows.map(r => Number(r.value) || 0));
  const lines = rows.map(r => `<div class="rank"><span>${esc(r.label)}</span><i style="width:${(100 * (Number(r.value) || 0) / max).toFixed(1)}%"></i><b>${esc(fmtNum(r.value))}${esc(unit)}</b></div>`).join("");
  return `<figure class="chart"><figcaption>${esc(title)}</figcaption>${lines || '<p class="muted">Nothing yet.</p>'}</figure>`;
}

export function layout(title, body, { admin, tz } = {}) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><meta name="robots" content="noindex"/>
<title>${esc(title)} · Practical Map usage</title>
<style>
:root{--bg:#07111f;--panel:#0d1b2d;--ink:#ecf4ff;--muted:#93a8c2;--line:#213651;--cyan:#67e8f9;--green:#73e2a7;--red:#ff8c8c}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:14px}
.wrap{max-width:1180px;margin:auto;padding:24px 16px 60px}
header{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:18px}
h1{font-size:26px;margin:0;letter-spacing:-.03em}h2{font-size:17px;margin:26px 0 10px;letter-spacing:-.02em}
a{color:#9ed9ff}.muted{color:var(--muted)}.eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.14em;color:var(--cyan);font-weight:800}
.card{background:linear-gradient(180deg,rgba(16,31,51,.94),rgba(11,25,42,.96));border:1px solid var(--line);border-radius:14px;padding:16px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.tile{padding:12px 14px}.tile .n{font-size:24px;font-weight:850;letter-spacing:-.03em}.tile .l{font-size:11px;color:var(--muted);margin-top:2px}
.charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-top:12px}
.chart{margin:0;padding:12px 14px}.chart figcaption{font-size:12px;color:var(--muted);margin-bottom:8px;font-weight:700}.chart svg{width:100%;height:150px;display:block}.axis{fill:#7189a5;font-size:10px}
.rank{display:grid;grid-template-columns:150px 1fr 60px;gap:8px;align-items:center;font-size:12px;margin:5px 0}.rank i{display:block;height:8px;background:var(--cyan);border-radius:99px;min-width:2px}.rank b{text-align:right}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;white-space:nowrap}
.tbl{overflow:auto}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
form.filters{display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin:6px 0 14px}form.filters label{font-size:11px;color:var(--muted);display:grid;gap:4px}
input,select{background:#071522;border:1px solid #2a4565;border-radius:9px;color:white;padding:8px 10px;font:inherit;font-size:13px}
button{border:0;border-radius:9px;padding:9px 13px;font-weight:750;cursor:pointer;background:#17314d;color:#dcecff}button.primary{background:linear-gradient(135deg,#4cc9f0,#7aa2ff);color:#04111e}button.danger{background:#4a1d1d;color:#ffb3b3}
.pill{display:inline-block;font-size:11px;border:1px solid var(--line);border-radius:999px;padding:3px 8px;color:#c3d2e3}.ok{color:var(--green)}.err{color:var(--red)}
.activity li{list-style:none;padding:6px 0;border-bottom:1px solid var(--line);font-size:13px}.activity{padding-left:0;margin:0}.activity time{color:var(--muted);font-variant-numeric:tabular-nums;margin-right:8px}
.login{max-width:420px;margin:60px auto}.login form{display:grid;gap:10px}
.sorts a{margin-right:10px;font-size:12px}
@media(max-width:600px){.rank{grid-template-columns:100px 1fr 50px}}
</style></head><body><div class="wrap">
<header><div><div class="eyebrow">Practical Map · usage</div><h1>${esc(title)}</h1></div>
${admin ? `<div class="muted">${esc(admin)} · <a href="/admin/usage${tz ? "?tz=" + encodeURIComponent(tz) : ""}">Overview</a> · <form method="post" action="/admin/logout" style="display:inline"><button type="submit">Log out</button></form></div>` : ""}</header>
${body}
</div></body></html>`;
}

// Every report query in one place. All take db.q(text, params) and plain arguments.
// Date ranges are [from, to) as YYYY-MM-DD strings interpreted in `tz` (a whitelisted zone name).

/** Automatic events that should not count as "features used". */
const AUTO = "('page_view','route_changed','application_opened','nav_clicked')";

const ORDER = {
  recent: "u.last_seen_at desc",
  sessions: "u.total_sessions desc, u.last_seen_at desc",
  usage: "u.total_active_seconds desc, u.last_seen_at desc",
  newest: "u.first_seen_at desc",
};
export const SORTS = Object.keys(ORDER);

const bounds = (from, to, tz) => [`($1::date::timestamp at time zone $3)`, `($2::date::timestamp at time zone $3)`, [from, to, tz]];
const escLike = s => String(s).replace(/[\\%_]/g, c => "\\" + c);

export async function overview(db, { from, to, tz }) {
  const [F, T, p] = bounds(from, to, tz);
  const [row] = await db.q(`select
    (select count(*)::int from users) as users,
    (select count(*)::int from sessions where started_at >= ${F} and started_at < ${T}) as sessions,
    (select count(*)::int from sessions where started_at >= (date_trunc('day', now() at time zone $3) at time zone $3)) as today,
    (select count(*)::int from sessions where started_at >= now() - interval '7 days') as last7,
    (select count(*)::int from sessions where started_at >= now() - interval '30 days') as last30,
    (select coalesce(avg(active_seconds), 0)::int from sessions where started_at >= ${F} and started_at < ${T}) as avg_active,
    (select coalesce(sum(active_seconds), 0)::bigint from sessions where started_at >= ${F} and started_at < ${T}) as total_active,
    (select count(*)::int from users where first_seen_at >= now() - interval '7 days') as new_week,
    (select count(distinct s.user_id)::int from sessions s join users u on u.id = s.user_id
       where s.started_at >= now() - interval '7 days' and u.first_seen_at < now() - interval '7 days') as returning_week`, p);
  return row;
}

export async function daily(db, { from, to, tz }, userId = null) {
  const [F, T, p] = bounds(from, to, tz);
  const userFilter = userId ? " and user_id = $4" : "";
  const params = userId ? [...p, userId] : p;
  return db.q(`with days as (select generate_series($1::date, ($2::date - interval '1 day')::date, interval '1 day')::date as d),
    s as (select (started_at at time zone $3)::date as d, count(*)::int as sessions, count(distinct user_id)::int as dau,
                 (coalesce(sum(active_seconds), 0) / 60)::int as minutes
          from sessions where started_at >= ${F} and started_at < ${T}${userFilter} group by 1),
    n as (select (first_seen_at at time zone $3)::date as d, count(*)::int as new_users
          from users where first_seen_at >= ${F} and first_seen_at < ${T}${userId ? " and id = $4" : ""} group by 1)
    select days.d::text as day, coalesce(s.sessions, 0) as sessions, coalesce(s.dau, 0) as dau, coalesce(s.minutes, 0) as minutes, coalesce(n.new_users, 0) as new_users
    from days left join s on s.d = days.d left join n on n.d = days.d order by days.d`, params);
}

export async function features(db, { from, to, tz }, userId = null) {
  const [F, T, p] = bounds(from, to, tz);
  return db.q(`select coalesce(feature, 'other') as feature, count(*)::int as n from usage_events
    where created_at >= ${F} and created_at < ${T} and event_name not in ${AUTO}${userId ? " and user_id = $4" : ""}
    group by 1 order by 2 desc, 1 limit 10`, userId ? [...p, userId] : p);
}

export async function users(db, { sort = "recent", q = "", limit = 50, offset = 0 }) {
  const order = ORDER[sort] || ORDER.recent;
  const like = q ? "%" + escLike(q.toLowerCase()) + "%" : "";
  return db.q(`select u.email, u.normalized_email, u.first_seen_at, u.last_seen_at, u.total_sessions, u.total_active_seconds,
      case when u.total_sessions > 0 then u.total_active_seconds / u.total_sessions else 0 end as avg_session,
      (select e.feature from usage_events e where e.user_id = u.id and e.feature is not null and e.event_name not in ${AUTO}
         group by e.feature order by count(*) desc, e.feature limit 1) as top_feature
    from users u where ($1 = '' or u.normalized_email like $1 escape '\\')
    order by ${order} limit $2 offset $3`, [like, limit, offset]);
}

export async function recent(db, limit = 50) {
  return db.q(`select * from (
      select e.created_at as at, u.email, e.event_name as name, e.metadata from usage_events e join users u on u.id = e.user_id
      union all
      select s.started_at, u.email, 'session_started', null from sessions s join users u on u.id = s.user_id
    ) x order by at desc limit $1`, [limit]);
}

export async function userByEmail(db, normalized) {
  const [u] = await db.q(`select id, email, normalized_email, email_verified_at, first_seen_at, last_seen_at, total_sessions, total_active_seconds,
      case when total_sessions > 0 then total_active_seconds / total_sessions else 0 end as avg_session
    from users where normalized_email = $1`, [normalized]);
  return u || null;
}

export async function userFeaturesAllTime(db, userId) {
  return db.q(`select coalesce(feature, 'other') as feature, count(*)::int as n from usage_events
    where user_id = $1 and event_name not in ${AUTO} group by 1 order by 2 desc, 1 limit 20`, [userId]);
}

export async function userSessions(db, userId, limit = 20) {
  return db.q(`select id, started_at, last_activity_at, ended_at, end_reason, active_seconds, page_views, landing_page, referrer, browser
    from sessions where user_id = $1 order by started_at desc limit $2`, [userId, limit]);
}

export async function userEvents(db, userId, limit = 100) {
  return db.q(`select created_at, event_name, feature, metadata, session_id from usage_events where user_id = $1 order by created_at desc limit $2`, [userId, limit]);
}

export async function deleteUser(db, normalized) {
  const rows = await db.q("delete from users where normalized_email = $1 returning id", [normalized]);
  return rows.length;
}

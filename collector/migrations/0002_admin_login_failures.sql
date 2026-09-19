-- Failed admin logins, counted per source over a rolling window so guessing the
-- ADMIN_KEY is throttled rather than merely delayed. See collector/lib/throttle.js,
-- which holds the same statements and creates the table itself if a deployment is
-- attacked before its first successful login has applied the migrations.
-- source_hash is an HMAC of the client IP keyed by the admin session secret; the
-- address itself is never stored. Every statement is idempotent.

create table if not exists admin_login_failures (
  id bigserial primary key,
  source_hash bytea not null,
  created_at timestamptz not null default now()
);
create index if not exists admin_login_failures_source_idx on admin_login_failures (source_hash, created_at desc);
create index if not exists admin_login_failures_created_idx on admin_login_failures (created_at desc);

-- Users, identity tokens, sessions and events for the Practical Map usage analytics.
-- Applied by `npm run migrate` or automatically on the first admin login. Every statement is idempotent.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  normalized_email text not null unique,
  email_verified_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  total_sessions integer not null default 0,
  total_active_seconds integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists identity_tokens (
  token_hash bytea primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz
);
create index if not exists identity_tokens_user_idx on identity_tokens (user_id, created_at desc);

create table if not exists sessions (
  id text primary key,
  user_id uuid not null references users(id) on delete cascade,
  started_at timestamptz not null,
  last_activity_at timestamptz not null,
  ended_at timestamptz,
  end_reason text,
  active_seconds integer not null default 0,
  page_views integer not null default 0,
  referrer text,
  landing_page text,
  browser text,
  created_at timestamptz not null default now()
);
create index if not exists sessions_user_started_idx on sessions (user_id, started_at desc);
create index if not exists sessions_started_idx on sessions (started_at desc);

create table if not exists usage_events (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  session_id text not null references sessions(id) on delete cascade,
  event_name text not null,
  path text,
  feature text,
  metadata jsonb,
  created_at timestamptz not null
);
create index if not exists usage_events_created_idx on usage_events (created_at desc);
create index if not exists usage_events_user_created_idx on usage_events (user_id, created_at desc);
create index if not exists usage_events_name_created_idx on usage_events (event_name, created_at desc);
create index if not exists usage_events_session_idx on usage_events (session_id);

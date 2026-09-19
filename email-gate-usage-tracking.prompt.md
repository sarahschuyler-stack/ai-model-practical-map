# Prompt: email access gate and usage analytics for the Practical Map

Paste everything below the line into a coding agent that has this repository checked out.
Fill the `<< >>` placeholders first.

Read this before you paste it:

- **An email-only gate is a sign-in sheet, not a lock.** Nobody proves the address is theirs, and `index.html` is public on GitHub, so anyone can read the source and skip the gate. That is fine for the stated goal (knowing who uses the page, how often, for how long) as long as nobody later treats it as access control. The prompt says this to the agent, and it builds the identity layer so that magic-link verification can be switched on later without touching the analytics.
- **A static GitHub Pages site cannot record anything.** "Who, how often, how long" needs a small service that receives events and stores them. The prompt keeps the page on GitHub Pages and adds a `collector/` folder that deploys to Vercel with a Postgres database. It also carries the admin dashboard, since the page itself has no routes. You do two dashboard steps (create the Vercel project, attach a database), set four environment variables, and paste one URL into `index.html`.
- **The page and the collector are on different origins**, so browser cookies between them would be third-party cookies, which Safari blocks outright. Identity therefore travels as a server-issued random token in the request body, not a cookie. The admin dashboard lives on the collector's own origin, so it does get a proper HttpOnly cookie. If you would rather have everything on one origin, the alternative at the end moves hosting to Vercel.
- **You will be collecting personal data from strangers.** The gate says what is collected and why, the report is behind admin login, no IP addresses are stored, and the README gets a privacy section. Whether you also need a consent checkbox or a retention limit depends on where your visitors are; see the open questions.

---

# Role
You are a senior full-stack engineer working inside an existing public web application repository (`ai-model-practical-map`). Your task is to add a lightweight email access gate and a first-party usage analytics system without materially changing the existing UI or functionality. Follow this specification closely. Do not expand scope, redesign the page, or restyle anything not named here. Reuse the existing stack wherever practical and do not rebuild functioning parts of the application. Flag gaps in the spec in your final message instead of guessing. Do not stop to ask questions unless something truly cannot be safely determined from the repository.

# Parameters
- `PAGES_ORIGIN` = `<< https://sarahschuyler-stack.github.io >>` (origin of the live page, no path)
- `ADMIN_EMAILS` = `<< you@example.com >>` (comma-separated; set on Vercel, never committed)
- Feature branch: `feat/email-gate-usage-analytics`. Make all changes there.

# Repository facts (verified; use these, but confirm them in Phase 1)
- **Framework:** none. One file, `index.html` (1014 lines): styles, markup, then a single inline `<script>` starting at line 344. No bundler, no framework, no npm runtime dependency.
- **Hosting:** GitHub Pages from the `main` branch root. HTTPS, static only, no server-side code possible.
- **Database:** none. State lives in browser storage under `pm_` keys (`pm_plans`, `pm_recheck`, `pm_rcmodel`; `pm_apikey` in `sessionStorage` only).
- **Authentication:** none. **Analytics:** none. No Supabase, no other database, so the "use the existing database" rule does not apply; a database must be introduced and it lives with the collector, not in the page.
- **Routing:** single page with hash anchors (`#chooser`, `#mental`, `#map`, `#price`, `#stack`, `#sources`) in the sticky nav at line 187. "Route changed" therefore means `hashchange`.
- **Backend/API:** none. The only outbound call is Recheck Option A to `api.anthropic.com` from `callClaude()` (line 911).
- **Conventions in the script:** `$` is `document.getElementById` (line 376); `esc()` escapes every untrusted string before `innerHTML`; every storage access is wrapped in `try{}catch(e){}`; feature state lives on small objects (`rc`, `pb`) that tests can reach.
- **Tests:** `npm test` runs `node --test test/**/*.test.mjs` on Node 22. `test/harness.mjs` slices the inline script out of `index.html` with `lastIndexOf("<script>")` and evaluates it with `new Function` against stub `document`, `localStorage`, `sessionStorage`, `navigator`, `fetch`, `window`, `console`, returning the names in `EXPORTS`. The stubs are minimal: `document` has no `addEventListener` or `visibilityState`; `window` has only `location`; `navigator` has only `clipboard`. New page code must boot under these stubs.
- **CI:** `.github/workflows/ci.yml` runs `npm test` on every push and pull request.
- **Security history:** a stored-XSS fix (commit 4a6d82c) and a rule that the API key never reaches `localStorage`. Keep both intact.
- **Meaningful user actions** (for event instrumentation): describe a job and click Recommend (`$("recommend")`, presets with `data-preset`), Clear; Step 2 prompt builder: subscription tier picks (`pb.plans`, `savePlans()` line 533), target model choice, wizard answers, Copy prompt (`$("copyPrompt")`), Edit answers; Recheck: open (`$("recheck")`), Option A run (`$("rcRun")`), Option B copy prompt and Load results (`$("rcLoad")`), Apply selected (`$("rcApply")`), Reset (`$("rcReset")`), Close.

# Best place to integrate
- Gate and tracker: inline in `index.html`, as two small state objects `gate` and `track` beside `rc` and `pb`, plus a `trackEvent()` helper, so the harness can test them exactly like the existing features.
- Users, sessions, events, identity tokens, admin dashboard: a new `collector/` folder, a Vercel project with Root Directory `collector`, Node 22 serverless functions under `collector/api/`, Neon Postgres attached from the Vercel Marketplace (it injects `DATABASE_URL`). Only `@neondatabase/serverless` as a dependency. No Supabase and no auth platform: nothing in the repository argues for either, and the page must stay a static file.

# Goal
Visitors must enter an email address before using the page. No password, no account creation, no username, no elaborate login screen: one field and a Continue button. After entering it they are let in and stay recognised on future visits for about 30 days. The purpose is usage tracking, not security. An admin view shows who accessed the app, first and last access, visits, sessions, active time, which features they used, and overall usage.

# Security distinction, and the upgrade path you must preserve
Email without verification is not authentication. Build the identity layer so that verification can be added later without changing users, sessions, events or the dashboard:
- Identity is a server-issued random token (`identity_tokens` table below), created by `POST /api/identify`. Today `identify` issues the token immediately. Later, `identify` will instead send a magic link and a new `GET /api/verify?t=` will issue the token. Nothing downstream reads the email from the browser; every analytics write resolves the user from the token.
- `users.email_verified_at` exists now and is always null. The admin dashboard and any future "verified only" rule key off it.
- Document the exact change list in the README (Phase 6, item 8).

# Phase 1: repository assessment
Read `README.md` in full, `index.html`, `test/harness.mjs`, `test/smoke.test.mjs`, `test/apikey.test.mjs`, `.github/workflows/ci.yml`, `.gitignore`. Confirm the repository facts above and report, in your final message, any that differ: framework, database, hosting, existing auth, existing analytics, routing, backend, and the integration point you chose. Then proceed.

# Phase 2: identity gate (page + collector)

## 2.1 Gate markup and styles (`index.html`)
- Insert a full-viewport overlay right after `<body>` and before `<div class="wrap">`:
  `<div id="gate" role="dialog" aria-modal="true" aria-labelledby="gateTitle">` containing a `.card` with: eyebrow "Welcome"; `<h2 id="gateTitle">Enter your email to continue.</h2>`; `<form id="gateForm">` with `<input type="email" id="gateEmail" autocomplete="email" required placeholder="Email address">` and `<button class="primary" type="submit" id="gateGo">Continue</button>`; `<div class="gateErr" id="gateErr" aria-live="polite"></div>`; small text: "Your email is used to identify your session and understand how this application is being used. No password, no verification email."
- Style with existing tokens (`--panel`, `--line`, `--cyan`, `.card`, `.primary`). Overlay: `position:fixed;inset:0;z-index:50;display:grid;place-items:center;background:rgba(7,17,31,.92);backdrop-filter:blur(10px)`. Card max width 440px. Must fit a phone at the existing 520px breakpoint with 16px gutters.
- Gate closed: `#gate{display:none}`. Gate open: `body.gated{overflow:hidden}` and `body.gated .wrap{filter:blur(4px);pointer-events:none;user-select:none}`.
- Add to the hero stamp's `.stampacts` (line 182), after the Recheck button: `<button class="ghost" id="signOut" title="Forget this email on this device">Switch user</button>`. Once signed in its label becomes `Switch user · you@example.com`, set via `textContent` only.
- The page behind the gate still boots and renders exactly as today; the overlay only covers it. Do not delay `renderModels()`, `renderPricing()` or `applyState()`.
- Change the chooser intro at line 225 from "no API key, no server, and no hidden model call" to "no API key and no hidden model call. The only thing sent anywhere is the usage record described at sign-in." Leave the Recheck copy alone.

## 2.2 Configuration constants
Directly after `const $=id=>document.getElementById(id);` (line 376):

```js
/* Usage analytics. COLLECTOR_URL is the deployed collector origin (see collector/README.md).
   Leave it empty to keep the gate but store identity locally and send nothing: local work and tests. */
const COLLECTOR_URL = "";
const TRACK_BEAT_MS = 30000;      // summarised activity heartbeat while active and visible
const TRACK_IDLE_MS = 5*60*1000;  // no activity for this long ends the session
```

## 2.3 Gate logic (`gate` object)
- `gate.valid(email)`: trim, lowercase, accept when it matches `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/` and is at most 254 characters; else `null`.
- Identity record in `localStorage` under `pm_identity`: `{email, token, exp}` (ISO expiry). `gate.load()` returns it when `exp` is in the future and `email` passes `gate.valid`; otherwise removes it and returns `null`.
- `gate.open()`: show `#gate`, add `body.gated`, focus `#gateEmail`. `gate.close(identity)`: hide, remove class, set the switch-user label, call `track.start(identity)`.
- `gate.submit()`: validate; on failure write "Enter a valid email address." to `#gateErr` and return `false`. On success call `gate.identify(email)`:
  - With `COLLECTOR_URL` empty: store `{email, token:null, exp: now+30d}` and close the gate.
  - Otherwise `POST COLLECTOR_URL+"/api/identify"` with `Content-Type: text/plain;charset=UTF-8` and body `{"v":1,"email":email}`. On `200 {token, exp}` store and close. On any failure (network, 5xx, timeout of 8 seconds) still admit the visitor: store `{email, token:null, exp: now+1d}`, close the gate, and retry `identify` silently at the next boot. Analytics failures never block the application.
- `gate.signOut()`: call `track.end("signout")`, remove `pm_identity` and `pm_sid`, clear `#gateEmail`, `gate.open()`.
- Wire `$("gateForm").onsubmit` (with `preventDefault`) and `$("signOut").onclick` in the file's existing style.
- Boot, appended after the existing boot block (line 1011): `const id=gate.load(); if(id) gate.close(id); else gate.open();`. Must not throw under the test stubs.
- The email never passes through `innerHTML`. `textContent` only. Never put it in the URL.

## 2.4 Identity endpoint (`collector/api/identify.js`)
- `POST` only, CORS as in 3.5. Body at most 1 KB, parsed as JSON regardless of content type. Normalise: trim, lowercase; for the local part also strip nothing else (do not fold Gmail dots; keep normalisation simple and documented). Validate with the same regex as the page.
- Upsert `users` on `normalized_email`: insert with `first_seen_at=last_seen_at=now()`; on conflict update `last_seen_at`.
- Create an identity token: 32 random bytes, base64url. Store only `sha256(token)` in `identity_tokens` with `expires_at = now()+30 days`. Return `{token, exp}`. Old tokens for the user are left valid until expiry (several devices).
- Rate limit: at most 20 identify calls per normalized email per hour (count rows in `identity_tokens` created in the last hour); over the limit reply `429`.

# Phase 3: analytics engine

## 3.1 Session model
A usage session is one continuous period of use in one tab. `pm_sid` in `sessionStorage` holds the current session id (`crypto.randomUUID()`, fallback to `getRandomValues` hex, then a time+random string). A reload continues the session. Five minutes without activity ends it; the next activity starts a new session with a new id. Closing the tab ends it.

## 3.2 Active-time tracking (`track` object)
State: `{identity:null, sid:null, active:false, lastActivity:0, unsent:0, timer:null, started:false}`.
- Activity sources, registered only when `document.addEventListener` exists: `mousemove`, `keydown`, `click`, `touchstart`, `scroll`, `pointerdown` on `document`, and `visibilitychange`, `hashchange`, `pagehide` on `window`/`document`. Listeners are passive. They do not send anything: `mousemove` and `scroll` only update `lastActivity` and are throttled to once per second; keystroke contents are never read.
- Every second (one `setInterval`), if the tab is visible and `now - lastActivity < TRACK_IDLE_MS`, add 1 to `unsent`. Every `TRACK_BEAT_MS` send a `beat` carrying `active_seconds: unsent` and reset it, but only if `unsent > 0`. If `now - lastActivity >= TRACK_IDLE_MS` and the session is active, send `end("idle")`; on the next activity call `track.start` again, which mints a new `pm_sid`.
- `visibilitychange` to hidden: flush `unsent` as a `beat` with `beacon:true`. `pagehide`: `end("pagehide")` with `beacon:true`.
- `track.stop()` clears the interval without sending, for tests.
- Expose `track.tick()` (one second of accounting) and `track.flush()` so tests need no fake timers.

## 3.3 Events
- Envelope, one JSON object per request, `Content-Type: text/plain;charset=UTF-8` (CORS-safelisted, so no preflight; beacons during unload are not dropped): `{v:1, token, sid, type, ts, path, hash, ref, tz, active_seconds?, name?, feature?, meta?}`. `token` is the identity token; the server resolves the user from it and ignores any email in the body. Nothing else: no user agent from the page (the server reads the `User-Agent` header and stores a coarse browser/OS family only), no screen size, no IP-derived values.
- `type` is `start`, `beat`, `end`, or `event`. Automatic events: `session_started` (sent as `start`), `session_ended` (as `end`, with `reason`), `application_opened` (first `start` in a tab, i.e. when `pm_sid` was just created), `page_view` (once per load, with `hash`), `route_changed` (on `hashchange`, `meta.to`).
- `trackEvent(name, meta)` is the reusable utility: validates `name` matches `/^[a-z][a-z0-9_]{1,48}$/`, `meta` is a flat object of at most 10 string/number/boolean values each at most 100 characters, and sends `{type:"event", name, feature, meta}` where `feature` is the first segment of `name` before `_`. Swallows every error. Does nothing while `COLLECTOR_URL` is empty or the identity has no token.
- Instrument these actions and no others:
  - `chooser_recommended` `{signals: "<comma list of matched signal names>", task_chars: n, preset: bool}`. Never the task text.
  - `chooser_preset_used` `{label}`, `chooser_cleared`.
  - `prompt_target_selected` `{model_id}`, `prompt_plan_changed` `{vendor, tier}`, `prompt_built` `{answers: n, model_id}`, `prompt_copied` `{model_id}`, `prompt_edited`.
  - `recheck_opened`, `recheck_run` `{mode: "api"|"paste", model}` (never the key), `recheck_results_loaded` `{changes: n}`, `recheck_applied` `{applied: n}`, `recheck_reset`.
  - `nav_clicked` `{to}` from the sticky nav.
- Transport `track.send(payload,{beacon})`: `fetch(COLLECTOR_URL+"/api/track",{method:"POST",headers:{"Content-Type":"text/plain;charset=UTF-8"},body,keepalive:true,mode:"cors",credentials:"omit"})`, errors swallowed; with `beacon:true` use `navigator.sendBeacon(url, new Blob([body],{type:"text/plain;charset=UTF-8"}))` when available, else the fetch.

## 3.4 Database (`collector/migrations/0001_init.sql`, applied by `npm run migrate`)
Postgres. Migrations are plain SQL files applied in order and recorded in `schema_migrations(name, applied_at)`; `collector/scripts/migrate.mjs` runs them with `DATABASE_URL`.

```sql
create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  normalized_email text not null unique,
  email_verified_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  total_sessions integer not null default 0,
  total_active_seconds integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table identity_tokens (
  token_hash bytea primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz
);
create index identity_tokens_user_idx on identity_tokens(user_id, created_at desc);
create table sessions (
  id text primary key,                       -- client sid, validated [A-Za-z0-9-]{8,64}
  user_id uuid not null references users(id) on delete cascade,
  started_at timestamptz not null,
  last_activity_at timestamptz not null,
  ended_at timestamptz,
  end_reason text,
  active_seconds integer not null default 0,
  page_views integer not null default 0,
  referrer text,
  landing_page text,
  browser text,                              -- coarse family, e.g. "Safari/macOS"
  created_at timestamptz not null default now()
);
create index sessions_user_started_idx on sessions(user_id, started_at desc);
create index sessions_started_idx on sessions(started_at desc);
create table usage_events (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  session_id text not null references sessions(id) on delete cascade,
  event_name text not null,
  path text,
  feature text,
  metadata jsonb,
  created_at timestamptz not null
);
create index usage_events_created_idx on usage_events(created_at desc);
create index usage_events_user_created_idx on usage_events(user_id, created_at desc);
create index usage_events_name_created_idx on usage_events(event_name, created_at desc);
```

Design note: `users.total_sessions` and `total_active_seconds` are maintained by the track handler so the users table sorts without aggregating sessions. Per-day charts aggregate `sessions` and `usage_events` by `date_trunc('day', ...)`; add a daily rollup table only if the report gets slow, and note that as a follow-up.

## 3.5 Track endpoint (`collector/api/track.js`)
- `POST` only; `OPTIONS` answers 204. CORS: send `Access-Control-Allow-Origin` equal to `process.env.ALLOWED_ORIGIN` only when the request `Origin` matches exactly; otherwise no CORS headers. Read the raw body as text regardless of content type, at most 4 KB.
- `collector/lib/validate.js` `parseEnvelope(text)`: `v===1`; `type` in `start|beat|end|event`; `sid` `[A-Za-z0-9-]{8,64}`; `token` base64url 40 to 50 chars; `ts` within 24 hours of the server clock else replaced by it; `active_seconds` integer 0 to 60; `path`, `hash`, `ref`, `tz`, `reason` strings cut to 200; `name` per the `trackEvent` regex; `meta` flat, at most 10 keys, values cut to 100.
- Resolve the user: `sha256(token)` lookup in `identity_tokens` where `expires_at > now()`; miss gives `401` and the page then drops `pm_identity` and reopens the gate. Update `last_used_at` at most once per hour.
- `start`: insert `sessions` (`landing_page` from `path+hash`, `referrer`, `browser` derived from the `User-Agent` header with a 20-line family parser, no library, no raw UA stored); on conflict update `last_activity_at`, `ended_at=null`; on a fresh insert `users.total_sessions+1`. Always `users.last_seen_at=ts`.
- `beat`: credit `least(active_seconds, 60, greatest(0, epoch(ts-last_activity_at)+5))` to both `sessions.active_seconds` and `users.total_active_seconds`, set `last_activity_at=ts`. Reject with `429` if `ts - last_activity_at < 20s` (anti-inflation).
- `end`: same credit, plus `ended_at=ts`, `end_reason`.
- `event`: insert `usage_events`; for `page_view` also `sessions.page_views+1`. Reject with `429` when the session already has 2000 events.
- Reply `204` on success, `400 {error}` on validation failure, `401` on a bad token, `405`, `429`, and `500` with a generic message (log the real error). Never echo the body.
- Handlers export `makeHandler(sql)` and `export default makeHandler(sql)`, with `sql` from `collector/lib/db.js` (`neon(process.env.DATABASE_URL)`), so tests inject a mock.

# Phase 4: admin dashboard (on the collector origin)
- Routes: `GET /admin/login`, `POST /admin/login`, `POST /admin/logout`, `GET /admin/usage`, `GET /admin/usage/user?email=`, `GET /admin/usage/export.csv`. Implement as `collector/api/admin/*.js` with `vercel.json` rewrites from the `/admin/...` paths.
- Authorisation, verified on the server for every admin request: `POST /admin/login` takes `email` and `admin_key`; the email must be in `ADMIN_EMAILS` and the key must equal `ADMIN_KEY` (constant-time compare). Because gate emails are unverified, membership in `ADMIN_EMAILS` alone is never sufficient today; the key is the stand-in for verification and is replaced by the magic link later (document this). Success sets an `HttpOnly; Secure; SameSite=Lax` cookie holding an HMAC-signed `{email, exp: 12h}` using `ADMIN_SESSION_SECRET`. No admin email or key appears in `index.html` or any client-side code.
- Every admin page is server-rendered HTML with inline CSS, no JavaScript beyond a `<form>` for date filters, all values escaped. Use the page's design tokens (dark background `#07111f`, panel `#0d1b2d`, line `#213651`, cyan `#67e8f9`, Inter/system font) so it matches. Charts are inline SVG bars rendered server-side; no chart library.
- Date filter: `?from=YYYY-MM-DD&to=YYYY-MM-DD`, default last 30 days, applied to every metric and chart.
- **Overview** (`/admin/usage`): summary tiles: unique users, total sessions, sessions today, last 7 days, last 30 days, average active session duration, total active time, new users this week, returning users this week. Charts: daily active users, sessions by day, active minutes by day, new vs returning by day, most-used features (top 10 `feature` counts). Users table: email, first seen, last seen, sessions, total active time, average session, most used feature; `?sort=recent|sessions|usage|newest`, `?q=` email search (`ilike`), 50 per page. Recent activity: last 50 events as `11:04 AM — person@example.com — Dashboard viewed` using a small event-name to label map, with times in the admin's timezone from `?tz=` defaulting to UTC.
- **User detail** (`/admin/usage/user?email=`): email, first visit, most recent visit, total sessions, total active time, average active session, features used with counts, usage by date (SVG bars), last 20 sessions (start, end reason or "open", active time, landing page, browser), last 100 events. Email is the parameter because it is the admin's search key; never expose `users.id`.
- **Export** (`/admin/usage/export.csv`): the users table as CSV.
- The user detail and any per-user query take the email from the admin's request only; there is no endpoint through which a gate visitor can read any analytics, their own included.

# Phase 5: security review
Review and fix: secrets (`.env*` gitignored, `collector/.env.example` with placeholders for `DATABASE_URL`, `ALLOWED_ORIGIN`, `ADMIN_EMAILS`, `ADMIN_KEY`, `ADMIN_SESSION_SECRET`); no privileged logic client-side; `identify` and `track` cannot read data, only write their own user's rows; session spoofing (token hashed at rest, `sid` scoped to the token's user on every write, so one user cannot write into another's session); analytics manipulation (per-beat cap, 20-second beat floor, 2000-event cap, 20-identify-per-hour cap, body-size caps); the identity token in `localStorage` is readable by page script, which is acceptable because it only permits writing analytics as that email and the page's `esc()` discipline and XSS tests remain; admin cookie signed, HttpOnly, 12-hour expiry, logout clears it. Keep the existing rule that the Anthropic key is never written to `localStorage`.

# Phase 6: documentation
- `README.md`: change line 13 ("Everything runs in the browser. There is no server...") to say the page is still static with no build step, plus a sentence that a small collector in `collector/` receives usage events and hosts the admin dashboard. Add a section **Sign-in and usage analytics** after "Security model" covering: 1 how the system works (gate, identity token, sessions, events); 2 database setup (Neon from the Vercel Marketplace, `npm run migrate`); 3 required environment variables and where each is set; 4 local development (`COLLECTOR_URL=""` keeps the gate working offline; `vercel dev` for the collector); 5 production deployment (Vercel project with Root Directory `collector`, then paste `https://<project>.vercel.app` into `COLLECTOR_URL` and push to `main`); 6 how to reach `/admin/usage`; 7 how session duration is calculated (activity sources, 1-second accounting, 30-second summarised beats, 5-minute idle, per-beat cap); 8 how to enable magic-link verification later: `identify` sends a link instead of returning a token, new `verify` endpoint issues the token and sets `email_verified_at`, `ADMIN_KEY` retired in favour of `ADMIN_EMAILS` once verified, the gate shows "check your email", and nothing in `sessions`, `usage_events` or the dashboard changes. Add `pm_identity` (localStorage) and `pm_sid` (sessionStorage) to the Persistence list, add `test/gate.test.mjs`, `test/track.test.mjs` and the collector suite to the tests table, and list `collector/` under Repository notes.
- `collector/README.md`: deploy steps in order, the exact `curl` for an `identify` and a `start`, the admin login URL, the privacy properties (no IP, coarse browser family only, no raw UA), and the one-line delete for a person's data (`delete from users where normalized_email=$1`, which cascades).

# Testing
Page tests run under the existing harness; extend `test/harness.mjs` first: `document.addEventListener` recording into `document._listeners`, `document.visibilityState="visible"`, `document.referrer=""`, `window.addEventListener`, `window.location.hash=""`, `navigator.sendBeacon` recording into `navigator._beacons`; add `gate`, `track`, `trackEvent`, `COLLECTOR_URL` to `EXPORTS`; accept a `collectorUrl` option that replaces `const COLLECTOR_URL = "";` in `source` with the given value (say so in a comment). Every test that starts tracking calls `track.stop()` in `finally` so `node --test` exits.

Map the required cases as follows:
1. New visitor sees the gate: `test/gate.test.mjs` boot with empty storage, `body.gated` set, `modelCards` still rendered.
2. Invalid email rejected: `gate.valid` and `gate.submit` cases.
3. Valid email grants access: submit with a mocked `identify` returning a token; gate closed, `pm_identity` stored with lowercased email.
4. Refresh preserves identity: boot with `pm_identity` in storage; gate stays closed, `start` sent, `pm_sid` reused when present in `sessionStorage`.
5. Closing and reopening the browser preserves identity: same as 4 with empty `sessionStorage` (new `sid`, same identity); mark it in the test name. A real-browser check is in the manual list.
6. Returning visitor is not re-asked: covered by 4 and 5.
7. Sign out clears identity: `pm_identity` and `pm_sid` removed, `end("signout")` sent, gate reopened.
8. Same email does not create duplicate users: collector test asserting the identify upsert uses `on conflict (normalized_email)` and that `Sarah@Example.com ` and `sarah@example.com` normalise equal.
9. New session created appropriately: `track.start` sends `start` once; after `TRACK_IDLE_MS` of no activity `track.tick` sends `end("idle")`; the next activity sends a fresh `start` with a new `sid`.
10. Page navigation tracked: `hashchange` listener sends `route_changed` with `meta.to`; `page_view` once at start.
11. Active time increases while active: with recent `lastActivity` and visible, 30 ticks then `flush` sends `beat` with `active_seconds:30`.
12. Inactive or background tabs do not accumulate: `visibilityState="hidden"` or stale `lastActivity` leaves `unsent` at 0 and `flush` sends nothing.
13. Admin can access the dashboard: collector test, `POST /admin/login` with a listed email and the key sets the cookie; `GET /admin/usage` with it returns 200.
14. Normal users cannot: no cookie gives 302 to login; a listed email with the wrong key gives 401; a gate identity token is not accepted anywhere under `/admin`.
15. Users cannot query other users: `track` with a `sid` belonging to another user's session is rejected; there is no read endpoint outside `/admin`; test that `identify` and `track` responses carry no body on success.
16. Analytics failures do not break the app: `identify` mocked to throw and to return 500; visitor is still admitted; `trackEvent` with a throwing fetch does not throw; `COLLECTOR_URL=""` sends nothing.
17. Existing functionality: all current suites pass unchanged (`smoke`, `xss`, `chooser`, `recheck`, `apikey`).

Collector tests (`collector/test/*.test.mjs`) mock `sql` as a tagged template that records query text and parameters and returns canned rows; they must pass with no network. Also cover: CORS header only for the allowed origin; body-size rejections; the per-beat cap and 20-second floor; the 2000-event cap; escaping of `<script>` in an email, path and metadata on both admin pages; CSV export.

CI: after `npm test`, add `npm ci --prefix collector` and `npm test --prefix collector`.

Manual checks (report which you ran): via `npm run serve` with `COLLECTOR_URL` empty, the gate appears, invalid input errors, valid input opens the page, reload skips the gate, Switch user brings it back. With a local collector (`vercel dev` and a dev database) confirm `start` on load, `beat` every 30 seconds while moving the mouse, none after 5 idle minutes, `end` on tab close, the admin login and dashboard.

# Constraints
- `index.html` stays one file, LF endings, no external scripts, no build step, and no new globals beyond `gate`, `track`, `trackEvent`, `COLLECTOR_URL`, `TRACK_BEAT_MS`, `TRACK_IDLE_MS`.
- Neither the email, the token nor any event metadata ever passes through `innerHTML`, and none appears in a URL on the page.
- Never collect passwords, GPS, fingerprints, keystroke contents, the task description, prompt answers, the API key, or form contents. No IP addresses stored. No third-party analytics.
- Do not touch the Recheck code paths beyond adding `trackEvent` calls; do not change the API key rules.
- Do not add a consent checkbox, a retention job, or magic-link sending; list them as follow-ups.
- Do not deploy. The deploy steps are documentation for the repository owner. Never commit secrets.

# Final deliverable
Implement it in the repository on the feature branch and then report: files added; files modified; migrations created; environment variables required and where to set them; events tracked; security protections implemented; tests run with their output; manual deployment and configuration steps left for the owner; recommended next improvements. Lead with what was built and where, then assumptions and any spec gaps. Do not put a model name in commits, code comments or documentation.

---

## Open questions for the repository owner (not for the agent)

1. **Two origins or one?** This prompt keeps GitHub Pages for the page and Vercel for the collector and dashboard, with identity as a token in the request body because cross-site cookies are blocked in Safari. The alternative is to host the whole site on Vercel (static `index.html` plus `api/`), which makes everything same-origin so the visitor identity can be an HttpOnly cookie and the `/admin/usage` URL sits beside the page. It is a cleaner security story at the cost of moving hosting. Say which and the agent can adjust Phases 2 and 3.
2. **Consent and retention.** If any visitors are in the EU or UK, an email tied to activity is personal data. A consent checkbox on the gate and a "delete sessions older than N days" job are each a few lines and are left out here so you can decide.
3. **Gate the whole page or only the tools?** This prompt gates everything, as "required login" implies. Gating only the chooser and prompt builder would leave the map and pricing public and still capture nearly all meaningful usage.
4. **Admin without the key.** Until magic-link verification exists, the dashboard needs `ADMIN_KEY` as well as a listed email, because anyone can type your email into the gate. Once you enable verification, the key can be retired.

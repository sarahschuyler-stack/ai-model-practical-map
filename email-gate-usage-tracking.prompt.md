# Prompt: email sign-in gate and usage tracking for the Practical Map

Paste everything below the line into a coding agent that has this repository checked out.
Fill the two `<< >>` placeholders first.

Read this before you paste it:

- **An email-only gate is a sign-in sheet, not a lock.** Nobody has to prove the address is theirs, and `index.html` is public on GitHub, so anyone can read the source and skip the gate. That is fine for the stated goal (knowing who is using the page and for how long) as long as nobody later treats it as access control. The prompt says this to the agent so it does not over-build.
- **A static GitHub Pages site cannot record anything.** "How often, by who, for how long" needs a tiny service that receives events and stores them. The prompt keeps the page static and adds a separate `collector/` folder that deploys to Vercel with a Postgres database. You will do two dashboard steps yourself (create the Vercel project, attach a database) and paste one URL into `index.html`. Alternatives are listed at the end.
- **You will be collecting personal data from strangers.** The prompt makes the page say what is collected and why, keeps the report behind a secret token, stores no IP addresses, and adds a privacy section to the README. Whether you also need a consent checkbox or a retention limit depends on where your visitors are; see the open questions.

---

# Role
You are a disciplined implementation engineer working in the `ai-model-practical-map` repository. Follow this specification closely. Do not expand scope, redesign the page, or restyle anything that is not named here. Flag gaps in the spec in your final message instead of guessing.

# Context you must read first
- `README.md` in full. It describes the page, the test harness and the security model. Several sentences in it become false after this change and are listed below for updating.
- `index.html`. It is one file: styles, markup, then a single inline `<script>` starting at line 344. Conventions to keep: `$` is `document.getElementById` (line 376); `esc()` escapes every untrusted string before `innerHTML`; browser storage keys use the `pm_` prefix (`pm_plans`, `pm_recheck`, `pm_rcmodel`, `pm_apikey`); every storage access is wrapped in `try{}catch(e){}`; feature state lives on small objects (`rc`, `pb`) that the tests can reach.
- `test/harness.mjs`. It extracts the inline script with `lastIndexOf("<script>")`, evaluates it with `new Function` against stub `document`, `localStorage`, `sessionStorage`, `navigator`, `fetch`, `window` and `console`, and returns the names in `EXPORTS`. The stubs are minimal: `document` has no `addEventListener` or `visibilityState`, `window` has only `location`, `navigator` has only `clipboard`. Your new code must boot under these stubs, and you will extend them.
- `test/smoke.test.mjs` and `test/apikey.test.mjs` to match the existing test style.
- `.github/workflows/ci.yml`. It runs `npm test` on Node 22 for every push.

# Parameters
- `PAGES_ORIGIN` = `<< https://sarahschuyler-stack.github.io >>` (the origin of the live page, no path)
- `COLLECTOR_URL` = `<< https://your-collector.vercel.app >>` (known only after deploy; leave the constant in `index.html` empty until then)

# Task
Add two features, keeping the page a single static `index.html` with no build step and no runtime dependency:

1. **Email sign-in gate.** Before anyone can use the page they must enter an email address. No password, no verification email. The address is remembered in this browser so returning visitors are not asked again. A visible sign-out control forgets it.
2. **Usage tracking.** Every visit becomes a session tied to that email. The page reports session start, periodic heartbeats while the tab is visible, and session end. A separate collector service stores sessions and serves a token-protected report page that shows, per email, how many visits, when first and last seen, and total active minutes, plus a list of recent sessions.

Both features are additive. Every existing behaviour (chooser, prompt builder, Recheck, storage rules, escaping) must keep working and every existing test must keep passing, with only the harness stubs extended.

# Deliverable

## Part A: `index.html`

### A1. Gate markup and styles
- Add a full-viewport overlay immediately after `<body>` and before `<div class="wrap">`:
  - `<div id="gate" role="dialog" aria-modal="true" aria-labelledby="gateTitle">` containing a card with: an eyebrow "Sign in to continue"; an `<h2 id="gateTitle">` "Enter your email to open the map"; one short paragraph that states plainly what happens: "We record your email, when you visit and how long you stay, so we can see who finds this useful. No password, no verification email. Nothing else is collected."; a `<form id="gateForm">` with `<input type="email" id="gateEmail" autocomplete="email" required placeholder="you@example.com">` and a `<button class="primary" type="submit" id="gateGo">Open the map</button>`; and an empty `<div class="gateErr" id="gateErr" aria-live="polite">`.
  - Style it with the existing tokens (`--panel`, `--line`, `--cyan`, `.card`, `.primary`). Overlay: `position:fixed; inset:0; z-index:50; display:grid; place-items:center; background:rgba(7,17,31,.92); backdrop-filter:blur(10px)`. Card max width 440px, padding 26px. Keep the existing 900px and 520px breakpoints working; the card must fit a phone with 16px side gutters.
  - When the gate is closed, `#gate` gets `display:none`. While it is open, `body` has class `gated`, with `body.gated{overflow:hidden}` and `body.gated .wrap{filter:blur(4px);pointer-events:none;user-select:none}`.
- Add a sign-out control inside the hero stamp's `.stampacts` (line 182), after the Recheck button: `<button class="ghost" id="signOut" title="Forget this email on this device">Sign out</button>`. Its text becomes `Sign out · you@example.com` once signed in, set through `textContent` (never `innerHTML`).
- The page behind the gate still boots and renders exactly as today. The gate only covers it. Do not delay `renderModels()`, `renderPricing()` or `applyState()`.

### A2. Configuration constants
Directly after `const $=id=>document.getElementById(id);` (line 376) add:

```js
/* Usage tracking. Set TRACK_URL to the deployed collector's /api/track endpoint (see collector/README.md).
   Leave it empty to keep the sign-in gate but send nothing, for local work and tests. */
const TRACK_URL = "";
const TRACK_BEAT_MS = 30000;
```

### A3. Gate logic
Add a `gate` object next to `rc` and `pb`, with these functions, each guarded so they are no-ops under the test stubs when an element or API is missing:

- `gate.valid(email)`: trims, lowercases, returns the cleaned string when it matches `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/` and is at most 254 characters, otherwise `null`.
- `gate.load()`: returns the remembered email from `localStorage` key `pm_email` through `gate.valid`, or `null`.
- `gate.open()`: shows `#gate`, adds `body.gated`, focuses `#gateEmail`.
- `gate.close(email)`: hides `#gate`, removes `body.gated`, sets the sign-out button text, then calls `track.start(email)`.
- `gate.submit()`: reads `#gateEmail`, runs `gate.valid`; on failure writes "Enter a valid email address." to `#gateErr` and returns `false`; on success stores it under `pm_email`, clears `#gateErr`, calls `gate.close(email)` and returns `true`.
- `gate.signOut()`: removes `pm_email`, calls `track.end("signout")`, clears `#gateEmail`, calls `gate.open()`.
- Wire `#gateForm` submit (with `preventDefault`) to `gate.submit()`, and `#signOut` click to `gate.signOut()`. Use the same `$("id").onclick=` style the file already uses; for the form use `$("gateForm").onsubmit=`.
- Boot, added at the end of the existing boot block (after line 1011): `const e=gate.load(); if(e) gate.close(e); else gate.open();`. Under the test stubs this must not throw.
- Never render the email with `innerHTML`. `textContent` only.

### A4. Tracking logic
Add a `track` object with this state: `{sid:null, email:null, timer:null, active:false}`.

- **Session id.** `track.sid()` returns the id stored in `sessionStorage` under `pm_sid`, creating one with `crypto.randomUUID()` when absent (fallback: 16 random hex bytes from `crypto.getRandomValues`, and if `crypto` is missing, `Date.now().toString(36)+Math.random().toString(36).slice(2)`). One id per tab; a reload continues the same session.
- **Event shape.** Every event is one JSON object: `{v:1, type:"start"|"beat"|"end", sid, email, ts:<ISO 8601 now>, path:location.pathname, ref:document.referrer||"", tz:Intl.DateTimeFormat().resolvedOptions().timeZone||"", reason?:string}`. Nothing else: no user agent, no screen size, no IP-derived values.
- **Transport.** `track.send(event, {beacon:false})`. When `TRACK_URL` is empty, do nothing (one `console.info("tracking off: TRACK_URL is empty")` at boot, not per event). Otherwise POST to `TRACK_URL` with `Content-Type: text/plain;charset=UTF-8` and the JSON as the body. Use `fetch(TRACK_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=UTF-8"},body,keepalive:true,mode:"cors",credentials:"omit"})`, swallowing all errors. With `beacon:true` use `navigator.sendBeacon(TRACK_URL, new Blob([body],{type:"text/plain;charset=UTF-8"}))` when it exists and fall back to the fetch above. The text/plain type is deliberate: it is CORS-safelisted, so no preflight runs, and beacons during unload are not dropped.
- `track.start(email)`: sets `email`, resolves `sid`, sends `start`, then starts the heartbeat. Idempotent: calling it twice with the same email does not create a second timer.
- `track.beat()`: sends `beat` only when `document.visibilityState` is `"visible"` or undefined (the stub). Called from a `setInterval` every `TRACK_BEAT_MS`.
- `track.end(reason)`: sends `end` with `beacon:true`, clears the interval, sets `active:false`. Does nothing if not active.
- `track.stop()`: clears the interval without sending. Exists so tests can leave no live timers.
- Listeners, registered only when the API exists (`typeof document.addEventListener==="function"`, same for `window`): `document` `visibilitychange` sends a `beat` with `beacon:true` when the state becomes hidden and a normal `beat` when it becomes visible; `window` `pagehide` calls `track.end("pagehide")`.
- Wall time is not the metric. The collector credits at most `TRACK_BEAT_MS` of active time per beat (see B2), so a tab left open in the background does not inflate duration.

### A5. Copy that becomes false
- Line 225, the chooser intro: keep the sentence about the chooser, but change "no API key, no server, and no hidden model call" to "no API key and no hidden model call. The only thing sent anywhere is the usage record described at sign-in."
- Do not change the Recheck copy; it stays accurate.

## Part B: `collector/` (new folder, deploys to Vercel)

Keep it dependency-light and testable under `node --test` with the database mocked.

### B1. Files
- `collector/package.json`: `"type":"module"`, `"engines":{"node":">=22"}`, dependency `@neondatabase/serverless` (latest), scripts `"test":"node --test \"test/**/*.test.mjs\""`. No other dependencies.
- `collector/vercel.json`: `{"functions":{"api/*.js":{"runtime":"nodejs22.x"}}}` or the equivalent current syntax; check Vercel's docs rather than assuming.
- `collector/schema.sql`:

```sql
create table if not exists sessions (
  sid            text primary key,
  email          text not null,
  started_at     timestamptz not null,
  last_seen_at   timestamptz not null,
  ended_at       timestamptz,
  end_reason     text,
  beats          integer not null default 0,
  active_seconds integer not null default 0,
  path           text,
  referrer       text,
  tz             text
);
create index if not exists sessions_email_idx on sessions (email);
create index if not exists sessions_started_idx on sessions (started_at desc);
```

- `collector/lib/db.js`: exports `sql` from `neon(process.env.DATABASE_URL)`. Handlers must accept an injected `sql` so tests never touch the network: export `makeHandler(sql)` from each API module and `export default makeHandler(sql)`.
- `collector/lib/validate.js`: `parseEvent(text)` returns a clean event or throws. Rules: body at most 2 KB; must parse as JSON; `v===1`; `type` in `start|beat|end`; `sid` is 8 to 64 characters of `[A-Za-z0-9-]`; `email` passes the same regex and lowercasing as the page; `ts` parses as a date within 24 hours of the server clock, else replaced by the server clock; `path`, `ref`, `tz`, `reason` are strings truncated to 200 characters or empty.
- `collector/api/track.js`: `POST` only. CORS: respond with `Access-Control-Allow-Origin` equal to `process.env.ALLOWED_ORIGIN` only when the request `Origin` matches it exactly; also answer `OPTIONS` with 204 for safety even though the page avoids preflights. Read the raw body as text regardless of content type, run `parseEvent`, then:
  - `start`: upsert. Insert the row with `started_at=last_seen_at=ts`; on conflict update `last_seen_at`, `ended_at=null`, `end_reason=null` (a reload continues the session).
  - `beat`: `update sessions set beats=beats+1, active_seconds=active_seconds+least(30, greatest(0, extract(epoch from (ts-last_seen_at))))::int, last_seen_at=ts where sid=$1 and email=$2`. If no row matched, insert it as a `start` would, then apply the beat.
  - `end`: same crediting as a beat, plus `ended_at=ts, end_reason=$reason`.
  - Reply `204` on success, `400` with `{error}` on a validation failure, `405` for other methods, `500` with a generic message on a database error (log the real one). Never echo the body back.
- `collector/api/report.js`: `GET` only. Auth: `Authorization: Bearer <REPORT_TOKEN>` or `?token=` compared with `crypto.timingSafeEqual` against `process.env.REPORT_TOKEN`; missing or wrong gives `401` with no body. Serves one self-contained HTML page (inline CSS, no scripts, all values escaped) with three parts:
  1. Totals: distinct emails, sessions, sessions in the last 7 days, median active minutes.
  2. Per email, sorted by last seen desc: email, sessions, first seen, last seen, total active minutes.
  3. Last 100 sessions: started, email, active minutes, ended reason or "open", path, referrer, tz.
  Also serve `?format=csv` for part 2 with `Content-Type: text/csv`.
- `collector/README.md`: deploy steps in order. Create a Vercel project from this repo with Root Directory `collector`; add a Neon Postgres database from the Vercel Marketplace (it injects `DATABASE_URL`); run `schema.sql` once in the Neon SQL editor; set `ALLOWED_ORIGIN` to `PAGES_ORIGIN` and `REPORT_TOKEN` to a long random string; deploy; paste `https://<project>.vercel.app/api/track` into `TRACK_URL` in `index.html` and push. Include the exact `curl` to post a test `start` event and the report URL. State the privacy properties (no IP, no user agent, token-protected report) and how to delete one person's data (`delete from sessions where email=$1`).

### B2. Collector tests (`collector/test/*.test.mjs`)
Mock `sql` as a tagged template function that records the query text and parameters and returns canned rows. Cover: rejects non-POST; rejects a body over 2 KB; rejects a bad email, bad type, bad sid; accepts a `text/plain` body; `start` issues an upsert; `beat` credits at most 30 seconds; `end` sets `ended_at`; CORS header present only for the allowed origin; report returns 401 without the token and 200 with it; report escapes a `<script>` in an email or path.

## Part C: tests and CI for the page

- `test/harness.mjs`: add `addEventListener(type, fn)` on the `document` stub that records listeners in a `document._listeners` map, `visibilityState:"visible"`, `referrer:""`; add `addEventListener` to the `window` stub; add `navigator.sendBeacon` that records calls in `navigator._beacons` and returns `true`; add `location:{pathname:"/"}` to `window` and expose `location` to the script if it references it bare (prefer `window.location` in the script so no new global is needed). Add `"gate","track","TRACK_URL"` to `EXPORTS`. Accept an optional `trackUrl` override: when given, define it by prepending `const __TRACK_URL_OVERRIDE=...` and having the script read `typeof __TRACK_URL_OVERRIDE!=="undefined"?__TRACK_URL_OVERRIDE:""`. If that is uglier than you like, the acceptable alternative is a one-line string replace on `source` in the harness for `const TRACK_URL = "";`; document whichever you choose in a comment.
- New `test/gate.test.mjs`:
  1. Boot with no remembered email: `body` has class `gated`, `#gate` visible, and `modelCards` still rendered.
  2. `gate.valid` accepts `"  Sarah@Example.com "` as `"sarah@example.com"`, rejects `"nope"`, `"a@b"`, an empty string, and a 300-character address.
  3. Submitting an invalid email writes the error and stores nothing.
  4. Submitting a valid email stores it under `pm_email`, closes the gate, sets the sign-out text, and with `trackUrl` set posts one `start` event whose body parses to the event shape with the lowercased email and a `sid` that matches `pm_sid` in `sessionStorage`.
  5. Boot with a remembered email skips the gate and posts `start` without a submit.
  6. With `TRACK_URL` empty no fetch is called and nothing throws.
  7. `track.beat()` posts a `beat` when visible and nothing when `document.visibilityState="hidden"`.
  8. `track.end("x")` uses `sendBeacon` when present, otherwise fetch with `keepalive:true`, and a second `end` sends nothing.
  9. Sign-out removes `pm_email`, sends `end`, reopens the gate.
  10. Every test that starts tracking calls `track.stop()` in a `finally` so `node --test` exits.
- `test/smoke.test.mjs`: keep as is; if the boot now needs `gate` to be quiet under stubs, fix the script, not the test.
- `.github/workflows/ci.yml`: after `npm test`, add `npm ci --prefix collector` and `npm test --prefix collector`.

## Part D: README

Update these sentences; do not rewrite the rest:
- Line 13 "Everything runs in the browser. There is no server, no build step and no runtime dependency." becomes a statement that the page is still static with no build step, plus a new sentence that a small collector in `collector/` receives usage events.
- Add a section **Sign-in and usage tracking** after "Security model": what the gate is and is not (a sign-in sheet, not authentication; the source is public), the event shape, the 30-second heartbeat and the per-beat cap, what is stored, that the report is token-protected, and how to turn tracking off (`TRACK_URL=""`).
- In "Security model" > Persistence, add `pm_email` (localStorage) and `pm_sid` (sessionStorage).
- In the tests table add `test/gate.test.mjs` and a line for the collector suite.
- In "Repository notes", list `collector/` and this prompt file.

# Constraints
- `index.html` stays one file, LF line endings, no external scripts, no build step, no new global names beyond `gate`, `track`, `TRACK_URL`, `TRACK_BEAT_MS`.
- Nothing about the email or session ever passes through `innerHTML`.
- No IP address, user agent, or fingerprint is stored anywhere, client or server.
- The API key rules in the README stay exactly as they are; do not touch the Recheck code paths.
- The collector never returns stored data except on the token-protected report.
- Do not add a consent checkbox, retention job, or admin login UI; note them as follow-ups in your final message.
- Do not deploy anything. The deploy steps are documentation for the repository owner.

# Approach
1. Read the files listed under Context. Note line numbers in your final message for every insertion point you used.
2. Do Part C's harness changes first, then Part A, running `npm test` after each step so the existing suites stay green throughout.
3. Then Part B with its tests, then CI, then README.
4. Re-read your diff adversarially before the final run: what would make the gate block the smoke test, what would leave a timer running, where could an email reach `innerHTML`.

# Verification
- `npm test` passes at the repository root with all existing tests unchanged in behaviour and the new gate suite added.
- `npm test --prefix collector` passes with no network access.
- `node --test` exits on its own (no live intervals).
- Open `index.html` through `npm run serve`: the gate appears, an invalid address shows the error, a valid one opens the page, a reload skips the gate, Sign out brings it back. With `TRACK_URL` set to a local echo server (for example `python -m http.server` will show the POSTs as 501s in its log, which is enough to see the events firing), confirm `start` on load, `beat` every 30 seconds while visible, none while hidden, and `end` on tab close.

# Output
Lead with what was built and where. Then list every file changed with a one-line reason. Then list assumptions you made and gaps you found in this spec. Do not include the model name in commits or code comments.

---

## Open questions for the repository owner (not for the agent)

1. **Where should the collector live?** This prompt assumes Vercel plus Neon Postgres because both are free at this scale and Vercel injects the database URL for you. Two alternatives if you would rather not: a Cloudflare Worker with D1 (same shape, one `worker.js`, report queries run in the Cloudflare dashboard), or a Google Apps Script web app writing to a Google Sheet (zero infrastructure, the sheet is the report, but no CI-testable code and quirks around POST redirects). Say which and the agent can swap Part B.
2. **Consent and retention.** If any visitors are in the EU or UK, an email tied to activity is personal data. A consent checkbox on the gate and a "delete rows older than N days" job are each a few lines; they are left out here so you can decide.
3. **Verified emails.** If you later want to know the address is real, the smallest upgrade is a magic link sent by the collector. That changes the gate flow and is out of scope here.
4. **Should the gate cover the whole page or only the tools?** This prompt gates everything, since the request said "required login". Gating only the chooser and prompt builder would let the map and pricing stay public.

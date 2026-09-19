# AI Model Practical Map

A single static page (`index.html`) that maps twelve frontier AI models by practical strengths and list price, and helps you pick one for a specific job.

Live site: served by GitHub Pages from the `main` branch root.

## What the page does

1. **Task chooser.** Describe a job in plain text (or click a preset). The page scores the description for eight task signals and returns three picks: the cheapest model that clears the capability bar, the most capable model regardless of price, and the best practical balance of capability and cost.
2. **Prompt builder.** Up to ten short questions turn the job into a structured prompt (Role, Task, Deliverable, Constraints, Approach, Verification, Output) tuned to the chosen model. It also tells you which ChatGPT or Claude subscription tier fits the job and when an upgrade would pay off.
3. **Recheck.** Ask an AI to search the web for price, capability and availability changes since the snapshot date, review the findings one by one, and apply the ones you trust. Applied changes are stored in your browser and replayed on top of the published snapshot every load. Reset returns to the published snapshot.

The page itself is still one static file with no build step and no runtime dependency. Visitors enter an email before using it, and a small companion service in `collector/` (deployed to Vercel with a Postgres database) records who visited, when, for how long and which features they used, and serves an admin dashboard. See [Sign-in and usage analytics](#sign-in-and-usage-analytics).

## Running locally

Open `index.html` directly, or serve the folder so relative behaviour matches GitHub Pages:

```bash
npm run serve
```

That runs `python -m http.server 8765 --bind 127.0.0.1`. The same command is in `.claude/launch.json` for the Claude Code browser preview.

## Tests

```bash
npm test
```

Requires Node 22 or newer and nothing else. `test/harness.mjs` extracts the inline `<script>` from `index.html`, evaluates it against a stub DOM and stub storage, and returns the functions. The suites cover:

| File | Covers |
|---|---|
| `test/smoke.test.mjs` | The script boots and renders the snapshot; all presets produce picks |
| `test/xss.test.mjs` | Recheck-sourced text renders escaped in cards, pricing table and results |
| `test/chooser.test.mjs` | Word-boundary keyword matching, shared stakes signal, golden preset picks, no-signal notice |
| `test/recheck.test.mjs` | JSON parsing (fenced, prose-wrapped, truncated, hostile), patch validation, apply/reset loop, `callClaude` with a mocked API |
| `test/apikey.test.mjs` | Key storage rules |
| `test/gate.test.mjs` | The email gate: validation, identify flow, seven-day identity, refresh and return visits, switch user, collector failures never block |
| `test/track.test.mjs` | Sessions, idle timeout, active-time accounting, beacons, event validation, the named page events |
| `collector/test/*.test.mjs` | The collector with the database mocked: validation, identify, track, admin login and pages, report queries, migrations |

GitHub Actions runs both suites on every push and pull request (`.github/workflows/ci.yml`). The collector suite runs with `npm test --prefix collector` after `npm ci --prefix collector`.

The **golden test** in `test/chooser.test.mjs` records the current cheap/premium/balanced pick for each preset. If you retune scores or weights, that test will fail until you update it, which is the point: pick changes should be deliberate.

## How the data flows

One array, `models`, drives everything. It starts as a deep copy of `publishedModels` (the snapshot in the script) and Recheck replays applied patches on top of it. The model cards, pricing table, chooser and prompt builder all read from `models`, so an applied change shows up everywhere at once.

Each model has nine 0 to 10 scores (`breadth`, `depth`, `agent`, `code`, `long`, `research`, `multi`, `discipline`, `value`), list prices per million tokens (`input`, `output`, or `null` when not published per token), a `costTier` from 1 to 5, and editorial text (`desc`, `best`, `tags`).

To update the snapshot by hand, edit the `models` array and bump `PUBLISHED_AS_OF`, then update the dates in the hero stamp and footer and the matching assertions in `test/smoke.test.mjs`.

## How the chooser scores a job

- `patterns` lists keywords per signal. `signal()` counts hits and scales them to 0 to 10 (each hit is worth 2.2). Keywords match only where they start a word; keywords of three letters or fewer must end the word too. This stops "rapidly" registering as "api" and "webhook" as "web".
- `stakesWords` marks high-stakes or ambiguous jobs. It raises the chooser's `depth` need and is the same list Step 2 uses for task complexity, so the two panels agree.
- `capability()` is a weighted average of a model's scores, weighted by how strongly the job needs each signal.
- **Cheapest that works**: lowest `costTier` among models above the capability threshold (7.8 when depth, agent or code need is 7 or more, otherwise 7.25).
- **Best regardless of price**: highest capability match. Because GPT-6 Astra holds the top score on nearly every axis, this slot will be Astra for most jobs. That is a property of the editorial scores, not a bug in the ranking.
- **Best practical overall**: `capability * 0.78 + value * 0.22`. The value scores of the cheap models (9 to 9.8) make this slot lean toward them. If you want the balanced slot to favour capability more, the lever is the `.78 / .22` blend in `recommend()`; the golden test will show you what moves.

When no signal is detected at all, the page says so above the results and labels the picks as general-purpose defaults.

## Recheck JSON contract

Option B pastes a reply from any chat model. The page accepts a bare JSON object, a fenced ```` ```json ```` block, or JSON surrounded by prose, in this shape:

```json
{
  "checked_through": "YYYY-MM-DD",
  "changes": [
    {
      "kind": "price | capability | functionality | new-model",
      "model": "<id from the snapshot, or null for new-model>",
      "new_id": "<slug, new-model only>",
      "vendor": "<new-model only>",
      "title": "short headline",
      "summary": "old and new values in a sentence or two",
      "effective": "YYYY-MM-DD",
      "source": "https://...",
      "confidence": "high | medium | low",
      "patch": null
    }
  ]
}
```

`patch` may contain only: `input`, `output` (number or null), `name`, `desc`, `best` (strings, trimmed to 400 characters), `tags` (up to six strings of 40 characters), the nine scores (clamped to 0 to 10) and `costTier` (1 to 5). Anything else is dropped. `id` and `color` can never be set by a patch. A `new-model` entry needs a unique `new_id`, a `name` and all nine scores or it is recorded as a note only. `source` must start with `http://` or `https://`.

Option A sends the same prompt to the Claude API from the browser with server-side web search, then parses the reply the same way.

## Security model

- **Escaping.** Every model string that reaches `innerHTML` (name, vendor, description, best-for, tags) passes through `esc()`. Recheck text is untrusted: it comes from an AI reply, and in Option A that reply was shaped by web pages the model read. A patch containing HTML renders as literal text. `test/xss.test.mjs` proves it with the payload from the September 2026 review.
- **Validation.** `cleanPatch()` whitelists fields and clamps ranges; `normalizeChange()` drops unknown models, malformed new-model entries and non-HTTP sources.
- **API key.** Sent only to `api.anthropic.com`. If you tick "remember", it is kept in `sessionStorage` for the current tab and cleared when the tab closes. It is never written to `localStorage`, and any key an earlier version left there is removed at boot.
- **Persistence.** Applied Recheck changes live in `localStorage` under `pm_recheck`; plan choices under `pm_plans`; the last Recheck model under `pm_rcmodel`; the sign-in identity (email, collector token, expiry) under `pm_identity`. The current usage session id lives in `sessionStorage` under `pm_sid`. Reset clears `pm_recheck`; Switch user clears `pm_identity` and `pm_sid`.

## Sign-in and usage analytics

### What the gate is, and is not

Anyone opening the page sees an overlay asking for an email address, with a Continue button and one line saying what the email is for. There is no password and no verification email. It is a sign-in sheet, not a lock: nobody proves the address is theirs, and this file is public, so anyone can read the source and skip it. Its job is to put a name on each visit. Do not treat it as access control.

The identity system is built so that verification can be switched on later without changing anything downstream; see "Enabling magic-link verification later".

### How it works

1. On Continue, the page normalises the email (trim, lowercase) and POSTs it to `COLLECTOR_URL/api/identify`. The collector creates or finds the user and returns a random identity token that lasts seven days. The page stores `{email, token, exp}` in `localStorage` (`pm_identity`) and opens the map. A reload or a return visit within seven days skips the gate.
2. Every analytics request carries the token, never the email. The collector resolves the user from the token's SHA-256, so the browser cannot claim to be someone else, and a session id can only be written to by the user who started it.
3. A **session** is one continuous period of use in one tab (`pm_sid` in `sessionStorage`). Five minutes without activity ends it; the next click, key, scroll or pointer movement starts a new one. Closing the tab ends it; a reload resumes it.
4. **Active time** is counted client-side, one second at a time, only while the tab is visible and there has been activity in the last five minutes. Mouse movement and scrolling are throttled to once a second and are never sent. Every 30 seconds the accumulated seconds go out as one summarised `beat`; when the tab is hidden or closed the remainder goes out with `navigator.sendBeacon`. The collector credits at most 60 seconds per beat and never more than the wall time since the previous one, refuses beats closer than 20 seconds apart, and caps a session at 2000 events.
5. **Events.** Automatic: `application_opened`, `page_view`, `route_changed` (hash navigation), `nav_clicked`, plus session start and end. Named actions: `chooser_recommended` (matched signals and the description length, never the text), `chooser_preset_used`, `chooser_cleared`, `prompt_plan_changed`, `prompt_target_selected`, `prompt_built`, `prompt_copied`, `prompt_edited`, `recheck_opened`, `recheck_run` (mode and model, never the key), `recheck_results_loaded`, `recheck_applied`, `recheck_reset`. `trackEvent(name, meta)` is the helper; names are snake_case and the first segment is the feature.
6. Requests go out as `text/plain` so browsers need no CORS preflight and beacons during unload are not dropped. The collector parses the body as JSON regardless.
7. If the collector is unreachable, the visitor is still admitted (with a local one-day identity that is retried at the next boot) and the page works normally. Analytics failures never break the application. With `COLLECTOR_URL` empty, the gate still works and nothing is sent; that is how local work and the tests run.

### What is stored

Users (email, normalised email, first and last seen, totals), hashed identity tokens, sessions (start, last activity, end and reason, active seconds, page views, referrer, landing path, coarse browser family such as `Safari/macOS`) and events (name, feature, path, small metadata). No IP addresses, no raw user agent, no task text, prompt answers or API keys. See `collector/migrations/0001_init.sql`.

### The admin dashboard

`https://<your-collector>.vercel.app/admin/usage` (the collector's root URL redirects there). Login needs an email listed in `ADMIN_EMAILS` **and** the `ADMIN_KEY` you set in Vercel; because gate emails are unverified, being on the list alone is never enough. The dashboard shows summary tiles, daily charts, a sortable and searchable users table with CSV export, per-user detail (sessions, features, event history, a delete button that removes every trace of one person), and a recent-activity feed. It is server-rendered with no JavaScript and every value is escaped.

### Setup and configuration

The deploy steps, the environment variables and the local development recipe are in [`collector/README.md`](collector/README.md). In short: Vercel project with Root Directory `collector`, a Neon Postgres database from the Vercel Marketplace, two environment variables, then paste the collector URL into `COLLECTOR_URL` near the top of the script in `index.html`. The database tables are created automatically the first time you log in to the dashboard.

### Enabling magic-link verification later

Nothing in `users`, `sessions`, `usage_events` or the dashboard changes. The work is confined to issuance:

1. `collector/api/identify.js` stops returning a token. It stores a short-lived, single-use verification code (a new `verification_codes` table: code hash, user id, expiry) and emails a link `https://<collector>/api/verify?t=<code>` through any transactional mail service.
2. A new `collector/api/verify.js` looks up the code, sets `users.email_verified_at`, issues the identity token exactly as `identify` does today, and redirects to the page with the token in the URL fragment (never the query string), where the gate stores it as it does now.
3. In `index.html`, `gate.identify` shows "Check your email for a link" instead of closing the gate, and `gate.boot` reads a token from the fragment on load.
4. `ADMIN_KEY` can then be retired: the admin login becomes "verified email in `ADMIN_EMAILS`".

## Known limits

- The chooser is a keyword heuristic. It reads the words you use, not the job behind them. Vague descriptions get general-purpose defaults.
- Prices and plan quotas go stale. The snapshot date is in the hero; Recheck exists to move it forward.
- Option A depends on the web-search tool type and beta header named in `callClaude()`. If Anthropic renames them the call will fail with a 400 that names the field. It has not been exercised against a live key in this repository.
- Recheck state grows without a cap. Reset clears it.

## Repository notes

- `index.html` is committed with LF line endings; Windows checkouts see CRLF through `core.autocrlf`. Editors should preserve whichever they find.
- `practical-map-prompt-generator.prompt.md` is a task brief for a future feature, kept in the repo root but excluded from git.
- `collector/` is the companion service (Vercel serverless functions plus Neon Postgres) that receives sign-ins and usage events and serves the admin dashboard. It has its own `package.json`, tests and README. Its only dependency is `@neondatabase/serverless`.
- `email-gate-usage-tracking.prompt.md` is the task brief the sign-in gate and analytics were built from, kept for reference.
- `index.html.html` is a stray local copy and is ignored by `.gitignore`. Do not commit it.

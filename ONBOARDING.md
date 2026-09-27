# Onboarding: AI Model Practical Map

Welcome aboard. This is the stuff that isn't in the README: why things are the way they are, what's broken before, and where the trapdoors are. Read it once end to end, then keep it as a map. Things change, and this file should change with them.

> **Honesty note.** Everything below comes from the code, the two READMEs and the full commit history (47 commits, 17–19 Sep 2026). Where the repo has no evidence (custom skills, MCP servers, secret rotation), this guide says so and leaves a **TODO(owner)**. A guess dressed up as fact is worse than a blank.

---

## 1. Team / Project Identity

**What it is.** A single static web page, `index.html`, that maps twelve frontier AI models by practical strengths and list price, then helps you:

1. **pick** a model for a job (task chooser),
2. **brief** it (prompt builder, plus an optional Claude Fable 5.1 "forge" rewrite),
3. **keep the map fresh** (Recheck: an AI searches the web for price/capability changes and you apply the ones you trust).

Visitors enter an email first. A small companion service in `collector/` records usage and serves an admin dashboard.

```
            ┌──────────────────────── browser ─────────────────────────┐
            │  index.html  (GitHub Pages, main branch root)            │
            │  ┌─────────┐   ┌──────────────┐   ┌─────────┐  ┌───────┐  │
            │  │ chooser │──▶│prompt builder│──▶│  forge  │  │Recheck│  │
            │  └─────────┘   └──────────────┘   └────┬────┘  └───┬───┘  │
            │        gate + track                    │ your key  │      │
            └──────────┬─────────────────────────────┼───────────┼──────┘
                       │ token in body, text/plain   │           │
                       ▼                             ▼           ▼
        collector/ on Vercel ──▶ Neon Postgres    api.anthropic.com
        /api/identify, /api/track, /admin/usage   (the only other origin)
```

| | |
|---|---|
| **Owner** | Sarah Schuyler (`sarahschuyler-stack`). Merges every PR. |
| **Maintainers** | Sarah, plus Claude Code sessions, which author nearly every commit. See §7. |
| **Live page** | `https://sarahschuyler-stack.github.io/ai-model-practical-map/` |
| **Collector** | `https://ai-model-practical-map.vercel.app` (dashboard at `/admin/usage`) |
| **Stack** | Page: vanilla HTML/CSS/JS, one file, no build. Collector: Node 22 Vercel functions, one dependency (`@neondatabase/serverless`). |
| **Tests** | `npm test` (page, 99 tests) and `npm test --prefix collector`. Node 22+, no browser. |

**TODO(owner):** who the page is *for* (you? clients? the public?) and whether anyone besides Sarah is expected to review PRs.

---

## 2. Architecture Principles

Think of the page as a **lighthouse**: one tower, no moving parts you can't see from the shore. Everything below protects that.

### The non-negotiables

1. **One file, no build step, no runtime dependency.** `index.html` holds styles, markup and one inline `<script>`. If a change needs a bundler, it's the wrong change.
2. **Untrusted text is escaped, then fenced.** Every model string headed for `innerHTML` goes through `esc()`. A strict CSP (`default-src 'none'`, exact origins in `connect-src`) is the second wall. **Never a wildcard origin.**
3. **Claims and code can't drift apart.** If the README says something about security, a test checks it. `test/csp.test.mjs` compares the CSP meta tag with the README's quoted policy *character for character*.
4. **Failure never costs the user anything.** Collector down? You're admitted anyway. Forge call fails? The draft stays put. Storage blocked? The page works in memory and tells you once.
5. **Collect the minimum.** Analytics carry a token, never the email. No IPs, no raw user agents, no task text, no prompts, no API keys. The API key only ever goes to `api.anthropic.com`, and only lives in `sessionStorage`.

### Patterns we use

| Pattern | Why |
|---|---|
| Small state objects (`rc`, `pb`, `gate`, `track`, `forge`) beside each other in the script | The test harness can reach them directly, with no framework needed. |
| Test harness slices the `<script>` out of `index.html` and runs it against a stub DOM | Real code under test, zero dependencies, CI in seconds. |
| Named constants for every tuning knob (`HIT=2.2`, `STAKE=2`, `CAP_FLOOR`, `CAP_SLOPE`) | A rescale can't silently strand a gate between cue counts (see §5, #1). |
| **Golden tests** for chooser picks | Pick changes should be *deliberate*. If a golden test fails, that's the point. |
| Playbooks as data (`playbooks` array: `strong`, `weak`, `excl`, `implies`) | Domain knowledge is added by adding a row, not a branch of `if`s. |
| Idempotent migrations applied on first admin login | Deploying needs no terminal. |
| `text/plain` POSTs to the collector | No CORS preflight, and unload beacons don't get dropped. |

### Patterns we reject

| Rejected | Why |
|---|---|
| Frameworks, bundlers, npm runtime deps on the page | Breaks rule 1; GitHub Pages serves it as-is. |
| Cookies between page and collector | Different origins means third-party cookies, and Safari blocks those. The token travels in the request body instead. |
| `localStorage` for the API key | Any injected script could read it forever. Purged at boot if an old version left one. |
| `https://*.vercel.app` in the CSP | Shared multi-tenant domain; anyone can deploy there. |
| Treating the email gate as access control | It's a sign-in sheet, not a lock. The source is public; anyone can skip it. |
| In-memory rate limiting in the collector | Serverless instances don't share memory. Counts live in Postgres. |
| Substring keyword matching | "rapidly" contains "api", "contest" contains "test". Word boundaries only. |

---

## 3. Decision History

The ten decisions that shaped the project, oldest first.

| # | Decision | Chose | Rejected | Why |
|---|---|---|---|---|
| 1 | **Hosting** (`15bae67`) | Static page on GitHub Pages | Any server-rendered app | Free, zero-ops, nothing to patch. |
| 2 | **Testing** (`afcb3d5`, `87cb7aa`) | Node `--test` harness that evaluates the inline script against a hand-built stub DOM that parses `innerHTML` | Playwright/jsdom in CI | Zero deps and fast. The stub later grew a real element tree so clicks could be tested. |
| 3 | **Key storage** (`d53d311`) | `sessionStorage`, opt-in, purged from `localStorage` at boot | "Remember me" in `localStorage` | An XSS slip would have leaked a key that sat on disk indefinitely. |
| 4 | **Defence in depth** (`4a6d82c`, `24661f6`) | `esc()` everywhere *plus* a CSP | Escaping alone | Recheck text comes from an AI that read arbitrary web pages. Treat it as hostile. |
| 5 | **Prompt builder** (`ac92d01`) | Read the Step 1 description first; playbooks write the brief; questions are optional extras | A short fixed template driven by wizard answers | The job description is the richest input. Skipping every question should still produce a full brief. |
| 6 | **Analytics architecture** (`0733875` → `a7fe1b6`) | Keep the page static; add `collector/` on Vercel + Neon Postgres; token-in-body identity; admin on the collector's own origin with an HttpOnly cookie | Supabase or an auth platform; moving hosting to Vercel; cookies across origins | Smallest thing that can record "who, how often, how long". The brief was written first and committed (`email-gate-usage-tracking.prompt.md`). |
| 7 | **Email-only gate now, magic link later** | Unverified email, seven-day token, schema ready for verification | Passwords or verification on day one | Goal is putting a name on visits, not locking the door. The upgrade path touches only `identify.js` + a new `verify.js`. |
| 8 | **Admin login hardening** (`5149108`) | `ADMIN_EMAILS` **and** a 16+ char `ADMIN_KEY`; per-source failure counts in Postgres (8 per 15 min → 429); sources stored as HMAC of IP | Email list alone; in-memory throttling; storing IPs | Gate emails are unverified, so being on the list proves nothing. |
| 9 | **Chooser scoring** (`a564e41`) | No floor on needs; threshold rises with demand (`7.2 + 0.175 × peak need`) | Flooring every need at 0.8; a fixed 7.8/7.25 threshold | The old math excluded nobody on any of 38 probe vectors, so "cheapest that works" was the same two models for every job on earth. |
| 10 | **Forge authoring model** (`78e3d66`) | Fable 5.1 always authors; the user's pick executes; built-in draft is always kept | Replacing the draft; letting the target model write its own brief | Writing the prompt is the harder, higher-stakes job. A failed call must cost nothing. |

Two smaller ones worth knowing: **exclusions suppress playbooks** (`8971348`: "do not touch the database" now actually removes the database playbook), and **exact-origin CSP** (`1c6980c`: the wildcard added during a merge was removed and a test now blocks it coming back).

---

## 4. Skill / Command Conventions

**Current state: there are none in the repo.** No `.claude/` directory, no `CLAUDE.md`, no custom skills or slash commands are tracked. (`.claude/launch.json` exists in some local trees but is deliberately untracked; see `5b0a6a7`.)

What the repo *does* have is a de facto convention for **task briefs**, which play the role skills would:

- **Big features start as a committed `*.prompt.md` brief.** `email-gate-usage-tracking.prompt.md` was committed, refined, then built from, and kept for reference. Name pattern: `<feature-in-kebab-case>.prompt.md` at the repo root.
- **Personal or scratch briefs stay out of git** via `.git/info/exclude` (per-clone, never pushed), e.g. `practical-map-prompt-generator.prompt.md`.
- **Event names** (`trackEvent`) are `snake_case`, first segment is the feature: `chooser_recommended`, `prompt_copied`, `recheck_applied`.
- **Storage keys** are prefixed `pm_`.

**Proposed rule for when skills arrive** (TODO(owner): adopt or change):

- Write a **new skill** when the same multi-step procedure has been done twice by hand. Candidates: "update the model snapshot" (edit `models`, bump `PUBLISHED_AS_OF`, fix hero/footer dates and `test/smoke.test.mjs`) and "deploy/point at a collector" (two edits + README CSP block in one commit).
- **Reuse** a built-in (`/code-review`, `/security-review`, `/simplify`) for anything generic.
- Name skills `pm-<verb>-<noun>` (e.g. `pm-update-snapshot`) so they sort together and don't collide with built-ins.

---

## 5. Failure Modes + Fixes

The greatest hits of things that broke, and how each was put right. Most were found in the September 2026 review (PR #4).

| # | What broke | Root cause | Fix |
|---|---|---|---|
| 1 | **"Cheapest that works" was the same two models for every job** | `capability()` floored every need at 0.8, drowning the real signal; the threshold sat below every model's score | Dropped the floor, made the threshold scale with peak need, added a 38-vector probe test (`a564e41`) |
| 2 | **Stored XSS via Recheck** | Model fields rendered with `innerHTML` unescaped; applied patches persisted, so the payload ran on every load | `esc()` on every model string, a test with the reviewer's payload (`4a6d82c`), then a CSP (`24661f6`) |
| 3 | **"rapidly" meant you needed an API** | Keyword matching by substring | Word-boundary matching; ≤3-letter words must be whole (`75fae0b`) |
| 4 | **"Do not touch the database" produced… a database** | Exclusions were printed but never used; the bare word "login" fired the gate playbook | Every playbook declares `excl`; everyday single words need a second hit (`8971348`) |
| 5 | **18 tests failed the moment analytics were switched on** | The harness string-replaced the exact text `const COLLECTOR_URL = "";` | Match the declaration by identifier with a regex; always set it (`ff8aec6`) |
| 6 | **CSP silently allowed any `*.vercel.app`** | Added during a merge to make the collector reachable | Exact origin only; test rejects wildcards and matches the README block (`1c6980c`) |
| 7 | **Storage failures vanished** | Four empty `catch {}` blocks | `storageWarn()` logs once per cause and shows one notice (`5dd7abc`) |
| 8 | **Recheck said "JSON parse error" when it really ran out of time** | `pause_turn` after the fifth continuation fell into the parser | Name the exhausted budget in plain words (`2960086`); also handle truncation, timeouts, `max_tokens` (`7e79ded`) |
| 9 | **Different changes with the same title got dropped** | Dedup matched on kind + model + title | `sameChange()` compares summary, date and patch too (`a3f99da`) |
| 10 | **CSS class collisions stretched the layout** | `.sub` and `.rec` reused across unrelated components | Renamed to `.subcard` and `.isrec` (`af6f199`, `48aef17`) |

**The pattern behind the pattern:** almost every bug was a *claim that wasn't enforced*. The fix is always the same shape: make the code do it, then add a test that fails if it stops.

---

## 6. Integration Notes

### Services the product talks to

| Service | Used for | Notes |
|---|---|---|
| **Anthropic API** (`api.anthropic.com`) | Recheck Option A (with web search) and the prompt forge (no search, 12k-token ceiling) | Called straight from the browser with the *user's own* key (`anthropic-dangerous-direct-browser-access`). **Flaky spot:** the web-search tool type and beta header in `callClaude()` are pinned strings. If Anthropic renames them, Option A fails with a 400 naming the field. There's an automatic retry without the fallback beta header. Per the README, it has never been exercised against a live key in this repo. |
| **Vercel** | Hosts `collector/` (Root Directory = `collector`) | Rewrites in `collector/vercel.json` map `/admin/*` to `/api/admin/*`. |
| **Neon Postgres** | Users, tokens, sessions, events, login failures | Attached from the Vercel Marketplace; injects `DATABASE_URL`. |
| **GitHub Pages** | Serves `index.html` from `main` | Redeploys a minute or two after a push. |
| **GitHub Actions** | `.github/workflows/ci.yml`: both test suites on every push and PR | |

### MCP servers

**None are configured in the repo** (no `.mcp.json`, no `.claude/settings.json`). TODO(owner): if your Claude sessions rely on connectors (GitHub, Vercel, etc.), list them here with a line on which ones have misbehaved.

### Auth and secrets

- **Secrets live in Vercel, never in git.** `.gitignore` blocks `.env` and `.env.*`; `collector/.env.example` is the only template.
- Collector env vars: `DATABASE_URL` (from Neon), `ADMIN_EMAILS`, `ADMIN_KEY` (16+ chars; also seeds the cookie-signing secret, so changing it logs everyone out), optional `ALLOWED_ORIGIN` (defaults to `https://sarahschuyler-stack.github.io`).
- Visitor identity: a random seven-day token; only its SHA-256 is stored.
- Admin sessions: signed HttpOnly cookie, 12 hours.
- The user's Anthropic key: never leaves the browser except to Anthropic; never touches our collector.
- TODO(owner): rotation cadence for `ADMIN_KEY`, and who else (if anyone) has Vercel access.

---

## 7. Team Workflows

How AI fits into the cadence today, reconstructed from the history:

```
 Sarah states the job ──▶ Claude Code session on a claude/<name> branch
         ▲                          │  writes code + tests + README in ONE commit
         │                          ▼
   merges PR  ◀── CI green ◀── PR opened ◀── push
```

- **Every change arrives as a PR from a `claude/<adjective>-<scientist>-<id>` branch** (earlier ones used `feat/prompt-builder`). Sarah merges. There's no branch protection or review bot visible in the repo.
- **Big work starts with a brief, not code.** For the email gate: brief committed (`0733875`), refined with the owner's six phases (`bf66872`), then built (`a7fe1b6`).
- **Periodic review passes.** The September 2026 review produced a numbered list of weaknesses; each fix commit cites its number ("review weakness #3").
- **Commit messages are essays, on purpose.** They explain the root cause, what changed, what *didn't* change, and which assertions moved and why. Match that style: it's the project's real decision log.
- **Docs ship with code.** If behaviour changes, the README changes in the same commit. Tests enforce some of this (the CSP block).
- **Merging main into a branch** gets its own commit explaining how conflicts were resolved (`28abc7a`, `cd776d4`).
- AI-authored commits carry `Co-Authored-By` and `Claude-Session` trailers, so you can trace any change back to the conversation that made it.

TODO(owner): is there a release/announce step after merge, or does "merged to main" = shipped?

---

## 8. Things I Wish I Knew On Day 1

A few parables, one line each:

1. **The README is slightly behind the code in one spot.** "How the chooser scores a job" still describes the old 7.8/7.25 threshold and says Astra wins the premium slot "for most jobs". Since `a564e41` the threshold is `7.2 + 0.175 × peak need`, and premium varies by job. Trust `index.html` around line 533. (Good first PR!)
2. **`collector/README.md` describes a fresh deploy, not today's repo.** Step 6's "before" CSP and the local-development note ("the policy in the repository allows only `https://api.anthropic.com`") predate `9bd4480`. The shipped policy already includes the collector origin.
3. **Changing the CSP is a three-place edit:** the meta tag on line 10 of `index.html`, the quoted block in `README.md`, and (if it's a new collector) `COLLECTOR_URL` around line 434. The CSP test fails if the first two disagree.
4. **For local collector work, keep your edits out of the commit.** Pointing `COLLECTOR_URL` at `localhost:3000` and widening the CSP are local-only changes.
5. **Updating the model snapshot is four edits:** the `models` array, `PUBLISHED_AS_OF`, the hero stamp + footer dates, and `test/smoke.test.mjs`.
6. **A golden test failing after a scoring tweak isn't a bug.** It's a signature line: update the expected picks *and say why in the commit*.
7. **`index.html.html` exists in some trees.** It's a stray copy. `.gitignore` catches it; never commit it.
8. **Line numbers in older briefs are stale.** `email-gate-usage-tracking.prompt.md` says the script starts at line 344 of a 1014-line file. The file is now ~2040 lines.
9. **The gate is a guest book, not a bouncer.** Never build anything that assumes a signed-in email is really that person, until magic-link verification lands.
10. **Node 22 locally.** The harness and collector both need it; nothing else to install for the page.

---

*Maintainers: when you fix something that surprised you, add a line to §5 or §8. That's how this stays true.*

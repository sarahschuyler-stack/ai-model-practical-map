# Welcome to the Practical Map 🗺️

Hi, I'm Sarah. I'm glad you're here.

This is the guide I wish someone had handed me: why things are the way they are, what's broken before, and where the trapdoors are. It won't take long to read, and it'll save you a bad afternoon or two.

One promise before we start: where I don't know something yet, I've written **TODO(Sarah)** instead of making it up. A blank is honest. A confident guess is a trap with a welcome mat.

---

## 1. Who we are and what this is

**The Practical Map is one web page that helps people pick the right AI model for a job, and then brief it well.**

Picture a trail guide at a trailhead. You say "I need to get over that ridge before dark." They check the weather and your boots, then point you to a path. Then they hand you a map with the tricky turns already circled. That's the page:

| Step | What it does | The trail-guide version |
|---|---|---|
| **Task chooser** | Scores your job description; returns the cheapest model that can do it, the strongest one, and the best balance | "Here are three paths" |
| **Prompt builder** | Turns your description into a full brief for the model you picked | "Here's your map, turns circled" |
| **Prompt forge** *(optional)* | Claude Fable 5.1 rewrites that brief like a specialist would | "A local redrew it for you" |
| **Recheck** | An AI searches the web for price and capability changes; you approve the ones you trust | "The trail moved; update the map" |

Visitors enter an email first, and a little service in `collector/` keeps count of who came by and what they used.

```
 ┌──────────────── the visitor's browser ────────────────┐
 │  index.html   (GitHub Pages, straight from main)      │
 │  chooser ─▶ prompt builder ─▶ forge      Recheck      │
 │  email gate + usage tracker     │           │         │
 └──────┬──────────────────────────┼───────────┼─────────┘
        │ token, never the email   │  the visitor's own API key
        ▼                          ▼           ▼
  collector/ on Vercel ─▶ Neon Postgres    api.anthropic.com
  (sign-in, usage, admin dashboard)        (the only other door)
```

| | |
|---|---|
| **Owner** | Me, Sarah Schuyler (`sarahschuyler-stack`). I merge every PR. |
| **Maintainers** | Me, plus Claude Code sessions, which write most commits (§7). |
| **Live page** | https://sarahschuyler-stack.github.io/ai-model-practical-map/ |
| **Collector** | https://ai-model-practical-map.vercel.app (dashboard at `/admin/usage`) |
| **Stack** | Plain HTML/CSS/JS in one file. The collector is Node 22 on Vercel with a single dependency. |
| **Tests** | `npm test` (99 for the page) and `npm test --prefix collector`. Node 22, no browser needed. |

**TODO(Sarah):** who the page is really for, and whether anyone else reviews PRs.

---

## 2. The house rules

Think of the page as a **lighthouse**: one tower, no hidden machinery, easy to see from shore. These five rules keep it standing.

1. **One file. No build step. No runtime dependencies.** If a change needs a bundler, it's the wrong change. GitHub Pages serves the file exactly as it is.
2. **Treat outside text as mud on its boots.** Every string headed for `innerHTML` gets wiped with `esc()`. Behind that is a strict Content-Security-Policy that lists exact origins only. **Never a wildcard.**
3. **If the README promises it, a test checks it.** `test/csp.test.mjs` compares the policy in the page with the one quoted in the README, character for character. A claim nobody checks eventually turns into a myth.
4. **Failure costs the visitor nothing.** Collector down? They get in anyway. Forge fails? The draft stays put. Storage blocked? The page runs in memory and says so once.
5. **Take only what you need.** Analytics carry a token, never the email. No IP addresses, no raw user agents, nothing anyone typed, no API keys. A visitor's Anthropic key goes to Anthropic and nowhere else, and it lives in `sessionStorage` only.

### What we do, and what we don't

| ✅ We do | ❌ We don't | Why |
|---|---|---|
| Keep small state objects (`rc`, `pb`, `gate`, `track`, `forge`) in the script | Pull in a framework | Tests can reach the objects directly |
| Run the real script against a hand-built stub DOM | Put jsdom or Playwright in CI | Zero dependencies, and the suite finishes in seconds |
| Name every tuning knob (`HIT = 2.2`, `CAP_FLOOR`, `CAP_SLOPE`) | Leave magic numbers around | Retuning can't quietly break a threshold that depends on another number |
| Keep **golden tests** for the chooser's picks | Let picks drift | Changing a pick should be a decision, not an accident |
| Store playbooks as data (`strong`, `weak`, `excl`, `implies`) | Pile up `if` branches | New knowledge means one new row |
| Send the collector token in the request body, as `text/plain` | Use cookies across origins | Safari blocks third-party cookies, and plain text skips the CORS preflight |
| Count failed admin logins in Postgres | Rate-limit in memory | Serverless instances don't share memory |
| Match whole words | Match substrings | Otherwise "rapid**ly**" contains "api" |

---

## 3. The big decisions

Ten forks in the road, and why I picked the path I did.

1. **A static page on GitHub Pages, not a server.** It's free, needs no upkeep, and has nothing to patch at 2 a.m.
2. **Homegrown tests, not browser tests** (`afcb3d5`, `87cb7aa`). The harness lifts the `<script>` out of `index.html` and runs it against a stub DOM. That stub eventually learned to parse `innerHTML`, so tests can click buttons.
3. **The API key lives in `sessionStorage`, not `localStorage`** (`d53d311`). A key sitting on disk forever is a key waiting to be stolen. Any old copy gets purged at boot.
4. **Escaping *and* a CSP, not escaping alone** (`4a6d82c`, `24661f6`). Recheck text comes from an AI that has been reading strange websites, so I treat it like a stranger's USB stick.
5. **The job description drives the brief; the questions are optional** (`ac92d01`). What you describe in Step 1 is the richest thing we get, so skipping every question still gives you a full brief.
6. **Keep the page static and add a small collector** (`0733875` → `a7fe1b6`). I rejected Supabase, auth platforms and moving hosting to Vercel. I also wrote the brief *before* the code, and it's still in the repo (`email-gate-usage-tracking.prompt.md`).
7. **An email-only gate for now, magic links later.** The gate exists to put a name on each visit, not to lock the door. The upgrade touches only `identify.js` and a new `verify.js`.
8. **Admin login needs a listed email *and* a key of 16+ characters** (`5149108`). The email alone proves nothing, because gate emails aren't verified. Eight failures in 15 minutes gets a 429, and sources are stored as an HMAC of the IP, never the IP itself.
9. **Capability scoring that depends on the job** (`a564e41`). The old math excluded nobody, so "cheapest that works" named the same two models for every job on earth. The threshold now rises with what the job demands: `7.2 + 0.175 × peak need`.
10. **Fable writes the brief; your chosen model runs it** (`78e3d66`). Writing a good brief is the harder job, so the strongest model does it. The built-in draft is always kept, so a failed call costs nothing.

Two small ones with a big effect: "do not touch the database" now actually removes the database playbook (`8971348`), and a test now blocks wildcard origins from ever sneaking back into the CSP (`1c6980c`).

---

## 4. Skills and commands

**Honest answer: we don't have any yet.** There's no `.claude/` folder, no `CLAUDE.md`, and no custom slash commands in the repo.

What we *do* have are habits that work like skills:

- **Big features start as a brief.** Commit it as `<feature-name>.prompt.md` at the repo root, refine it, then build from it.
- **Scratch briefs stay out of git.** Put them in `.git/info/exclude`, which only affects your clone and never gets pushed.
- **Event names** are `snake_case`, and the first word is the feature: `chooser_recommended`, `prompt_copied`.
- **Storage keys** start with `pm_`.

**My rule of thumb for later:** once we've done the same chore by hand twice, it becomes a skill named `pm-<verb>-<noun>`. The first two in line are `pm-update-snapshot` and `pm-connect-collector`. For anything generic, use a built-in (`/code-review`, `/security-review`, `/simplify`) instead of reinventing it.

---

## 5. Things that broke (and how we fixed them)

A parable first. A shopkeeper hung a sign reading **"Door always locked."** Every night she walked past it feeling safe. One morning the till was empty: the sign was true when she hung it, and nobody had checked since.

Nearly every bug on this list is that sign.

| # | What broke | Why | The fix |
|---|---|---|---|
| 1 | "Cheapest that works" was always the same two models | Every need was floored at 0.8, drowning the real signal | Removed the floor, made the threshold move with the job, added a 38-vector probe test (`a564e41`) |
| 2 | Stored XSS through Recheck | Model text went into `innerHTML` unescaped, and applied patches persisted | `esc()` on every string, then a CSP (`4a6d82c`, `24661f6`) |
| 3 | "rapidly" meant you needed an API | Keywords matched as substrings | Word-boundary matching (`75fae0b`) |
| 4 | "Don't touch the database" produced… a database | Exclusions were printed but never used | Playbooks declare `excl`; common single words need a second hit (`8971348`) |
| 5 | 18 tests failed the moment analytics went live | The harness looked for the exact text `COLLECTOR_URL = ""` | It now matches the variable name, whatever its value (`ff8aec6`) |
| 6 | The CSP quietly allowed any `*.vercel.app` | A merge added it as a shortcut | Exact origin only, enforced by a test (`1c6980c`) |
| 7 | Storage failures vanished silently | Four empty `catch {}` blocks | Warn once per cause and show one notice (`5dd7abc`) |
| 8 | Recheck reported "bad JSON" when it had really run out of time | A paused turn fell into the JSON parser | Say "out of budget" in plain words (`2960086`, `7e79ded`) |
| 9 | Different changes that shared a title got dropped | Deduplication compared only titles | Compare summary, date and patch too (`a3f99da`) |
| 10 | Layout stretched in odd places | CSS class names `.sub` and `.rec` collided | Renamed to `.subcard` and `.isrec` (`af6f199`, `48aef17`) |

**The moral:** a promise isn't kept until a test keeps it.

---

## 6. Who we talk to

| Service | What for | Watch out |
|---|---|---|
| **Anthropic API** | Recheck with web search, and the prompt forge | Called straight from the browser with the visitor's own key. ⚠️ **The flaky spot:** the web-search tool name and beta header are pinned strings in `callClaude()`. If Anthropic renames them, you'll see a 400 that names the field. There's one automatic retry without the beta header. It has never been run against a live key in this repo. |
| **Vercel** | Hosts `collector/` (Root Directory `collector`) | `/admin/*` routes are rewritten in `collector/vercel.json` |
| **Neon Postgres** | Users, tokens, sessions, events, failed logins | Attached from the Vercel Marketplace; it provides `DATABASE_URL` |
| **GitHub Pages** | Serves the page from `main` | Takes a minute or two after each push |
| **GitHub Actions** | Runs both test suites on every push and PR | |

**MCP servers:** none are configured in the repo. **TODO(Sarah):** list the connectors my Claude sessions lean on, and which ones have been moody.

### Secrets, kept like a spare house key: somewhere safe, never under the mat

- **Secrets live in Vercel, never in git.** `.gitignore` blocks `.env*`, and `collector/.env.example` is the only template.
- **Collector variables:** `DATABASE_URL`, `ADMIN_EMAILS`, `ADMIN_KEY` and an optional `ALLOWED_ORIGIN`. `ADMIN_KEY` also signs the admin cookies, so changing it logs everyone out.
- **Visitor tokens** last seven days, and only their SHA-256 is stored.
- **Admin sessions** use a signed HttpOnly cookie that lasts 12 hours.
- **TODO(Sarah):** how often to rotate `ADMIN_KEY`, and who else has Vercel access.

---

## 7. How work gets done

AI does most of the typing here; I do the steering and the merging.

```
  I describe the job ──▶ a Claude Code session on a claude/<name> branch
          ▲                        │  code + tests + README, together
          │                        ▼
     I merge   ◀── CI goes green ◀── PR opened
```

- **Every change arrives as a PR from a `claude/...` branch**, and I merge it. There's no branch protection yet.
- **Big work starts with a brief, not code.** Write it, refine it, then build.
- **Review passes come in rounds.** The September 2026 review produced a numbered list of weaknesses, and each fix commit cites its number.
- **Commit messages are little essays, on purpose.** They cover the root cause, what changed, what *didn't*, and which test expectations moved and why. The history is our real decision log, so please keep writing them that way.
- **Docs ship with the code, in the same commit.** Some of this is enforced by tests.
- **AI commits carry `Co-Authored-By` and `Claude-Session` lines**, so any change can be traced back to the conversation that produced it.

**TODO(Sarah):** is there a "we shipped it" step, or does merged mean live?

---

## 8. What I wish I'd known on day one

1. **The main README is a little behind the code.** It still describes the old 7.8/7.25 threshold and says Astra wins "best regardless of price" for most jobs. Trust `index.html` around line 533. *(A lovely first PR, if you want one.)*
2. **`collector/README.md` describes a fresh deploy, not today's repo.** The live CSP already includes the collector.
3. **A CSP change touches three places:** the meta tag (line 10 of `index.html`), the quoted block in the README, and `COLLECTOR_URL` (around line 434) if the collector moves.
4. **Local collector tweaks stay local.** Pointing at `localhost:3000` and widening the CSP should never land in a commit.
5. **Updating the model snapshot takes four edits:** the `models` array, `PUBLISHED_AS_OF`, the hero and footer dates, and `test/smoke.test.mjs`.
6. **A golden test failing after a scoring tweak isn't a bug.** It's asking you to sign off. Update the expected picks and say why in the commit.
7. **`index.html.html` is a stray copy** found in some working trees. `.gitignore` catches it; please don't commit it.
8. **Old briefs quote old line numbers.** The page has roughly doubled in size since then (about 2,040 lines now).
9. **The gate is a guest book, not a bouncer.** Don't build anything that assumes an email proves who someone is, not until magic links arrive.
10. **Install Node 22, and that's all you need** to work on the page.

---

*You'll find something that surprises you. When you do, add a line to §5 or §8. That's how this guide stays true, and how the next person gets a better day one than you did.* 💛

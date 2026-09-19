# Practical Map collector

The small service behind the sign-in gate on `index.html`. It creates users, issues identity tokens, records sessions and events, and serves the admin dashboard. Vercel serverless functions, Neon Postgres, one dependency.

## Deploy (about ten minutes, no terminal needed)

1. **Create the Vercel project.** In Vercel, *Add New → Project*, import the `ai-model-practical-map` GitHub repository. Before you click Deploy, open *Root Directory* and set it to `collector`. Leave Framework Preset as *Other*. Click Deploy. The first deploy will show a login page that says the dashboard is not configured yet; that is expected.
2. **Attach a database.** In the project, open the *Storage* tab, *Create Database*, choose *Neon* (Postgres), accept the free plan and connect it to the project. This adds `DATABASE_URL` to the project's environment variables for you.
3. **Set two variables.** *Settings → Environment Variables*, add:
   - `ADMIN_EMAILS` = your email address (several, comma-separated, are fine).
   - `ADMIN_KEY` = a password you invent, at least 8 characters. Write it down somewhere safe. If you ever lose it, change it here; nothing else depends on it.
4. **Redeploy** so the variables take effect: *Deployments → ⋯ on the latest → Redeploy*.
5. **Log in once.** Open `https://<your-project>.vercel.app/admin/login`, enter your email and the key. The first successful login creates the database tables. You will land on an empty dashboard.
6. **Point the page at it.** In `index.html`, near the top of the script, change `const COLLECTOR_URL = "";` to your Vercel URL, for example `const COLLECTOR_URL = "https://practical-map-collector.vercel.app";` (no trailing slash), commit, and push to `main`. GitHub Pages redeploys in a minute or two.
7. **Try it.** Open the live page in a private window, enter an email, click around, then refresh the dashboard.

Optional: `ALLOWED_ORIGIN` defaults to `https://sarahschuyler-stack.github.io`. Set it only if the page moves, or add `,http://127.0.0.1:8765` for local testing. Never commit any of these values; `.env.example` is the template.

## Environment variables

| Name | Where it comes from | Purpose |
|---|---|---|
| `DATABASE_URL` | Added by the Neon integration | Postgres connection string |
| `ADMIN_EMAILS` | You | Who may log in to `/admin/usage` |
| `ADMIN_KEY` | You | The admin password; also derives the cookie-signing secret |
| `ALLOWED_ORIGIN` | Optional | Browser origins allowed to call the write endpoints |

## Endpoints

- `POST /api/identify` `{v:1, email}` → `{token, exp}`. Upserts the user on the normalised email, issues a 7-day identity token, stores only its SHA-256. 20 per email per hour.
- `POST /api/track` one JSON envelope: `start`, `beat`, `end` or `event`. The user comes from the token. Replies 204 with no body, or 400/401/403/405/429/500 with a short reason.
- `GET /admin/login`, `POST /admin/login`, `POST /admin/logout`: admin session (signed HttpOnly cookie, 12 hours). A successful login applies pending migrations.
- `GET /admin/usage`: overview, charts, users table (`?sort=recent|sessions|usage|newest&q=&from=&to=&tz=`), recent activity.
- `GET /admin/usage/user?email=`: one person; `POST` with `action=delete&confirm=yes` removes them and all their data.
- `GET /admin/usage/export.csv`: the users table as CSV.

## Try it from a terminal

```bash
C=https://your-project.vercel.app
curl -s -X POST -H 'Content-Type: text/plain' -d '{"v":1,"email":"test@example.com"}' $C/api/identify
# {"token":"...","exp":"..."}  then, with that token:
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: text/plain' \
  -d '{"v":1,"type":"start","sid":"curl-session-1","token":"PASTE_TOKEN","ts":"'$(date -u +%FT%TZ)'","path":"/","hash":"","ref":"","tz":"UTC"}' $C/api/track
# 204
```

## Local development

```bash
cd collector
npm install
cp .env.example .env      # fill in a Neon URL (a free Neon project works) and the admin values
npx vercel dev            # serves the functions at http://localhost:3000
npm run migrate           # or just log in once at http://localhost:3000/admin/login
npm test                  # unit tests, database mocked, no network
```

To exercise the page against it, set `COLLECTOR_URL` to `http://localhost:3000` in a local copy of `index.html`, add `http://127.0.0.1:8765` to `ALLOWED_ORIGIN` in `.env`, and run `npm run serve` at the repository root.

## Privacy

Stored: email, timestamps, active seconds, page views, referrer, landing path, coarse browser family (`Chrome/Windows`), event names and small metadata. Not stored: IP addresses, raw user agents, the task text, prompt answers, API keys, anything typed on the page. No third-party analytics. To remove one person, open their detail page and use the Delete button, or run `delete from users where normalized_email = 'name@example.com'`, which cascades to their tokens, sessions and events.

## How session duration is calculated

The page counts one second for every second the tab is visible and the visitor has done something (click, key, scroll, pointer) within the last five minutes, and sends the count as a `beat` every 30 seconds, or immediately when the tab is hidden or closed. The collector credits `min(reported, 60, seconds since the previous beat + 5)` to the session and the user, so a hostile client cannot inflate its time, and refuses beats less than 20 seconds apart. Five idle minutes end the session; the next activity starts a new one.

## Enabling magic-link verification later

See the root README's "Enabling magic-link verification later". Only `api/identify.js` and a new `api/verify.js` change; the tables and the dashboard stay as they are, and `ADMIN_KEY` can then be retired.

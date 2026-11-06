# NearbyNudge 2.0

Find nearby businesses, learn what they need, and see the email worth sending, with one AI (Claude Sonnet 5.5) plus free open data and tools.

**Online:** https://nearbynudge-pearl.vercel.app (sign in with the account's email and password; see [Hosted on Vercel](#hosted-on-vercel)).

You enter **where** you sell, **who** you sell to and **what** you offer. NearbyNudge finds matching businesses in free open listings (Overture Maps), visits each business's own website politely, records facts with an exact quote and a link to the page, picks the reason to reach out, writes a short email, has an AI editor check every claim against its source, and puts it all on a review desk. NearbyNudge never sends email: you copy it or open it in your own email app, then mark it sent.

## Quick start (Windows)

1. Put your Anthropic API key in `.env` at the project root (already done on this machine):
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   AI_MODEL=claude-sonnet-5-5
   AI_EFFORT=medium
   ```
2. Run `start.ps1` (right-click, then **Run with PowerShell**). The first run installs packages, downloads the free location files and DC-area listings, and builds the dashboard.
3. Open **http://localhost:8000** in your browser. If `.env` has the sign-in lines (`NN_LOGIN_EMAIL`, `NN_LOGIN_PASSWORD_HASH`, `NN_SESSION_SECRET`), sign in with the same email and password as the hosted copy; without them there's no sign-in. The first time, the app asks once for your sender details (name, company and the postal address every email's footer needs), then opens on your campaigns. You can change them later in Settings.

## What runs where

| Part | Technology | Notes |
|---|---|---|
| AI | Claude Sonnet 5.5 (`claude-sonnet-5-5`), effort `medium`, via the official Anthropic Python SDK | The only outside API. Structured outputs, a strict `read_pages` tool, server-side refusal fallback, prompt caching on each skill |
| Backend | Python 3.14, FastAPI, SQLite (WAL), SQLAlchemy 2 | One process: API, live updates (Server-Sent Events), job worker, the built dashboard |
| Listings | Overture Maps Places in DuckDB (`data/listings.duckdb`) | DC metro preloaded (196,608 places); other US areas load on first use (about a minute) |
| Locations | Census Gazetteer files (`data/gazetteer/`) | ZIP codes and "City, ST", no geocoding API |
| Reader | httpx + trafilatura + extruct + protego | Names itself NearbyNudgeBot, obeys robots.txt, 1 page a second, 5 pages per business, blocks private addresses |
| Dashboard | React 19, Vite 8, TypeScript, Tailwind 4, shadcn/ui on Base UI, TanStack Router and Query | Served by the backend with `Content-Security-Policy: default-src 'self'` |

The five AI roles are Agent Skills files in `backend/nearbynudge/skills/<role>/SKILL.md`: Planner, Scout, Researcher, Writer and Editor.

## Commands

From `backend/` (use `.venv\Scripts\python.exe`):

| Command | What it does |
|---|---|
| `python -m nearbynudge serve` | Run the app on http://localhost:8000 |
| `python -m nearbynudge status` | Show configuration (key present, data present, dashboard built) |
| `python -m nearbynudge setup-data --metro dc` | Download location files and load listings (metros: `dc`, plus others in `listings/loader.py`) |
| `python -m nearbynudge purge` | Apply retention now (page copies 30 days, expired plans, old jobs) |
| `python -m nearbynudge check-connections` | Release check: the code connects only to the AI API, businesses' sites and open data |
| `python -m nearbynudge hash-password` | Reads a new password on stdin and prints its `NN_LOGIN_PASSWORD_HASH` |
| `python -m pytest` | Backend tests (fixture websites + a fake Claude API; no network, no cost) |
| `python scripts/live_run.py --leads 5` | A real campaign against real Claude and real websites, with a cost and timing report |

From `frontend/`: `npm run dev` (dashboard on :5173 with the API proxied to :8000), `npm run build`, `npm run test:e2e`.

## Testing

`verify.ps1` runs every automated check, with no network and no cost: the backend tests, the release check, the dashboard build, and the browser tests (Playwright, with axe accessibility checks): against the real backend with fixture websites and a fake Claude API, the sign-in tests against a second test server with sign-in on, and against the dashboard's built-in sample data.

The backend tests also run on Postgres, the hosted database: set `NN_TEST_DB_URL` to a Postgres server you can create databases on (for example a local throwaway one) and each test gets its own new database.

Two live checks use real Claude, real listings and real websites (about $0.30 to $0.40 each). Stop the app first: they open the same listings file, and only one program can have it open at a time.

- `backend\.venv\Scripts\python.exe backend\scripts\live_run.py --leads 5` runs a campaign through the backend and writes a cost and timing report to `docs/`.
- The whole flow through the dashboard: start `backend\.venv\Scripts\python.exe backend\scripts\e2e_server.py --live --port 8200`, then from `frontend/` run `$env:E2E_BASE_URL="http://localhost:8200"; $env:LIVE_UI="1"; npx playwright test e2e/live-ui.spec.ts`. Screenshots land in `docs/live-ui/`.

## Settings (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | (required) | The Anthropic API key |
| `AI_MODEL` / `AI_EFFORT` | `claude-sonnet-5-5` / `medium` | Model and effort for every AI call |
| `NN_AI_FALLBACKS` | `true` | Server-side refusal fallback (Claude API `fallbacks: "default"`) |
| `NN_AI_WEB_SEARCH` | `true` | Use one web search to check businesses that have no website |
| `NN_LEAD_COST_CAP` | `0.30` | A lead that reaches this AI cost stops ("Couldn't finish") |
| `NN_AI_RPM` | `50` | AI requests per minute |
| `NN_AI_OUTAGE_PAUSE_S` | `60` | Seconds AI work pauses after an overload or outage, or after a rate limit that doesn't say how long to wait (when it does, the pause follows its `retry-after`, up to 120 s); the job goes back in the queue and gives up only after 24 hours. A rejected key, a billing problem or an unavailable model pauses work until fixed (admin **Resume now**, or a check every 5 minutes) |
| `NN_WORKER_CONCURRENCY` | `4` | Leads researched at the same time |
| `NN_PUBLIC_URL` | `http://localhost:8000` | Where the app is served; the server answers only to this host name and this computer's own addresses |
| `NN_LOGIN_EMAIL` / `NN_LOGIN_PASSWORD_HASH` | (empty: no sign-in) | The one account. Make the hash with `python -m nearbynudge hash-password` |
| `NN_SESSION_SECRET` | (required with sign-in) | Signs the session cookie (32+ random characters). Changing it, or the password, signs every browser out |
| `NN_DAILY_SEND_CAP` / `NN_MONTHLY_LEAD_LIMIT` | `20` / `100` | Sending-preview cap per day; beta leads per month |

## Project layout

```
backend/nearbynudge/   app.py (startup, security headers, CSRF)  api/  ai/ (Claude client)  roles/ + skills/ (the five AI roles)
                       pipeline/ (jobs, worker, steps, actions, live events)  reader/  listings/  geo/
backend/tests/         fake_ai.py (fake Claude API), sites/ (fixture websites)
frontend/src/          app/ (router, session)  components/ (shell, shared, ui)  features/ (one folder per screen)  lib/api/
docs/                  api-contract.md, api-types.ts (the API contract); the live checks write their reports and screenshots here (gitignored)
```

## Notes

- **AI provider.** The PRD named Xiaomi MiMo as the one API. Per the product owner's instruction, the app uses Claude Sonnet 5.5 at medium effort instead; the one-API rule is unchanged (Claude is the only outside API). Every vendor-specific name lives in `backend/nearbynudge/ai/` and the settings.
- **Costs.** Claude Sonnet 5.5 lists at $2 per million input tokens and $10 per million output. A lead takes about 5 AI calls; two live runs measured about $0.07 per lead ($0.067 and $0.074). The admin console shows spend by day and by role.
- **Pipeline rules.** Your decisions win: every pipeline write checks that the lead is still in progress, so skipping a lead, marking it Do not contact, or deleting its campaign (or all data) while it is being researched is never overwritten. On this computer that decision also cancels the running job; hosted, the job finishes the step it is on and that step's result is dropped. Email length is measured by code, not by the AI editor: the editor gets the word counts and fixes length only when the code reports a problem. Do not contact matches the place, the website's domain, the email address or the business name (legal suffixes, case and punctuation ignored).
- **Sign-in.** One account, no sign-up: the email in `NN_LOGIN_EMAIL` and the password whose scrypt hash is `NN_LOGIN_PASSWORD_HASH`. A signed-in browser holds an HttpOnly session cookie for 7 days; five wrong passwords from one address (or 50 from everywhere) in 15 minutes pause sign-in for a while, counted in the database. Without the sign-in settings (tests, or this computer if you remove the lines) everyone who opens the app works in the one shared workspace, so then it should stay on this computer: the server listens only on `127.0.0.1` and `::1` and refuses any other host name (DNS rebinding). The hosted copy never starts without sign-in. "Delete all data" in Settings starts over.
- **Setup-time downloads** (like `pip` or `npm`, not runtime APIs): Python and npm packages, DuckDB's `httpfs` extension (fetched once from extensions.duckdb.org the first time listings are loaded), the Census Gazetteer files and the Overture Maps listings.
- **Listings refresh.** Overture publishes a new release monthly; reload with `python -m nearbynudge load-listings --metro dc` while the app is stopped (DuckDB allows one writer).

## Hosted on Vercel

The online copy is the Vercel project `nearbynudge` (production: https://nearbynudge-pearl.vercel.app), on the free Hobby plan. The same code runs there in serverless mode, which turns on by itself on Vercel:

| Part | On this computer | On Vercel |
|---|---|---|
| Database | SQLite in `data/app.db` | Postgres from the Vercel Marketplace (Neon, free plan, `DATABASE_URL`) |
| Background jobs | The worker in the server process | Vercel Queues: each job is a message to `vercel_jobs.py`, which runs it with the same code; a cut-off job is tried again, and a sweep re-sends lost ones |
| Live updates | In-memory events | The same event stream, read from the database every 1.5 s |
| Listings | `data/listings.duckdb` | Loaded from Overture Maps during each deploy (DC metro), packed, and unpacked by each server instance; other areas load on demand |
| Clean-up | Every 6 hours in the server | Vercel Cron calls `/api/cron/maintenance` daily (`CRON_SECRET`) |

The files that set this up: `pyproject.toml` and `uv.lock` (what Vercel installs, with the versions the tests ran on), `vercel_app.py` and `vercel_jobs.py` (entry points), `vercel.json` (function limits, the cron and cache headers), `.vercelignore` (never uploads `.env` or `data/`), `backend/scripts/vercel_build.py` (builds the dashboard and loads the data during the deploy) and `backend/nearbynudge/serverless.py`.

Production settings live in the Vercel project, not in a file: `ANTHROPIC_API_KEY`, `AI_MODEL`, `AI_EFFORT`, `NN_ENV=prod`, `NN_PUBLIC_URL`, `NN_LOGIN_EMAIL`, `NN_LOGIN_PASSWORD_HASH`, `NN_SESSION_SECRET` and `CRON_SECRET` (the secrets are marked sensitive), plus the `DATABASE_URL` family the Neon integration added.

To deploy a change, from this folder: `vercel deploy --prod --yes` (about two minutes; the build runs on Vercel). To change the password: `python -m nearbynudge hash-password` in `backend/`, then `vercel env add NN_LOGIN_PASSWORD_HASH production --force --sensitive` with the new value on stdin, put the same value in `.env`, and redeploy.

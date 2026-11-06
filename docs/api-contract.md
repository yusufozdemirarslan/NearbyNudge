# NearbyNudge 2.0 — API contract

> **AI provider (Oct 24, 2026):** the product's one AI is Claude Sonnet 5.5 (`claude-sonnet-5-5`, effort `medium`) through the Anthropic API, per the product owner's instruction. Field names say `ai`, not a vendor name; the UI shows `SystemStatus.ai_name`.

> **No sign-in (Oct 25, 2026):** for the demo, the product owner asked to remove sign-in. There are no accounts, passkeys, recovery codes or invites: everyone who opens the app works in one built-in workspace, and the admin console is open to everyone. By default the server listens only on this computer, and it refuses other host names (see Conventions).

> **One account (Oct 26, 2026):** to put the app online, the product owner asked for a sign-in for their own account, with no sign-up. With `NN_LOGIN_PASSWORD_HASH` set, every API call except the open ones below needs the session cookie, and the one account works in the built-in workspace. Without it (tests, this computer by default) nothing changes from the note above.

Types live in [`api-types.ts`](api-types.ts); this file lists the endpoints. Backend pydantic schemas and the frontend client both follow these names exactly.

## Conventions

- Base path `/api`. JSON in and out, UTF-8.
- **Sign-in:** when it's on, a signed-in browser holds the `nn_session` cookie (HttpOnly, SameSite=Lax, Secure on https, 7 days). Without it every `/api/*` call returns 401 `auth_required`, except `/api/health`, `/api/auth/*`, `/api/public/*` and `/api/cron/*` (which checks its own secret). Pages (the dashboard and public pages) load either way. When sign-in is off, every request works in the one built-in workspace and there are no 401s.
- **Host names:** the server answers only to `localhost`, `127.0.0.1`, `[::1]` and the host of `NN_PUBLIC_URL`; any other `Host` header gets 400 `bad_host`. With no sign-in, this is what stops a web page from reaching the app by pointing its own name at 127.0.0.1 (DNS rebinding).
- **CSRF:** the server sets a readable cookie `nn_csrf` on every response that lacks one. Every POST/PUT/PATCH/DELETE must send header `X-CSRF-Token` equal to that cookie (double-submit). A mismatch returns 403 `csrf`.
- **Errors:** non-2xx bodies are `ApiErrorBody`. Common codes: `bad_host` (400), `auth_required` (401), `bad_credentials` (401), `csrf` (403), `not_found` (404), `validation` (422, with `fields`), `conflict` (409), `daily_cap_reached` (409), `usage_limit` (409), `cost_limit` (409), `cancelled` (409), `plan_expired` / `plan_changed` (409), `rate_limited` (429), `ai_paused` (503), `ai_error` (502).
- `409 profile_required` until the sender profile (with a postal address) is saved: the one first-run step.
- Timestamps are UTC ISO strings. The browser formats them in the user's time zone.

## Endpoints

### Sign-in

| Method | Path | Body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/auth/session` | — | `SessionInfo` | Open. `enabled` false when this copy has no sign-in (then `signed_in` is always true) |
| POST | `/api/auth/login` | `LoginRequest` | `SessionInfo` + `nn_session` cookie | Open. 401 `bad_credentials` (the same answer for a wrong email or password); 429 `rate_limited` after 5 wrong tries from one address, or 50 from all, in 15 minutes; 404 when sign-in is off |
| POST | `/api/auth/logout` | — | 204 | Clears the cookie |
| GET | `/api/cron/maintenance` | — | `{ ok, ... }` | Vercel Cron, daily, with `Authorization: Bearer CRON_SECRET`: retention clean-up and the sweep for jobs whose queue message went missing; 404 otherwise |

### Workspace and settings

| Method | Path | Body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/me` | — | `MeResponse` | The workspace; `onboarded` is false until the sender profile is saved; sets `nn_csrf`. 401 `auth_required` when sign-in is on and the browser isn't signed in |
| GET | `/api/account` | — | `Account` | |
| PUT | `/api/account/profile` | `SenderProfile` | `Account` | Postal address required; sets `onboarded` |
| PUT | `/api/account/preferences` | `Preferences` | `Account` | |
| DELETE | `/api/account` | `DeleteAccountRequest` (`confirm: "delete"`) | 204 | "Delete all data": campaigns, leads, do-not-contact list, sender profile and preferences; the app starts again at the sender profile. AI spend history stays. 422 `validation` unless `confirm` is the word delete |
| GET | `/api/status` | — | `SystemStatus` | Poll every 30 s for the paused banner |

### Campaigns

| Method | Path | Body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/campaigns` | — | `CampaignSummary[]` | Newest first |
| GET | `/api/campaigns/last-input` | — | `LastInputResponse` | Pre-fill for New campaign |
| POST | `/api/campaigns/plan` | `CampaignInput` | `CampaignPlan` | Geocodes, counts matches, the AI Planner restates and maps categories (about 3–8 s) |
| POST | `/api/campaigns` | `CreateCampaignRequest` | `Campaign` | Starts the run; 409 `usage_limit` past the monthly limit (counting leads being researched and campaigns still finding businesses); 409 `plan_expired` for a used or expired plan, so a double submit starts one campaign |
| GET | `/api/campaigns/{id}` | — | `Campaign` | |
| DELETE | `/api/campaigns/{id}` | — | 204 | Stops work and deletes it |
| GET | `/api/campaigns/{id}/leads` | — | `LeadSummary[]` | Sorted by fit (desc), then created; excludes replaced leads |
| GET | `/api/campaigns/{id}/events` | — | SSE | `lead`, `campaign`, `ping` events |
| GET | `/api/campaigns/{id}/export.csv` | — | CSV | One row per lead |
| GET | `/api/geo/suggest?q=` | — | `GeoSuggestResponse` | City and ZIP suggestions from Census files |
| GET | `/api/industries` | — | `IndustriesResponse` | |

### Leads

| Method | Path | Body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/leads/{id}` | — | `Lead` | |
| PUT | `/api/leads/{id}/email` | `UpdateEmailRequest` | `Lead` | Keeps sources on unchanged sentences; edited ones show `edited: true` and state `check` if they are claims. Only for ready / needs_review leads: 409 `conflict` "Undo the approval to change this email." when approved, "This email can't be changed now." otherwise |
| POST | `/api/leads/{id}/rewrite` | `RewriteRequest` | `Lead` | Synchronous, target 15 s; sets `previous_email`. 409 `conflict` if the lead's status or email changed while it ran (nothing is saved); a request the client cancelled saves nothing (409 `cancelled`) |
| POST | `/api/leads/{id}/versions/{version_id}/restore` | — | `Lead` | Same status rule and 409s as editing |
| POST | `/api/leads/{id}/approve` | — | `ActionResult` | Allowed from ready / needs_review |
| POST | `/api/leads/{id}/skip` | `SkipRequest` | `ActionResult` | |
| POST | `/api/leads/{id}/dnc` | `DncRequest` | `ActionResult` | Adds business, domain and email to the list |
| POST | `/api/leads/{id}/sent` | — | `ActionResult` | From approved; 409 `daily_cap_reached` at 20 a day |
| POST | `/api/leads/{id}/replied` | `RepliedRequest` | `ActionResult` | From sent; `no_thanks` also adds to do-not-contact |
| POST | `/api/actions/{action_id}/undo` | — | `UndoResult` | Reverts that action if it is still the lead's latest |
| POST | `/api/leads/{id}/retry` | `RetryRequest` | `Lead` | For failed / needs_review leads; 409 `usage_limit` past the monthly limit, 409 `cost_limit` once the lead reached the AI cost limit |
| POST | `/api/facts/{id}/wrong` | `WrongFactRequest` | `Lead` | Flags the fact and rewrites the email without it; cancelled by the client, the flag is taken back and nothing is saved |
| POST | `/api/leads/{id}/events` | `LeadEventRequest` | 204 | Logs Copy / Open-in-email-app clicks for the PRD's measures |

### Sent, do-not-contact, numbers

| Method | Path | Body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/sent?status=approved\|sent\|replied\|all` | — | `SentResponse` | Across campaigns, newest first |
| GET | `/api/dnc?q=` | — | `DncEntry[]` | |
| POST | `/api/dnc` | `CreateDncRequest` | `DncEntry` | At least one of business_name, domain, email. A website is kept as its registrable domain, or as the page for a business on a shared platform ("facebook.com/smiledental"); a bare platform ("facebook.com") is 422 on `domain` |
| DELETE | `/api/dnc/{id}` | — | 204 | |
| GET | `/api/dnc/export.csv` | — | CSV | |
| GET | `/api/stats` | — | `Stats` | `this_week` / `last_week` carry `reply_rate`: replies to the emails sent that week (null with no sends) |
| GET | `/api/stats/export.csv` | — | CSV | By campaign and week |

### Admin console

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/admin/overview` | — | `AdminOverview` |
| PUT | `/api/admin/balance` | `SetBalanceRequest` | `AdminOverview` |
| POST | `/api/admin/resume` | — | `AdminOverview` |
| GET | `/api/admin/errors` | — | `ErrorEntry[]` |
| GET | `/api/admin/ai-calls?limit=50` | — | `AiCallRow[]` |
| GET | `/api/admin/audit/sample?n=10` | — | `AuditLead[]` |
| POST | `/api/admin/audit/facts/{fact_id}` | `AuditVerdictRequest` | `OkResponse` |
| GET | `/api/admin/optouts` | — | `OptOut[]` |
| POST | `/api/admin/optouts` | `CreateOptOutRequest` | `OptOut` |
| DELETE | `/api/admin/optouts/{id}` | — | 204 |

### Public pages' endpoints

| Method | Path | Body | Response | Notes |
|---|---|---|---|---|
| POST | `/api/public/optout` | `PublicOptOutRequest` | `OkResponse` | Site owners ask NearbyNudgeBot to stay away; rate-limited |
| GET | `/api/health` | — | `{ ok: true, version: string }` | |

### Development only

`POST /api/dev/workspace` with `DevWorkspaceRequest` (`{ "key": string, "onboarded"?: boolean, "name"?: string }`) sets the cookie `nn_dev_workspace`, so later requests from that browser work in a separate workspace for `key` (made on first use; with `onboarded`, the default, it gets a test sender profile). Browser tests use it to run side by side without sharing campaigns or lists. It exists only when `NN_DEV_WORKSPACES=1` with `NN_ENV` dev or test (the browser-test server turns it on); the real app ignores the cookie, and the server refuses to start with it when `NN_ENV=prod`.

## Pages served by the backend

`/` and every non-`/api` path return the built single-page app (`frontend/dist/index.html`), with static assets under `/assets/`. Every response carries:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
X-Frame-Options: DENY
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

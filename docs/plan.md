# NearbyNudge 2.0 Pilot — Implementation Plan

> **For agentic workers:** this plan is executed with parallel subagents plus an integrator (the main session). Each worker owns the files listed for its track and must not edit files owned by another track. Report new dependencies instead of editing `pyproject.toml` or `package.json` yourself unless your track owns them.

**Goal:** a working, tested NearbyNudge 2.0 pilot: three inputs become a live dashboard of real nearby businesses, each with sourced facts, a site check, a hook, a checked email and a sending preview. MiMo-V2.6-Pro does every AI task through the MiMo API; free tools on our own server do the rest.

**Architecture:** one Python process (FastAPI + Uvicorn) serves the JSON API, a Server-Sent Events stream and the built React single-page app. App data lives in SQLite (SQLAlchemy 2), business listings in a DuckDB file loaded from Overture Maps Places. An in-process job worker runs the five MiMo roles (Planner → Scout → Researcher → Writer → Editor) with a persistent job table, so work pauses and resumes without loss.

**Tech stack:** Python 3.14, FastAPI 0.162, SQLAlchemy 2.1, pydantic 2.14, httpx 0.28, DuckDB 2.0, trafilatura 2.3, extruct 0.18, protego 0.7, py_webauthn 3.0; React 19.3, Vite 8, TypeScript, Tailwind 4.3, shadcn/ui 4.22 on Base UI 1.9, TanStack Router + Query + Table, Recharts 3.10, Lucide 1.61, Fontsource Atkinson Hyperlegible Next 5.3, @simplewebauthn/browser 14, Playwright 1.64 + axe-core.

**Specs:** `../NearbyNudge-2.0-PRD.md` (requirements, IDs CS/LD/RE/HK/WR/QC/DB/AC), `../NearbyNudge-2.0-Design-Research.md` (look, layout, interactions, tokens), `api-contract.md` + `api-types.ts` (the API).

## Global constraints

- **One API:** the only outside API is MiMo (`https://api.xiaomimimo.com/v1/chat/completions`, model `mimo-v2.6-pro` for every call). Besides MiMo the server connects only to (a) the public websites of businesses being researched, through the reader, and (b) open data downloads: Overture Maps on `s3://overturemaps-us-west-2` (anonymous) and Census Gazetteer files on `www2.census.gov`. The browser connects only to our own server (CSP `default-src 'self'`).
- **No third-party services in the frontend:** no Google Fonts, CDNs, analytics, error trackers, hosted sign-in, favicon or logo services. Fonts are bundled from Fontsource.
- **MiMo receives:** the offer, sender name and company, listing details without phone/email, page text with emails and phone numbers masked. Never prospects' contact details, the user's postal address, IP addresses or other customers' data.
- **Reader:** user agent `NearbyNudgeBot/2.0 (+<public_url>/bot)`; obeys robots.txt (re-read daily; unreadable = stay out); ≥ 1 s between requests to a host; ≤ 5 pages per business; skips logins, forms and bot checks; refuses private/loopback addresses unless `NN_READER_ALLOW_PRIVATE=1` (tests only); page copies purged after 30 days.
- **Email rules (WR1):** AIDA; subject under 10 words naming the business; body 80–130 words; no bullets or clichés; one low-effort call to action. **Footer (WR2), added by code:** name, title + company, postal address, "This email is a business offer from {company}." and `Not interested? Reply "no thanks" and I won't email again.`
- **Limits:** 5–25 leads per campaign (default 10); radius 1–25 mi (default 5); 20 "Mark as sent" per user per local day; 100 leads per user per month (beta); one web search per lead at most; a lead reaching $0.10 of AI cost stops ("Couldn't finish: research hit the cost limit").
- **Fit labels:** Strong ≥ 80, Good 60–79, Weak < 60.
- **Copy:** plain, calm, no exclamation marks, no "AI magic". Status vocabulary from the design brief §3.3. Errors never only in a fading toast.
- **Accessibility:** WCAG 2.2 AA; tokens from design brief §6 verbatim.

## Review focus (inputs the spec implies but tasks could miss)

1. **A business site that redirects, times out, blocks bots or has no text** → the lead becomes "Couldn't finish" with Retry / "Review without site facts", never a stuck spinner; the next candidate replaces it.
2. **MiMo returns malformed or partial structured output, or doesn't call the save tool** → validated field by field, asked once more, then "needs review" (QC2); never a crash or an empty card.
3. **MiMo is out of balance (402), rate limited (429) or down (5xx)** → jobs pause, the banner shows, nothing is lost, and work resumes after the pause clears (also after a server restart).
4. **A location the user types that we can't resolve or haven't loaded** ("Springfield", a street address, a ZIP outside loaded metros) → a clear message asking for the state, or an on-demand listings load with an honest status line.
5. **Page text that tries to instruct the model** ("ignore previous instructions…") → treated as data; facts must quote fetched pages and every quote is checked by our code.

## File structure and ownership

```
NearbyNudge-2.0/
  .env                     # MIMO_API_KEY etc. (gitignored)            [integrator]
  start.ps1                # one-command start on Windows               [integrator]
  data/                    # app.db, listings.duckdb, gazetteer/ (gitignored)
  docs/                    # this plan, api contract                    [integrator]
  backend/
    pyproject.toml                                                     [integrator]
    nearbynudge/
      config.py db.py models.py schemas.py app.py security.py          [integrator]
      webauthn_flow.py emailtext.py __main__.py                         [integrator]
      api/*.py  mimo/*.py  skills/*/SKILL.md  roles/*.py  pipeline/*.py [integrator]
      geo/  listings/                                                   [track L]
      reader/                                                           [track R]
    tests/
      conftest.py fake_mimo.py test_api_*.py test_pipeline*.py          [integrator]
      test_geo.py test_listings*.py                                     [track L]
      sites/ test_reader*.py                                            [track R]
  frontend/                                                             [tracks FE-A, FE-B]
```

## Tracks and interfaces

### Track R — the reader (`backend/nearbynudge/reader/`)

Produces (exact names, used by the pipeline):

- `Reader(user_agent: str, *, allow_private: bool = False, min_interval_s: float = 1.0, timeout_s: float = 15.0, max_bytes: int = 2_000_000, robots_ttl_s: int = 86_400, is_opted_out: Callable[[str], bool] = lambda d: False, transport: httpx.AsyncBaseTransport | None = None)`
  - `async fetch_home(website: str, budget: SiteBudget) -> PageResult` — fetches the homepage, follows redirects (the final registrable domain becomes the site), tries `https://` first when the listing has no scheme.
  - `async fetch(url: str, *, site: str, budget: SiteBudget) -> PageResult` — same-site only (`site` = the home `final_url`).
  - `async aclose() -> None`
- `SiteBudget(max_pages: int = 5)` with `.pages_used: int`.
- `PageResult` dataclass: `url, final_url, ok, status, error, fetched_at (UTC datetime), load_ms, title, html, text, links: list[Link], structured: dict, meta: dict`. `error` ∈ `robots_disallowed, robots_unreadable, opted_out, off_site, blocked_address, not_html, too_large, http_error, timeout, network, bot_check, login_page, budget_exceeded` or `None`.
- `Link(url: str, text: str)`.
- `site_check(home: PageResult | None, pages: list[PageResult]) -> SiteCheckResult` (fields match `SiteCheck` in api-types, plus `.to_dict()`).
- `find_contact(*, listing_emails: list[str], website: str | None, pages: list[PageResult], listing_label: str) -> ContactResult` (fields match `Contact`, plus `.to_dict()`); never guesses; decodes Cloudflare-protected emails; skips "no solicitations" pages and pages that forbid sharing addresses (sets `note`).
- `mask_contacts(text) -> str`, `quote_in_text(quote, text) -> bool`, `text_fragment_url(url, quote) -> str`, `page_label(url, title="") -> str`, `pick_links(home, limit=20) -> list[Link]`, `registrable_domain(url_or_host) -> str`, `normalize_url(url) -> str`.
- Fixture sites in `backend/tests/sites/` (studio, family, nosolicit, closed, blocked, botcheck) plus `backend/tests/sites/serve.py --base-port 8701` serving each on its own port, and a pytest fixture `fixture_sites` returning `{name: base_url}`.

### Track L — places and locations (`backend/nearbynudge/geo/`, `backend/nearbynudge/listings/`)

Produces:

- `geo.GeoResult(label, kind: "zip"|"city", lat, lon, state, note)`; `geo.Gazetteer.download(data_dir) -> None`; `geo.Gazetteer.open(data_dir) -> Gazetteer` (raises `GazetteerMissing`); `.resolve(text) -> GeoResult | None` (ZIP anywhere in the text wins; else "City, ST"/"City, State"/"City ST"; a city with no state returns None); `.suggest(q, limit=8) -> list[GeoResult]`.
- `listings.Listing` dataclass: `place_id, name, category, basic_category, category_label, hierarchy, confidence, operating_status, websites, emails, phones, socials, street, locality, region, postcode, country, lat, lon, brand, brand_wikidata, chain_count, source_dataset, source_updated, release, distance_mi`.
- `listings.ListingsStore(path: Path)`: `covers(lat, lon, radius_mi) -> bool`; `load_area(lat, lon, radius_mi, *, margin_mi=5, progress=None) -> int`; `load_bbox(name, xmin, ymin, xmax, ymax, *, progress=None) -> int`; `latest_release() -> str` (static); `category_counts(lat, lon, radius_mi) -> list[tuple[str, str, int]]`; `all_categories(limit=3000) -> list[tuple[str, str, int]]`; `find_candidates(lat, lon, radius_mi, categories, *, exclude_place_ids=frozenset(), exclude_domains=frozenset(), limit=200) -> list[Listing]`; `get(place_id) -> Listing | None`; `stats() -> dict`; `close()`; plus `insert_listings(rows: list[Listing])` for tests.
- `listings.categories`: `label_for(key) -> str`, `is_excluded(category, hierarchy) -> bool`, `EXCLUDED_KEYWORDS`.
- `listings.loader.METROS` (at least `dc`) and `load_metro(store, key, progress=None) -> int`.
- LD2 filters inside `find_candidates`: categories match taxonomy primary, basic category or any hierarchy element; distance ≤ radius; drop closed/temporarily closed; confidence < 0.6; excluded categories; chains (`chain_count >= 5` or `brand_wikidata` set); dedupe by website domain, phone digits, then same normalized name within 150 m; sort by has-website, confidence, distance.

### Integrator — core backend

Config, DB models, schemas, auth (passkeys + recovery codes + sessions + CSRF), all API routes in the contract, the MiMo client (rate limit 90 RPM, retries, pause on 402/401/403, usage + cost log), the five skills as `skills/<role>/SKILL.md`, the roles, the job worker and SSE, email text (footer, mailto, copy text, sentence split, rule checks), CLI (`serve`, `load-listings`, `download-gazetteer`, `create-invite`, `purge`), a fake MiMo server for tests, and end-to-end wiring. Then integration, the live MiMo run and the final checks.

### Track FE-A, then FE-B — the dashboard (`frontend/`)

FE-A: project setup, tokens, fonts, app shell, API client (+ dev-only mock adapter behind `VITE_MOCK_API=1`), auth screens, public pages, the review desk and the Sent screen. FE-B (after FE-A's setup lands): Campaigns home, New campaign, Numbers, Do-not-contact, Settings and the Admin console. Both add Playwright + axe tests for their screens.

## Pipeline (integrator)

1. **Plan** (`POST /api/campaigns/plan`): geocode → if the area is not loaded, start loading it in the background → category counts (or all categories) → **Planner** (strict `save_plan` tool, thinking off) → stored plan (1 h).
2. **Discover** job: ensure the area is loaded → `find_candidates` minus do-not-contact and businesses this user already has → top 60 → **Scout** (strict `save_ranking`, thinking off) → reserve list → promote `lead_target` leads → one `lead` job each.
3. **Lead** job (4 at a time, fair across users): do-not-contact check → **Reader** home + `pick_links` → **Researcher** tool loop (thinking off; `read_pages` ≤ 4 URLs, then strict `save_research`: facts with ≤ 25-word quotes, verification, owner name) → our code checks every quote against the saved page → `find_contact` + `site_check` → verification fail → replaced by the next candidate; unreadable → "Couldn't finish" + replacement → **Writer** step A (thinking on, JSON: fit score + reason, hook + 2 alternatives) → **Writer** step B (thinking on, JSON: subject, greeting, sentences with kind + fact ids, signoff) → code rule checks → **Editor** (thinking on, JSON: 4 checks, per-sentence support, fixed email) → up to 2 fixes → ready / needs_review.
4. **Rewrite** (sync API): Writer rewrite (thinking off, strict `save_email`) → code checks → Editor (thinking off) → new version.

## Done when

- `pytest` passes (unit + API + pipeline against the fake MiMo and fixture sites).
- `npm run build`, typecheck and the outside-address check pass; Playwright + axe E2E passes against the real backend with the fake MiMo.
- A live run with the real MiMo key on real Arlington, VA businesses produces ready leads with supported facts, and the cost per lead is logged.

## Decisions recorded during the build (October 24-25, 2026)

- **AI provider:** Claude Sonnet 5.5 (`claude-sonnet-5-5`) at effort `medium`, adaptive thinking, through the official Anthropic Python SDK (product owner's instruction in `API.md`). Server-side refusal fallback (`fallbacks: "default"`) is on; if an account rejects it, the client turns it off and continues. MiMo-specific numbers below (90 RPM, thinking on/off per role, $0.10 cap) are superseded.
- **Rate and cost:** 50 requests a minute by default (`NN_AI_RPM`); per-lead cost cap $0.30 (`NN_LEAD_COST_CAP`), checked before every stage. Measured on live runs: $0.067-0.074 per lead.
- **Outages:** rate limits, overload (529), 5xx and network errors pause AI work briefly (`NN_AI_OUTAGE_PAUSE_S`, 60 s) and re-queue the job without counting an attempt; a job gives up only after 24 hours. Key, billing and model problems pause until fixed (admin "Resume now", or an automatic probe every 5 minutes).
- **User decisions win:** every pipeline write checks the lead is still in progress, so skip, do-not-contact or delete during research is never overwritten; those actions also cancel the running job.
- **Length is measured by code,** not by the AI editor: word counts are passed to the editor, which fixes length only when our code reports a problem.
- **Do-not-contact** matches place, website domain, email, or business name (legal suffixes and case ignored).

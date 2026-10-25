# Frontend scaffold: ready for FE-B

Vite 8 + React 19.3 + TypeScript (strict) + Tailwind 4.3 + shadcn/ui 4.22 on Base UI 1.9, TanStack Router (code-based) + Query 5 + Table 9, Recharts (shadcn `chart`), lucide-react, react-hook-form + zod 4, cmdk, Playwright + axe. **Everything is installed. Don't run `npm install <pkg>`; ask FE-A/the integrator.**

## Run
| Command | What it does |
|---|---|
| `npm run dev` | Vite on :5173, proxies `/api` (JSON + SSE) to `http://127.0.0.1:8000` (`NN_BACKEND_URL` overrides) |
| `npm run dev:mock` | Same app on the in-memory mock API (`--mode mock`, `.env.mock` sets `VITE_MOCK_API=1`) |
| `npm run build` | `typecheck` → `vite build` → `check:urls` (fails on any outside URL or mock data in `dist/`) |
| `npm run typecheck` | `tsc -b --noEmit` (app, vite config, e2e) |
| `npm run test:e2e` | Playwright on the mock (starts `dev:mock` on `E2E_PORT`, default 5199). `E2E_BASE_URL=http://localhost:8100` runs against a real backend instead |

## Layout
```
src/app/            router.tsx (all routes + guards), query-client.ts, devtools.tsx
src/lib/api/        types.ts (verbatim copy of docs/api-types.ts), client.ts, api.ts (Api interface),
                    endpoints.ts (HTTP), index.ts (`api`), queries.ts (keys + queryOptions), mock/ (dev only)
src/lib/            format.ts, email.ts (body/word helpers), toast.ts, utils.ts (`cn`)
src/hooks/          use-announce, use-shortcuts, use-commands, use-account, use-media-query, use-document-title
src/components/     shared components (below); ui/ = shadcn (owned by us); shell/ = app shell
src/features/<x>/   one folder per screen. FE-B owns: onboarding, public, campaigns, new-campaign,
                    numbers, dnc, settings, admin. FE-A owns: review, sent, shell, shared components, lib, hooks
e2e/                Playwright specs; fixtures.ts has `test`, `expectNoAxeViolations`, `mockSettings`, `LIVE_CAMPAIGN`
```

## API
`import { api } from "@/lib/api"` (types too: `import type { Lead } from "@/lib/api"`). One function per endpoint, all typed, all throw `ApiError { status, code, message, fields? }` (`message` is safe to show; `fields` maps form field → message for 422). Helpers: `isApiError(e, "usage_limit")`, `isAbortError(e)`.
- Workspace (there is no sign-in): `getMe, getAccount, updateProfile, updatePreferences (send the whole object), deleteAccount ({ confirm: "delete" }: deletes all data), getStatus`
- Campaigns: `getCampaigns, getLastInput, planCampaign, createCampaign, getCampaign, deleteCampaign, getCampaignLeads, subscribeCampaign(id, {onLead, onCampaign, onOpen, onError}) → unsubscribe, downloadCampaignCsv(id) → Blob, geoSuggest(q), getIndustries`
- Leads: `getLead, updateEmail, rewriteLead(id, req, signal?), restoreVersion, approveLead, skipLead, dncLead, markSent, markReplied, undoAction, retryLead, flagWrongFact(factId, req, signal?), logLeadEvent`
- Other: `getSent(status), getDnc(q?), createDnc, deleteDnc, downloadDncCsv, getStats, downloadStatsCsv`
- Admin: `getAdminOverview, setAdminBalance, resumeAi, getAdminErrors, getAiCalls(limit?), getAuditSample(n?), setAuditVerdict, getOptOuts, createOptOut, deleteOptOut` (open to everyone; there is no admin role)
- Public: `publicOptOut, getHealth`

CSV downloads return a `Blob`; save with `URL.createObjectURL` + a temporary `<a download>`. CSRF (`X-CSRF-Token` from the `nn_csrf` cookie) is automatic. There is no sign-in, so there are no 401s.

Queries: `import { qk, meQuery, accountQuery, statusQuery, campaignsQuery, campaignQuery, campaignLeadsQuery, leadQuery, sentQuery, statsQuery, dncQuery, lastInputQuery, industriesQuery } from "@/lib/api/queries"`. Use `useQuery(statsQuery())`; invalidate by family: `queryClient.invalidateQueries({ queryKey: qk.campaigns() })`. Admin keys: `qk.admin.overview()` etc.

No sign-in: everyone who opens the app uses one workspace. `meQuery()` returns `{ user: { id, name, onboarded, created_at } }`; the guards send you to `/onboarding` until the sender profile exists.

**AI name:** never hard-code a vendor. `const { name, model, label } = useAiName()` → `label("plan")` = "Claude's plan" (falls back to "AI plan").

## Mock adapter (`npm run dev:mock`)
One workspace with Maya Chen's sender profile. Campaign `c1` (dentists, Arlington) progresses live; `c2` (HVAC) and `c3` (law firms) are finished. `createCampaign` runs a new live campaign (finding → researching → done). Controls, set in localStorage then reload: `nn-mock-speed` (0 freezes, 4 = faster), `nn-mock-sent-today` (20 = at the cap), `nn-mock-paused` = "1" (banner), `nn-mock-onboarded` = "0" (starts at the sender profile set-up). The mock is removed from production builds.

## Routing (`src/app/router.tsx`, code-based)
Set-up (`SetupLayout`, centred column): `/onboarding` (until the sender profile exists). Public (`PublicLayout`): `/bot`, `/data-sources`, `/terms`, `/privacy`. The app (`AppShell`; guard: not onboarded → `/onboarding`): `/`, `/campaigns/new`, `/campaigns/$campaignId` (search `view`, `lead`, `sort`), `/sent` (search `status`), `/numbers`, `/dnc`, `/settings`, `/admin`. Old links `/signin`, `/signup`, `/recover` redirect to `/`. Guards run on navigation. Pages are lazy-loaded except home, desk, sent. Link to the desk: `<Link to="/campaigns/$campaignId" params={{ campaignId }} search={{}} />`.

## Page rules
- Wrap app pages in `<PageContainer>` (`width="narrow"` for forms) and start with `<PageHeader title description actions />` (the page's only h1). Call `useDocumentTitle("Numbers")`.
- Set-up/public pages: no container needed (the layout centres them); still one h1 via `PageHeader`.
- Errors in place with `CalmError` (never only a toast). Empty states with `EmptyState` that explain themselves.
- Forms: shadcn `field.tsx` (`Field`, `FieldLabel`, `FieldDescription`, `FieldError`) + react-hook-form + zod (`@hookform/resolvers/zod`; there is no shadcn `form` component in the base registry). Map `ApiError.fields` onto `setError`.

## Shared components (`@/components/...`, props documented in TSDoc)
- `StatusBadge { status, stageLabel?, step?, date?, reason?, replyOutcome?, size?: "sm"|"md", animate?, hideStep? }`; also `statusText()`, `isInProgress()`.
- `FitBadge { score, label?, variant?: "header"|"list" }` → "Strong fit 92" / "92".
- `Meter { value, max, label, valueText?, kind?: "meter"|"progress", tone?: "default"|"warning", showLabel?, size?, barClassName? }` (role meter/progressbar, `aria-valuetext` "7 of 20").
- `SourceTag` — `{ kind: "site"|"search", label, date?, href, quote?, quoteFound? }` (linked, quote preview on hover/focus, Esc closes) | `{ kind: "listing", label }` | `{ kind: "judgment" }` ("Claude's judgment", dashed, unlinked).
- `AiDraftLabel { provenance, editor?, website? }` (Carbon AI label + provenance popover).
- `PageHeader`, `PageContainer`, `EmptyState { icon?, title, description?, action?, size? }`, `CalmError { title?, error?, message?, onRetry?, retryLabel?, action?, size? }`, `PlaceholderBar { width?, height? }` (static gray bar, no shimmer), `KeyHint { keys, always? }` ("A", "Shift+D", "mod+K"; hidden when single-key shortcuts are off).
- Charts: shadcn `components/ui/chart.tsx` (Recharts). Colors: `var(--chart-1..5)` only; follow the brief's Numbers rules (no pies, no dual axes, a table view for every chart).

## Hooks
- `useAnnounce()` → `announce("Copied")` (polite live region; `{ politeness: "assertive" }` only for blocking errors).
- `notify({ title, description?, action?: { label, onClick }, timeout? })` from `@/lib/toast` (Base UI toast; ≥ 12 s with an action, pauses on hover/focus).
- `useShortcuts({ "shift+d": { description, handler, allowInInputs?, repeat?, display? } }, { enabled, group })` — single keys are ignored while typing, in menus/dialogs, and when `Preferences.shortcuts_enabled` is off. Later-mounted registrations win for the same key. They appear in the `?` sheet automatically.
- `useRegisterCommands([{ id, label, group, shortcut?, icon?, keywords?, run }])` adds to the Ctrl/⌘ K menu while mounted.
- `useAccount()`, `useCurrentUser()`, `usePreferences()`, `useUpdatePreferences()(patch)` (optimistic, sends the whole object), `useSending()`, `setSendingInCache(qc, sending)`, `useAiName()`.
- `useMediaQuery(q)`, `useDeskLayout()`, `useReducedMotion()`, `useDocumentTitle(title)`, `useTopBarSlot(node)` (page context in the top bar).

## Formatting (`@/lib/format`)
`formatDate` ("Oct 24"), `formatDateTime`, `formatTime`, `formatRelative`, `formatDistance` ("1.2 mi"), `formatMoney` ($0.0123 precision under a dime), `formatNumber`, `formatPercent`, `fitLabel(score)`, `plural(n, "lead")`, `formatEta`, `formatDuration`, `displayDomain`, `joinList`.

## Style rules
- Colors: only the brief §6 tokens (`bg-background`, `text-foreground`, `text-ink-secondary`, `text-muted-foreground`, `bg-card`, `bg-muted`, `bg-accent`, `text-primary`, `text-success|warning|info|destructive`, `bg-*-tint`). No new hex values.
- Type scale utilities: `text-page-title` (22/28 650), `text-pane-title` (18/24 600), `text-email` (16/25), `text-ui` (14/20), `text-list` (13/18), `text-meta` (12/16), `text-headline` (28/32 600). Use `tabular-nums` in number columns.
- Corners: `rounded-sm` chips (4px), `rounded-lg` controls (6px), `rounded-xl` panels (10px). Shadows only on popovers/menus (`shadow-popover`).
- Buttons: `<Button size="sm|default|lg">` (32/36/44px). Icons 16px in lists, 20px in buttons; stroke 1.75 is global. Links that look like buttons stay links: `<Link to="/" className={buttonVariants({ variant: "outline", size: "sm" })}>` (not `Button render={<Link/>}`, which gives a link role="button").
- Focus: a global 2px teal outline (don't remove it). Status = icon + word. Targets ≥ 24px (44px on phones). Respect `motion-reduce`.
- Copy: plain and calm, no exclamation marks, no emoji, no "AI magic".

## Rules for FE-B
1. Don't install packages or edit `package.json`, configs, `src/lib`, `src/hooks`, `src/components` (shared or `ui/`), `src/app`, `src/features/{review,sent}`. Need a change? Ask; FE-A lists every shared-API change at the end of this file.
2. Own only your feature folders and your own e2e specs (`e2e/<feature>.spec.ts`), each with an axe scan via `expectNoAxeViolations`.
3. Keep `npm run build` green (typecheck + no outside URLs).

## Changes to shared APIs since first publish
- New: `EmailAddress { email }` (wraps only after "@" and dots), `@/lib/clipboard` `copyText(text | Promise<string>)`, `@/lib/download` `saveBlob(blob, name)`, `toCsv(rows)`, `slugify(text)`.
- New (review desk, reusable): `@/features/review/lead-cache` `writeLead(qc, lead)` updates every cache that shows a lead; `@/features/review/use-lead-actions` `useLeadActions()` (approve/skip/dnc/markSent/replied/undo with Undo toasts) works outside the desk.
- Router: `/admin` no longer redirects non-admins (AdminPage shows its own message). `AuthLayout` is `max-w-xl` on `/onboarding`.
- Toasts: the close button is exposed to assistive tech; toasts sit above bottom action bars via the `--nn-bottom-bar` CSS variable.
- Mock: SSE `lead` events for replaced leads carry `replaced: true` (as the real backend does).
- E2E: `reducedMotion: "reduce"`; `E2E_OUTPUT_DIR` / `E2E_REPORT_DIR` set per-run folders; `fixtures.ts` exports `E2E_EMAIL` (a fresh dev user per worker on real backends).
- `scripts/url-allowlist.json`: added library error-decoder links (Redux, Redux Toolkit, Immer via Recharts), zod JSON-Schema ids and IPv6 template, the XHTML namespace and the FTC link in Terms, each with its reason.

import type {
  Account,
  ActionResult,
  AdminOverview,
  AiCallRow,
  AuditLead,
  AuditVerdictRequest,
  Campaign,
  CampaignInput,
  CampaignPlan,
  CampaignSummary,
  CreateCampaignRequest,
  CreateDncRequest,
  CreateOptOutRequest,
  DeleteAccountRequest,
  DncEntry,
  DncRequest,
  ErrorEntry,
  GeoSuggestResponse,
  IndustriesResponse,
  LastInputResponse,
  Lead,
  LeadEventRequest,
  LeadSummary,
  LoginRequest,
  MeResponse,
  OkResponse,
  OptOut,
  Preferences,
  PublicOptOutRequest,
  RepliedRequest,
  RetryRequest,
  RewriteRequest,
  SenderProfile,
  SentResponse,
  SessionInfo,
  SetBalanceRequest,
  SkipRequest,
  Stats,
  SystemStatus,
  UndoResult,
  UpdateEmailRequest,
  WrongFactRequest,
} from "./types"

/** Filter for GET /api/sent. */
export type SentFilter = "approved" | "sent" | "replied" | "all"

/** Handlers for the live campaign stream (Server-Sent Events). */
export interface CampaignStreamHandlers {
  /** A lead changed (new, progressed, finished, acted on). */
  onLead?: (lead: LeadSummary) => void
  /** The campaign's status, counts or ETA changed. */
  onCampaign?: (campaign: CampaignSummary) => void
  /** The stream (re)connected. `reconnected` is false the first time. */
  onOpen?: (info: { reconnected: boolean }) => void
  /** The connection dropped; the browser retries on its own. */
  onError?: () => void
}

/**
 * Every endpoint in docs/api-contract.md as one typed function.
 * Implemented by the HTTP adapter (`endpoints.ts`) and by the in-memory mock
 * (`mock/`, development only). Import the active one as `api` from
 * "@/lib/api". All functions throw `ApiError` on failure.
 */
export interface Api {
  // ---------- sign-in (one account; no sign-up) ----------
  /** GET /api/auth/session. Whether this copy asks for sign-in, and whether this browser is signed in. */
  getSession(): Promise<SessionInfo>
  /** POST /api/auth/login. 401 `bad_credentials` for a wrong email or password; 429 after too many. */
  login(req: LoginRequest): Promise<SessionInfo>
  /** POST /api/auth/logout. */
  logout(): Promise<void>

  // ---------- the workspace and its settings ----------
  /** GET /api/me. The one built-in workspace (401 `auth_required` when signed out). */
  getMe(): Promise<MeResponse>
  /** GET /api/account. */
  getAccount(): Promise<Account>
  /** PUT /api/account/profile. Postal address required; sets `onboarded`. */
  updateProfile(profile: SenderProfile): Promise<Account>
  /** PUT /api/account/preferences (send the whole object). */
  updatePreferences(preferences: Preferences): Promise<Account>
  /**
   * DELETE /api/account with `confirm: "delete"`. Deletes all data (campaigns,
   * leads, do-not-contact list, sender profile, preferences); the app starts
   * over at onboarding.
   */
  deleteAccount(req: DeleteAccountRequest): Promise<void>
  /** GET /api/status. Poll every 30 s for the paused banner and the AI name. */
  getStatus(): Promise<SystemStatus>

  // ---------- campaigns ----------
  /** GET /api/campaigns, newest first. */
  getCampaigns(): Promise<CampaignSummary[]>
  /** GET /api/campaigns/last-input. Pre-fill for New campaign. */
  getLastInput(): Promise<LastInputResponse>
  /** POST /api/campaigns/plan. Takes about 3–8 s. */
  planCampaign(input: CampaignInput): Promise<CampaignPlan>
  /** POST /api/campaigns. Starts the run; 409 `usage_limit` past the monthly limit. */
  createCampaign(req: CreateCampaignRequest): Promise<Campaign>
  /** GET /api/campaigns/{id}. */
  getCampaign(id: string): Promise<Campaign>
  /** DELETE /api/campaigns/{id}. Stops work and deletes it. */
  deleteCampaign(id: string): Promise<void>
  /** GET /api/campaigns/{id}/leads. Fit (desc) then created; excludes replaced leads. */
  getCampaignLeads(id: string): Promise<LeadSummary[]>
  /**
   * GET /api/campaigns/{id}/events (Server-Sent Events). Calls the handlers
   * for `lead` and `campaign` events. Returns a function that closes the stream.
   */
  subscribeCampaign(id: string, handlers: CampaignStreamHandlers): () => void
  /** GET /api/campaigns/{id}/export.csv, one row per lead. */
  downloadCampaignCsv(id: string): Promise<Blob>
  /** GET /api/geo/suggest?q= (Census city and ZIP suggestions). */
  geoSuggest(q: string): Promise<GeoSuggestResponse>
  /** GET /api/industries. */
  getIndustries(): Promise<IndustriesResponse>

  // ---------- leads ----------
  /** GET /api/leads/{id}. */
  getLead(id: string): Promise<Lead>
  /** PUT /api/leads/{id}/email. Edited claim sentences come back as `check`. */
  updateEmail(id: string, req: UpdateEmailRequest): Promise<Lead>
  /** POST /api/leads/{id}/rewrite. Synchronous (target 15 s); pass a signal to cancel. */
  rewriteLead(id: string, req: RewriteRequest, signal?: AbortSignal): Promise<Lead>
  /** POST /api/leads/{id}/versions/{version_id}/restore. */
  restoreVersion(id: string, versionId: string): Promise<Lead>
  /** POST /api/leads/{id}/approve (from ready or needs_review). */
  approveLead(id: string): Promise<ActionResult>
  /** POST /api/leads/{id}/skip. */
  skipLead(id: string, req: SkipRequest): Promise<ActionResult>
  /** POST /api/leads/{id}/dnc. Adds the business, domain and email to the list. */
  dncLead(id: string, req: DncRequest): Promise<ActionResult>
  /** POST /api/leads/{id}/sent (from approved). 409 `daily_cap_reached` at the cap. */
  markSent(id: string): Promise<ActionResult>
  /** POST /api/leads/{id}/replied (from sent). `no_thanks` also adds to do-not-contact. */
  markReplied(id: string, req: RepliedRequest): Promise<ActionResult>
  /** POST /api/actions/{action_id}/undo. Works while it is still the lead's latest action. */
  undoAction(actionId: string): Promise<UndoResult>
  /** POST /api/leads/{id}/retry (failed or needs_review leads). */
  retryLead(id: string, req: RetryRequest): Promise<Lead>
  /** POST /api/facts/{id}/wrong. Flags the fact and rewrites the email without it. */
  flagWrongFact(factId: string, req: WrongFactRequest, signal?: AbortSignal): Promise<Lead>
  /** POST /api/leads/{id}/events. Logs Copy / Open-in-email-app clicks. */
  logLeadEvent(id: string, req: LeadEventRequest): Promise<void>

  // ---------- sent, do not contact, numbers ----------
  /** GET /api/sent?status=. Across campaigns, newest first. */
  getSent(status: SentFilter): Promise<SentResponse>
  /** GET /api/dnc?q=. */
  getDnc(q?: string): Promise<DncEntry[]>
  /** POST /api/dnc. At least one of business_name, domain, email. */
  createDnc(req: CreateDncRequest): Promise<DncEntry>
  /** DELETE /api/dnc/{id}. */
  deleteDnc(id: string): Promise<void>
  /** GET /api/dnc/export.csv. */
  downloadDncCsv(): Promise<Blob>
  /** GET /api/stats. */
  getStats(): Promise<Stats>
  /** GET /api/stats/export.csv, by campaign and week. */
  downloadStatsCsv(): Promise<Blob>

  // ---------- admin console ----------
  getAdminOverview(): Promise<AdminOverview>
  setAdminBalance(req: SetBalanceRequest): Promise<AdminOverview>
  resumeAi(): Promise<AdminOverview>
  getAdminErrors(): Promise<ErrorEntry[]>
  /** GET /api/admin/ai-calls?limit= (default 50). */
  getAiCalls(limit?: number): Promise<AiCallRow[]>
  /** GET /api/admin/audit/sample?n= (default 10). */
  getAuditSample(n?: number): Promise<AuditLead[]>
  setAuditVerdict(factId: string, req: AuditVerdictRequest): Promise<OkResponse>
  getOptOuts(): Promise<OptOut[]>
  createOptOut(req: CreateOptOutRequest): Promise<OptOut>
  deleteOptOut(id: string): Promise<void>

  // ---------- public ----------
  /** POST /api/public/optout. Site owners ask the bot to stay away. */
  publicOptOut(req: PublicOptOutRequest): Promise<OkResponse>
  /** GET /api/health. */
  getHealth(): Promise<{ ok: true; version: string }>
}

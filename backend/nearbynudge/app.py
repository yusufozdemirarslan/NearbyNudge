"""FastAPI application: API, live events and the built dashboard, with one-API security headers."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager, suppress
from datetime import timedelta
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import delete
from starlette.datastructures import MutableHeaders
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.requests import cookie_parser

from . import __version__
from .ai.client import AIClient, CallContext
from .api import account, admin, auth_routes, campaigns, leads, public, sent
from .api.deps import DEFAULT_WORKSPACE, ApiError, ensure_workspace
from .auth import SESSION_COOKIE, purge_attempts, session_valid
from .config import Settings, get_settings
from .db import Database, utcnow
from .models import AiCall, Campaign, CampaignPlanRow, Job, Lead, Page
from .pipeline import limits
from .pipeline.events import EventBroker
from .pipeline.pause import DbPause
from .pipeline.state import AppState, OptOutCache
from .pipeline.worker import Worker
from .security import CSRF_COOKIE, CSRF_HEADER, csrf_ok, new_token

log = logging.getLogger("nearbynudge")

CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
    "font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"
)
SECURITY_HEADERS = {
    "content-security-policy": CSP,
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "cross-origin-opener-policy": "same-origin",
}
UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}
#: API paths open without signing in: health, sign-in itself, the site-owner opt-out, and the daily clean-up (it
#: checks its own secret)
OPEN_API = ("/api/health", "/api/auth/", "/api/public/", "/api/cron/")


def host_name(host_header: str) -> str:
    """The name part of a Host header: "localhost:8000" -> "localhost", "[::1]:8000" -> "::1"."""
    value = host_header.strip().lower()
    if value.startswith("["):
        end = value.find("]")
        return value[1:end] if end > 0 else ""
    return value.rsplit(":", 1)[0] if value.count(":") == 1 else value


class SecurityMiddleware:
    """Pure ASGI (keeps streaming responses streaming): host-name check, sign-in check, security headers,
    CSRF double-submit check.

    With sign-in on, every API call except OPEN_API needs the session cookie. Without it (this computer, tests),
    anyone who can reach the server can use it; by default it listens only on this computer, and the host-name check
    stops a web page from reaching it by pointing its own name at 127.0.0.1 (DNS rebinding): the browser then sends
    that page's name, not "localhost".
    """

    def __init__(self, app: Any, settings: Settings):
        self.app = app
        self.settings = settings
        self.secure = settings.secure_cookies
        self.allowed_hosts = settings.allowed_hosts
        self.public_url = settings.public_url.rstrip("/")

    async def _refuse(self, status: int, code: str, message: str, scope: dict, receive: Any, send: Any) -> None:
        resp = JSONResponse({"error": {"code": code, "message": message}}, status_code=status)
        for k, v in SECURITY_HEADERS.items():
            resp.headers[k] = v
        resp.headers["cache-control"] = "no-store"
        await resp(scope, receive, send)

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path: str = scope.get("path", "")
        method: str = scope.get("method", "GET")
        raw_headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        if host_name(raw_headers.get("host", "")) not in self.allowed_hosts:
            await self._refuse(400, "bad_host", f"This address isn't served here. Open NearbyNudge at {self.public_url}.",
                               scope, receive, send)
            return
        # Starlette's lenient parser (as for request.cookies): other apps' odd cookies on localhost can't hide ours
        cookies = cookie_parser(raw_headers.get("cookie", ""))
        csrf_cookie = cookies.get(CSRF_COOKIE) or None
        is_api = path.startswith("/api/")

        if (is_api and self.settings.login_enabled and not path.startswith(OPEN_API)
                and not session_valid(self.settings, cookies.get(SESSION_COOKIE))):
            await self._refuse(401, "auth_required", "Please sign in to continue.", scope, receive, send)
            return

        if is_api and method in UNSAFE and not csrf_ok(csrf_cookie, raw_headers.get(CSRF_HEADER)):
            await self._refuse(403, "csrf", "This page needs a refresh. Reload it and try again.", scope, receive, send)
            return

        new_csrf = None if csrf_cookie else new_token(24)

        async def send_wrapper(message: dict) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for k, v in SECURITY_HEADERS.items():
                    if k not in headers:
                        headers[k] = v
                if self.secure and "strict-transport-security" not in headers:
                    headers["strict-transport-security"] = "max-age=31536000; includeSubDomains"
                if is_api and "cache-control" not in headers:
                    headers["cache-control"] = "no-store"
                if new_csrf:
                    cookie = f"{CSRF_COOKIE}={new_csrf}; Path=/; SameSite=Lax"
                    if self.secure:
                        cookie += "; Secure"
                    headers.append("set-cookie", cookie)
            await send(message)

        await self.app(scope, receive, send_wrapper)


def _error(status: int, code: str, message: str, fields: dict[str, str] | None = None) -> JSONResponse:
    body: dict[str, Any] = {"code": code, "message": message}
    if fields:
        body["fields"] = fields
    return JSONResponse({"error": body}, status_code=status)


def make_recorder(db: Database):
    async def record(ctx: CallContext, row: dict[str, Any]) -> None:
        def fn(s):
            s.add(AiCall(
                created_at=row["created_at"], user_id=ctx.user_id, campaign_id=ctx.campaign_id, lead_id=ctx.lead_id,
                skill=row["skill"], model=row["model"], thinking=row["thinking"], input_tokens=row["input_tokens"],
                cache_write_tokens=row["cache_write_tokens"], cache_read_tokens=row["cache_read_tokens"],
                output_tokens=row["output_tokens"], web_searches=row["web_searches"], cost_usd=row["cost_usd"],
                latency_ms=row["latency_ms"], status=row["status"], error_code=row["error_code"],
                error_message=row["error_message"],
            ))
            if ctx.lead_id:
                lead = s.get(Lead, ctx.lead_id)
                if lead is not None:
                    lead.cost_usd = (lead.cost_usd or 0.0) + row["cost_usd"]
                    lead.ai_requests = (lead.ai_requests or 0) + 1
            if ctx.campaign_id:
                camp = s.get(Campaign, ctx.campaign_id)
                if camp is not None:
                    camp.cost_usd = (camp.cost_usd or 0.0) + row["cost_usd"]
        await db.arun(fn)
    return record


def ensure_default_workspace(db: Database) -> None:
    """There's no sign-in: the one built-in workspace exists from the start."""
    db.run(lambda s: ensure_workspace(s, DEFAULT_WORKSPACE))


def purge(db: Database) -> dict[str, int]:
    """Retention (PRD section 9): page copies 30 days; expired plans; old jobs; sign-in attempts after a day."""
    now = utcnow()

    def fn(s) -> dict[str, int]:
        out = {}
        out["pages"] = s.execute(delete(Page).where(Page.fetched_at < now - timedelta(days=30))).rowcount or 0
        out["plans"] = s.execute(delete(CampaignPlanRow).where(CampaignPlanRow.expires_at < now)).rowcount or 0
        out["jobs"] = s.execute(delete(Job).where(Job.status.in_(("done", "cancelled")), Job.updated_at < now - timedelta(days=7))).rowcount or 0
        out["login_attempts"] = purge_attempts(s, now=now)
        return out
    return db.run(fn)


def build_state(settings: Settings, *, ai_http_client: Any = None, reader_transport: Any = None) -> AppState:
    """The app's shared services: database, AI client, website reader, listings and location data.

    Hosted (serverless), several instances share the database, so the pause and the opt-out list are read again
    every few seconds, and each instance works on its own copy of the deployed listings."""
    hosted = settings.serverless
    db = Database(settings.database_url)
    db.create_all()
    db.run(limits.backfill)  # a database from before the usage record keeps what it already counted
    pause = DbPause(db, reload_after_s=5 if hosted else None)
    optouts = OptOutCache(db, refresh_after_s=60 if hosted else None)
    ai = AIClient(
        api_key=settings.anthropic_api_key, model=settings.ai_model, effort=settings.ai_effort, rpm=settings.ai_rpm,
        max_concurrency=settings.ai_max_concurrency, timeout_s=settings.ai_timeout_s, fallbacks=settings.ai_fallbacks,
        recorder=make_recorder(db), pause=pause, base_url=settings.anthropic_base_url or None, http_client=ai_http_client,
        outage_pause_s=settings.ai_outage_pause_s,
    )
    state = AppState(settings=settings, db=db, ai=ai, pause=pause, broker=EventBroker(), optouts=optouts)
    try:
        from .reader import Reader

        state.reader = Reader(
            settings.bot_user_agent, allow_private=settings.reader_allow_private,
            min_interval_s=settings.reader_min_interval_s, is_opted_out=optouts.contains, transport=reader_transport,
        )
    except Exception:  # noqa: BLE001
        log.exception("the website reader failed to start")
    try:
        from .listings import ListingsStore

        if hosted:
            from . import serverless

            state.listings = ListingsStore(serverless.listings_copy(settings),
                                           extension_dir=serverless.duckdb_extension_dir(settings), memory_limit="900MB")
        else:
            state.listings = ListingsStore(settings.listings_file)
    except Exception:  # noqa: BLE001
        log.exception("the listings store failed to open")
    try:
        from .geo import Gazetteer

        state.gazetteer = Gazetteer.open(settings.data_dir)
    except Exception as exc:  # noqa: BLE001
        log.warning("location data isn't installed (%s); run: python -m nearbynudge setup-data", exc)
    if not settings.ai_configured:
        log.warning("ANTHROPIC_API_KEY isn't set; research is off until it is")
    return state


async def close_state(state: AppState) -> None:
    if state.reader is not None:
        with suppress(Exception):
            await state.reader.aclose()
    with suppress(Exception):
        await state.ai.aclose()
    if state.listings is not None:
        with suppress(Exception):
            state.listings.close()
    state.db.dispose()


def create_app(settings: Settings | None = None, *, ai_http_client: Any = None, reader_transport: Any = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        settings.validate_for_start()
        if not settings.serverless:  # hosted, the deployment is read-only and carries its data
            settings.data_dir.mkdir(parents=True, exist_ok=True)
        state = build_state(settings, ai_http_client=ai_http_client, reader_transport=reader_transport)
        state.broker.bind(asyncio.get_running_loop())
        app.state.nn = state
        ensure_default_workspace(state.db)
        if settings.serverless:
            # Hosted: Vercel Queues runs the jobs (queue_worker.py) and the daily cron runs the clean-up.
            from . import serverless

            serverless.install()
            try:
                yield
            finally:
                await close_state(state)
            return
        worker = Worker(state)
        state.worker = worker
        if settings.worker_enabled:
            await worker.start()

        async def maintenance() -> None:
            while True:
                with suppress(Exception):
                    await asyncio.to_thread(purge, state.db)
                await asyncio.sleep(6 * 3600)

        maint = asyncio.create_task(maintenance())
        try:
            yield
        finally:
            maint.cancel()
            await worker.stop()
            await close_state(state)

    app = FastAPI(title="NearbyNudge", version=__version__, lifespan=lifespan, docs_url=None, redoc_url=None,
                  openapi_url="/api/openapi.json")
    app.add_middleware(SecurityMiddleware, settings=settings)

    @app.exception_handler(ApiError)
    async def api_error(_: Request, exc: ApiError) -> JSONResponse:
        return _error(exc.status, exc.code, exc.message, exc.fields)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        fields: dict[str, str] = {}
        for e in exc.errors():
            loc = [str(x) for x in e.get("loc", []) if x not in ("body", "query", "path")]
            key = ".".join(loc) or "request"
            msg = str(e.get("msg", "Invalid value")).removeprefix("Value error, ")
            fields.setdefault(key, msg)
        return _error(422, "validation", "Please check the highlighted fields.", fields)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException) -> Any:
        if not request.url.path.startswith("/api/"):
            return HTMLResponse("Not found", status_code=exc.status_code)
        code = {404: "not_found", 405: "method_not_allowed"}.get(exc.status_code, "error")
        return _error(exc.status_code, code, "That wasn't found." if exc.status_code == 404 else str(exc.detail))

    @app.exception_handler(Exception)
    async def server_error(request: Request, exc: Exception) -> JSONResponse:
        state: AppState | None = getattr(request.app.state, "nn", None)
        if state is not None:
            state.log_error("api", f"{request.method} {request.url.path}: {exc}", exc=exc)
        else:
            log.exception("unhandled error")
        return _error(500, "server_error", "Something went wrong on our side. Please try again.")

    for r in (account.router, campaigns.router, leads.router, sent.router, admin.router, public.router,
              auth_routes.router, auth_routes.cron_router):
        app.include_router(r)
    if settings.dev_workspaces_enabled:
        app.include_router(public.dev_router)

    @app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
    async def api_not_found(rest: str) -> JSONResponse:
        return _error(404, "not_found", "That wasn't found.")

    mount_frontend(app, settings.frontend_dist)
    return app


def mount_frontend(app: FastAPI, dist: Path) -> None:
    index = dist / "index.html"
    assets = dist / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str) -> Any:
        if not index.is_file():
            return HTMLResponse(
                "<!doctype html><meta charset='utf-8'><title>NearbyNudge</title>"
                "<p style='font-family:system-ui;margin:2rem'>The dashboard isn't built yet. "
                "Run <code>npm run build</code> in the <code>frontend</code> folder, then reload.</p>",
                status_code=503,
            )
        candidate = (dist / path).resolve()
        if path and candidate.is_file() and dist.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(index, headers={"cache-control": "no-cache"})

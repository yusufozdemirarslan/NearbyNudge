"""Sign-in for the one account (there's no sign-up), and the daily clean-up Vercel Cron calls.

GET  /api/auth/session   whether this copy asks for sign-in, and whether this browser is signed in
POST /api/auth/login     email and password -> the session cookie
POST /api/auth/logout    clears the session cookie
GET  /api/cron/maintenance   (Authorization: Bearer CRON_SECRET) retention clean-up and stuck-job sweep
"""

from __future__ import annotations

import asyncio
import hmac
import math

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse

from .. import auth, schemas
from ..pipeline.state import AppState
from .deps import ApiError, client_ip, get_app

router = APIRouter(prefix="/api/auth", tags=["auth"])
cron_router = APIRouter(prefix="/api/cron", tags=["cron"])

WRONG = "That email and password don't match. Check them and try again."
#: A wrong password waits this long before the answer, which slows down guessing a little more
FAILED_DELAY_S = 0.5


def _session(app: AppState, request: Request) -> dict:
    settings = app.settings
    if not settings.login_enabled:
        return {"enabled": False, "signed_in": True, "email": None}
    signed_in = auth.session_valid(settings, request.cookies.get(auth.SESSION_COOKIE))
    return {"enabled": True, "signed_in": signed_in, "email": settings.login_email.strip().lower() if signed_in else None}


@router.get("/session", response_model=schemas.SessionResponse)
def session(request: Request, app: AppState = Depends(get_app)) -> dict:
    return _session(app, request)


def _wait_text(seconds: int) -> str:
    minutes = math.ceil(seconds / 60)
    return "a minute" if minutes <= 1 else f"{minutes} minutes"


@router.post("/login", response_model=schemas.SessionResponse)
async def login(body: schemas.LoginRequest, request: Request, app: AppState = Depends(get_app)) -> Response:
    settings = app.settings
    if not settings.login_enabled:
        raise ApiError(404, "not_found", "Sign-in isn't turned on for this copy of NearbyNudge.")
    client = auth.client_key(settings, client_ip(request))
    wait = await app.db.arun(lambda s: auth.wait_seconds(s, client))
    if wait:
        raise ApiError(429, "rate_limited", f"Too many attempts. Try again in {_wait_text(wait)}.")
    # The password is checked even when the email is wrong, so both take the same time.
    password_ok = await asyncio.to_thread(auth.verify_password, body.password, settings.login_password_hash)
    ok = auth.same_login(body.email, settings.login_email) and password_ok
    await app.db.arun(lambda s: auth.record_attempt(s, client, ok))
    if not ok:
        await asyncio.sleep(FAILED_DELAY_S)
        raise ApiError(401, "bad_credentials", WRONG, {"password": WRONG})
    response = JSONResponse({"enabled": True, "signed_in": True, "email": settings.login_email.strip().lower()})
    response.headers.append("set-cookie", auth.session_cookie(settings, auth.make_session(settings)))
    return response


@router.post("/logout", status_code=204)
def logout(app: AppState = Depends(get_app)) -> Response:
    response = Response(status_code=204)
    response.headers.append("set-cookie", auth.cleared_cookie(app.settings))
    return response


@cron_router.get("/maintenance")
async def maintenance(request: Request, app: AppState = Depends(get_app)) -> dict:
    secret = app.settings.cron_secret.strip()
    given = request.headers.get("authorization", "")
    if not secret or not hmac.compare_digest(given.encode("utf-8"), f"Bearer {secret}".encode("utf-8")):
        raise ApiError(404, "not_found", "That wasn't found.")
    if app.settings.serverless:
        from .. import serverless

        return {"ok": True, **(await serverless.sweep(app))}
    from ..app import purge

    return {"ok": True, **{f"purged_{k}": v for k, v in (await asyncio.to_thread(purge, app.db)).items()}}

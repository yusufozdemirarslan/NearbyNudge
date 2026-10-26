"""Sign-in for the one account: the password hash, the session cookie, the sign-in gate on the API, the slow-down
after wrong passwords, and the settings a hosted copy can't run without."""

from __future__ import annotations

import subprocess
import sys
import time
from collections.abc import Iterator
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from nearbynudge import auth
from nearbynudge.api import auth_routes
from nearbynudge.app import create_app
from nearbynudge.config import Settings
from nearbynudge.db import Database, utcnow
from nearbynudge.models import LoginAttempt
from nearbynudge.security import limiter
from tests.conftest import PROFILE, Api, ai_http_client

EMAIL = "Owner@Example.org"
PASSWORD = "K7PM-X4RT-9QWZ"
SECRET = "s3cret-" * 8


def with_login(settings: Settings, **extra) -> Settings:
    return settings.model_copy(update={"login_email": EMAIL, "login_password_hash": auth.hash_password(PASSWORD),
                                       "session_secret": SECRET, **extra})


@pytest.fixture
def login_settings(settings: Settings) -> Settings:
    return with_login(settings)


@pytest.fixture
def guest(login_settings: Settings, fake_ai, monkeypatch) -> Iterator[Api]:
    """A browser that hasn't signed in yet, on a copy with sign-in on."""
    monkeypatch.setattr(auth_routes, "FAILED_DELAY_S", 0)
    limiter.reset()
    with TestClient(create_app(login_settings, ai_http_client=ai_http_client(fake_ai)), base_url="http://localhost:8000") as client:
        client.get("/api/auth/session")  # the first page load hands out the CSRF cookie
        yield Api(client)


def sign_in(api: Api, email: str = EMAIL, password: str = PASSWORD):
    return api.post("/api/auth/login", {"email": email, "password": password})


# ---------- the pieces ----------

def test_password_hashes_verify_only_the_right_password():
    encoded = auth.hash_password(PASSWORD)
    assert encoded.startswith("scrypt:16384:8:1:") and "$" not in encoded and PASSWORD not in encoded
    assert auth.verify_password(PASSWORD, encoded)
    assert not auth.verify_password(PASSWORD.lower(), encoded)
    assert not auth.verify_password("", encoded)
    assert auth.hash_password(PASSWORD) != encoded  # a new salt every time
    for broken in ("", "scrypt", "bcrypt:16384:8:1:aaaa:bbbb", "scrypt:x:8:1:aaaa:bbbb", encoded + ":extra",
                   "scrypt:4194304:8:1:" + encoded.split(":", 4)[4]):  # absurd costs are refused, not computed
        assert not auth.verify_password(PASSWORD, broken)


def test_session_tokens_are_signed_scoped_and_expire(login_settings: Settings):
    now = time.time()
    token = auth.make_session(login_settings, now=now)
    assert auth.session_valid(login_settings, token, now=now + 60)
    assert not auth.session_valid(login_settings, token, now=now + auth.session_seconds(login_settings) + 1)
    body, sig = token.split(".")
    assert not auth.session_valid(login_settings, f"{body}.{sig[:-2]}AA", now=now)
    assert not auth.session_valid(login_settings, f"{body}x.{sig}", now=now)
    assert not auth.session_valid(login_settings, "", now=now)
    assert not auth.session_valid(login_settings, None, now=now)
    # issued in the future (a clock trick) doesn't count
    assert not auth.session_valid(login_settings, auth.make_session(login_settings, now=now + 3600), now=now)
    # a new password, a new secret or another account signs the old cookie out
    for change in ({"login_password_hash": auth.hash_password("another password 1")},
                   {"session_secret": "different-" * 4}, {"login_email": "someone@example.org"}):
        assert not auth.session_valid(login_settings.model_copy(update=change), token, now=now)
    # with sign-in off there's no session to check
    assert not auth.session_valid(login_settings.model_copy(update={"login_password_hash": ""}), token, now=now)


def test_the_hash_password_command_reads_stdin():
    backend = Path(__file__).resolve().parents[1]
    out = subprocess.run([sys.executable, "-m", "nearbynudge", "hash-password"], input=PASSWORD + "\n", capture_output=True,
                         text=True, cwd=backend, timeout=60)
    assert out.returncode == 0, out.stderr
    assert auth.verify_password(PASSWORD, out.stdout.strip())
    short = subprocess.run([sys.executable, "-m", "nearbynudge", "hash-password"], input="short\n", capture_output=True,
                           text=True, cwd=backend, timeout=60)
    assert short.returncode == 1 and "at least 10" in short.stderr


# ---------- sign-in off (this computer, tests) ----------

def test_without_a_password_hash_there_is_no_sign_in(api: Api):
    assert api.get("/api/auth/session").json() == {"enabled": False, "signed_in": True, "email": None}
    assert api.get("/api/me").status_code == 200
    r = sign_in(api)
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


# ---------- sign-in on ----------

def test_the_api_needs_a_signed_in_browser(guest: Api):
    assert guest.get("/api/auth/session").json() == {"enabled": True, "signed_in": False, "email": None}
    for path in ("/api/me", "/api/account", "/api/campaigns", "/api/status", "/api/campaigns/x/events", "/api/openapi.json",
                 "/api/admin/overview", "/api/does-not-exist"):
        r = guest.get(path)
        assert r.status_code == 401, path
        assert r.json()["error"] == {"code": "auth_required", "message": "Please sign in to continue."}
        assert r.headers["cache-control"] == "no-store" and "content-security-policy" in r.headers
    assert guest.put("/api/account/profile", PROFILE).status_code == 401
    # open without signing in: health, sign-in itself, the site-owner opt-out and the pages
    assert guest.get("/api/health").status_code == 200
    assert guest.post("/api/public/optout", {"domain": "not a domain", "email": "x"}).status_code == 422
    assert guest.get("/bot").status_code != 401
    assert guest.get("/").status_code != 401


def test_signing_in_and_out(guest: Api):
    wrong = sign_in(guest, password="K7PM-X4RT-9QWX")
    assert wrong.status_code == 401
    assert wrong.json()["error"]["code"] == "bad_credentials"
    assert "don't match" in wrong.json()["error"]["message"]
    assert sign_in(guest, email="someone@example.org").status_code == 401  # the same answer: no hint which one was wrong
    assert guest.get("/api/me").status_code == 401

    ok = sign_in(guest, email="  owner@EXAMPLE.org ")  # the email in any case, with stray spaces
    assert ok.status_code == 200, ok.text
    assert ok.json() == {"enabled": True, "signed_in": True, "email": "owner@example.org"}
    cookie = ok.headers["set-cookie"]
    assert cookie.startswith("nn_session=") and "HttpOnly" in cookie and "SameSite=Lax" in cookie and "Path=/" in cookie
    assert "Secure" not in cookie  # plain http on this computer; hosted it's https and Secure (below)
    assert guest.get("/api/me").status_code == 200
    assert guest.put("/api/account/profile", PROFILE).status_code == 200
    assert guest.get("/api/auth/session").json()["signed_in"] is True

    out = guest.post("/api/auth/logout")
    assert out.status_code == 204 and "Max-Age=0" in out.headers["set-cookie"]
    assert guest.get("/api/me").status_code == 401
    # signing out needs the CSRF header like every other change
    assert guest.c.post("/api/auth/logout").status_code == 403


def test_a_tampered_or_foreign_cookie_is_refused(guest: Api, login_settings: Settings):
    assert sign_in(guest).status_code == 200
    token = guest.c.cookies.get("nn_session") or ""
    assert guest.get("/api/me").status_code == 200
    other = login_settings.model_copy(update={"session_secret": "another-secret-" * 3})
    for forged in (token[:-3] + "abc", auth.make_session(other), token.split(".")[0], "nn." + token):
        guest.c.cookies.clear()
        guest.c.cookies.set("nn_session", forged)
        assert guest.get("/api/me").status_code == 401, forged


def test_wrong_passwords_slow_down_sign_in(guest: Api, login_settings: Settings):
    for _ in range(auth.PER_CLIENT_FAILURES):
        assert sign_in(guest, password="wrong password!").status_code == 401
    blocked = sign_in(guest)  # even the right password waits now
    assert blocked.status_code == 429
    assert blocked.json()["error"]["message"].startswith("Too many attempts. Try again in")
    db = Database(login_settings.database_url)
    try:
        client = auth.client_key(login_settings, "testclient")
        later = utcnow() + auth.WINDOW + timedelta(seconds=5)
        assert db.run(lambda s: auth.wait_seconds(s, client)) > 0
        assert db.run(lambda s: auth.wait_seconds(s, client, now=later)) == 0
        # nothing stores the address itself
        assert all("testclient" not in row.client for row in db.run(lambda s: s.query(LoginAttempt).all()))
    finally:
        db.dispose()


def test_a_right_password_starts_the_count_over(guest: Api):
    for _ in range(auth.PER_CLIENT_FAILURES - 1):
        assert sign_in(guest, password="wrong password!").status_code == 401
    assert sign_in(guest).status_code == 200
    for _ in range(auth.PER_CLIENT_FAILURES - 1):
        assert sign_in(guest, password="wrong password!").status_code == 401
    assert sign_in(guest).status_code == 200


def test_many_wrong_passwords_from_everywhere_slow_everyone_down(login_settings: Settings):
    db = Database(login_settings.database_url)
    try:
        db.create_all()
        for i in range(auth.ALL_FAILURES):
            db.run(lambda s, i=i: auth.record_attempt(s, f"client-{i}", False))
        assert db.run(lambda s: auth.wait_seconds(s, "a-new-client")) == 60
        assert db.run(lambda s: auth.purge_attempts(s, now=utcnow() + timedelta(days=2))) >= auth.ALL_FAILURES
        assert db.run(lambda s: auth.wait_seconds(s, "a-new-client")) == 0
    finally:
        db.dispose()


def test_hosted_cookies_are_secure(settings: Settings, fake_ai, monkeypatch):
    monkeypatch.setattr(auth_routes, "FAILED_DELAY_S", 0)
    hosted = with_login(settings, public_url="https://nudge.example.org")
    with TestClient(create_app(hosted, ai_http_client=ai_http_client(fake_ai)), base_url="https://nudge.example.org") as client:
        client.get("/api/auth/session")
        api = Api(client)
        r = sign_in(api)
        assert r.status_code == 200 and "Secure" in r.headers["set-cookie"]
        assert r.headers["strict-transport-security"].startswith("max-age=")


# ---------- settings ----------

def test_sign_in_needs_an_email_and_a_long_secret(login_settings: Settings):
    login_settings.validate_for_start()
    with pytest.raises(RuntimeError, match="NN_LOGIN_EMAIL"):
        login_settings.model_copy(update={"login_email": " "}).validate_for_start()
    with pytest.raises(RuntimeError, match="NN_SESSION_SECRET"):
        login_settings.model_copy(update={"session_secret": "short"}).validate_for_start()


def test_a_hosted_copy_never_runs_open_or_on_a_local_file(settings: Settings, login_settings: Settings):
    with pytest.raises(RuntimeError, match="needs sign-in"):
        settings.model_copy(update={"serverless": True, "db_url": "postgresql://u:p@db.example/nn"}).validate_for_start()
    with pytest.raises(RuntimeError, match="needs a Postgres database"):
        login_settings.model_copy(update={"serverless": True, "db_url": ""}).validate_for_start()
    login_settings.model_copy(update={"serverless": True, "db_url": "postgresql://u:p@db.example/nn"}).validate_for_start()


def test_hosted_database_addresses(settings: Settings):
    hosted = settings.model_copy(update={"serverless": True, "db_url": "", "hosted_database_url": "postgres://u:p@h/db?sslmode=require"})
    assert hosted.database_url == "postgresql+psycopg://u:p@h/db?sslmode=require"
    # on this computer a DATABASE_URL from somewhere else is ignored
    local = settings.model_copy(update={"db_url": "", "hosted_database_url": "postgres://u:p@h/db"})
    assert local.database_url.startswith("sqlite:///")


# ---------- the daily clean-up ----------

def test_the_cron_route_needs_its_secret(login_settings: Settings, fake_ai):
    cron = login_settings.model_copy(update={"cron_secret": "cron-" * 8})
    with TestClient(create_app(cron, ai_http_client=ai_http_client(fake_ai)), base_url="http://localhost:8000") as client:
        assert client.get("/api/cron/maintenance").status_code == 404
        assert client.get("/api/cron/maintenance", headers={"authorization": "Bearer nope"}).status_code == 404
        ok = client.get("/api/cron/maintenance", headers={"authorization": "Bearer " + "cron-" * 8})
        assert ok.status_code == 200 and ok.json()["ok"] is True and "purged_login_attempts" in ok.json()
    with TestClient(create_app(login_settings, ai_http_client=ai_http_client(fake_ai)), base_url="http://localhost:8000") as client:
        assert client.get("/api/cron/maintenance", headers={"authorization": "Bearer "}).status_code == 404

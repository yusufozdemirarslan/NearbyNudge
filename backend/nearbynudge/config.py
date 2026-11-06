"""Runtime settings, read from environment variables and the project's .env file."""

from __future__ import annotations

import os
import tempfile
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]  # NearbyNudge-2.0/

AI_MODEL = "claude-sonnet-5-5"


def on_vercel() -> bool:
    """True inside a Vercel deployment (build or function), where Vercel sets VERCEL=1."""
    return os.environ.get("VERCEL") == "1"


def default_public_url() -> str:
    """On Vercel, the project's production address (a system variable Vercel sets); here, this computer."""
    production = os.environ.get("VERCEL_PROJECT_PRODUCTION_URL", "").strip()
    return f"https://{production}" if on_vercel() and production else "http://localhost:8000"


def sqlalchemy_url(url: str) -> str:
    """A database address as SQLAlchemy takes it: hosted Postgres addresses ("postgres://...") use psycopg 3."""
    url = url.strip()
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ROOT / ".env"), env_file_encoding="utf-8", extra="ignore", populate_by_name=True
    )

    # The one outside API: Claude through the Anthropic API
    anthropic_api_key: str = Field("", alias="ANTHROPIC_API_KEY")
    anthropic_base_url: str = Field("", alias="ANTHROPIC_BASE_URL")
    ai_model: str = Field(AI_MODEL, alias="AI_MODEL")
    ai_effort: str = Field("medium", alias="AI_EFFORT")  # low | medium | high | xhigh | max
    ai_display_name: str = Field("Claude", alias="AI_DISPLAY_NAME")
    ai_rpm: int = Field(50, alias="NN_AI_RPM")
    ai_max_concurrency: int = Field(8, alias="NN_AI_MAX_CONCURRENCY")
    ai_timeout_s: float = Field(180.0, alias="NN_AI_TIMEOUT_S")
    ai_fallbacks: bool = Field(True, alias="NN_AI_FALLBACKS")  # server-side refusal fallback (Claude API)
    ai_web_search: bool = Field(True, alias="NN_AI_WEB_SEARCH")  # verify businesses that have no website
    ai_outage_pause_s: float = Field(60.0, alias="NN_AI_OUTAGE_PAUSE_S")  # how long an overload or outage pauses work
    retry_delay_s: float = Field(60.0, alias="NN_RETRY_DELAY_S")  # when a job waiting on the AI is tried again

    # App
    env: str = Field("dev", alias="NN_ENV")  # dev | test | prod
    data_dir: Path = Field(ROOT / "data", alias="NN_DATA_DIR")
    db_url: str = Field("", alias="NN_DB_URL")
    listings_path: Path | None = Field(None, alias="NN_LISTINGS_PATH")
    frontend_dist: Path = Field(ROOT / "frontend" / "dist", alias="NN_FRONTEND_DIST")
    public_url: str = Field(default_factory=default_public_url, alias="NN_PUBLIC_URL")
    # Test servers only: separate workspaces per test (POST /api/dev/workspace). Never on in the real app.
    dev_workspaces: bool = Field(False, alias="NN_DEV_WORKSPACES")

    # Sign-in for the one account. Off while no password hash is set (tests; local use without it).
    # Make the hash with: python -m nearbynudge hash-password (it reads the password from stdin).
    login_email: str = Field("", alias="NN_LOGIN_EMAIL")
    login_password_hash: str = Field("", alias="NN_LOGIN_PASSWORD_HASH")
    session_secret: str = Field("", alias="NN_SESSION_SECRET")
    session_days: float = Field(7.0, alias="NN_SESSION_DAYS")

    # Hosting on Vercel (serverless): set by Vercel itself (VERCEL=1), or NN_SERVERLESS=1 to try it locally.
    serverless: bool = Field(default_factory=on_vercel, alias="NN_SERVERLESS")
    # The hosted Postgres database from the Vercel Marketplace (Neon), used when NN_DB_URL isn't set
    hosted_database_url: str = Field("", alias="DATABASE_URL")
    hosted_postgres_url: str = Field("", alias="POSTGRES_URL")
    # Vercel Cron sends it as a bearer token to /api/cron/* (the daily clean-up)
    cron_secret: str = Field("", alias="CRON_SECRET")

    # Work limits (PRD)
    worker_concurrency: int = Field(4, alias="NN_WORKER_CONCURRENCY")
    worker_enabled: bool = Field(True, alias="NN_WORKER_ENABLED")
    lead_cost_cap_usd: float = Field(0.30, alias="NN_LEAD_COST_CAP")  # sized for Sonnet 5.5 prices
    monthly_lead_limit: int = Field(100, alias="NN_MONTHLY_LEAD_LIMIT")
    daily_send_cap: int = Field(20, alias="NN_DAILY_SEND_CAP")

    # Reader
    reader_allow_private: bool = Field(False, alias="NN_READER_ALLOW_PRIVATE")
    reader_min_interval_s: float = Field(1.0, alias="NN_READER_MIN_INTERVAL_S")

    @property
    def ai_configured(self) -> bool:
        return bool(self.anthropic_api_key.strip())

    @property
    def database_url(self) -> str:
        # A hosted address only counts on a hosted server, so a DATABASE_URL left over from another project on this
        # computer can't redirect the local app.
        hosted = (self.hosted_database_url or self.hosted_postgres_url) if self.serverless else ""
        url = self.db_url or hosted
        return sqlalchemy_url(url) if url else f"sqlite:///{(self.data_dir / 'app.db').as_posix()}"

    @property
    def runtime_dir(self) -> Path:
        """Where a serverless instance may write (its own temporary folder; the deployment itself is read-only)."""
        return Path(tempfile.gettempdir()) / "nearbynudge"

    @property
    def listings_file(self) -> Path:
        """The listings store. Hosted, this is the copy the deployment carries (loaded at build time), and each server
        instance works on its own copy of it (serverless.listings_copy)."""
        return self.listings_path or (self.data_dir / "listings.duckdb")

    @property
    def secure_cookies(self) -> bool:
        # Vercel serves only https, so cookies are Secure there even before NN_PUBLIC_URL names the address
        return self.public_url.startswith("https://") or (self.serverless and on_vercel())

    @property
    def login_enabled(self) -> bool:
        return bool(self.login_password_hash.strip())

    @property
    def dev_workspaces_enabled(self) -> bool:
        return self.dev_workspaces and self.env in ("dev", "test")

    @property
    def allowed_hosts(self) -> set[str]:
        """Host names the server answers to: this computer, plus the public address when one is set, plus (on
        Vercel) the deployment's own addresses."""
        hosts = {"localhost", "127.0.0.1", "::1"}
        public = urlparse(self.public_url).hostname
        if public:
            hosts.add(public.lower())
        if self.serverless:
            for name in ("VERCEL_URL", "VERCEL_BRANCH_URL", "VERCEL_PROJECT_PRODUCTION_URL"):
                value = os.environ.get(name, "").strip().lower()
                if value:
                    hosts.add(value.split("/", 1)[0])
        return hosts

    @property
    def bot_user_agent(self) -> str:
        return f"NearbyNudgeBot/2.0 (+{self.public_url.rstrip('/')}/bot)"

    def validate_for_start(self) -> None:
        if self.env not in ("dev", "test", "prod"):
            raise RuntimeError(f"NN_ENV must be dev, test or prod (got {self.env!r})")
        if self.env == "prod" and self.dev_workspaces:
            raise RuntimeError("NN_DEV_WORKSPACES must not be enabled when NN_ENV=prod")
        if self.env == "prod" and self.reader_allow_private:
            raise RuntimeError("NN_READER_ALLOW_PRIVATE must not be enabled when NN_ENV=prod")
        if self.login_enabled:
            if not self.login_email.strip():
                raise RuntimeError("NN_LOGIN_EMAIL must be set when NN_LOGIN_PASSWORD_HASH is")
            if len(self.session_secret.strip()) < 32:
                raise RuntimeError("NN_SESSION_SECRET must be set (at least 32 characters) when sign-in is on")
        if self.serverless:
            # A hosted copy is reachable by anyone, so it never runs without sign-in or on a throwaway database.
            if not self.login_enabled:
                raise RuntimeError("A hosted NearbyNudge needs sign-in: set NN_LOGIN_EMAIL, NN_LOGIN_PASSWORD_HASH "
                                   "and NN_SESSION_SECRET")
            if self.database_url.startswith("sqlite"):
                raise RuntimeError("A hosted NearbyNudge needs a Postgres database: set DATABASE_URL or NN_DB_URL")


@lru_cache
def get_settings() -> Settings:
    return Settings()

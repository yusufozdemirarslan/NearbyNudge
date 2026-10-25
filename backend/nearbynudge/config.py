"""Runtime settings, read from environment variables and the project's .env file."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]  # NearbyNudge-2.0/

AI_MODEL = "claude-sonnet-5-5"


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
    public_url: str = Field("http://localhost:8000", alias="NN_PUBLIC_URL")
    # Test servers only: separate workspaces per test (POST /api/dev/workspace). Never on in the real app.
    dev_workspaces: bool = Field(False, alias="NN_DEV_WORKSPACES")

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
        return self.db_url or f"sqlite:///{(self.data_dir / 'app.db').as_posix()}"

    @property
    def listings_file(self) -> Path:
        return self.listings_path or (self.data_dir / "listings.duckdb")

    @property
    def secure_cookies(self) -> bool:
        return self.public_url.startswith("https://")

    @property
    def dev_workspaces_enabled(self) -> bool:
        return self.dev_workspaces and self.env in ("dev", "test")

    @property
    def allowed_hosts(self) -> set[str]:
        """Host names the server answers to: this computer, plus the public address when one is set."""
        hosts = {"localhost", "127.0.0.1", "::1"}
        public = urlparse(self.public_url).hostname
        if public:
            hosts.add(public.lower())
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


@lru_cache
def get_settings() -> Settings:
    return Settings()

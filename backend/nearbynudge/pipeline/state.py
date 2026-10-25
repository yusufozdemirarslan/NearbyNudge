"""The running app's shared services."""

from __future__ import annotations

import asyncio
import logging
import threading
import traceback
from dataclasses import dataclass, field
from functools import partial
from typing import TYPE_CHECKING, Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import emailtext
from ..ai.client import AIClient
from ..config import Settings
from ..db import Database, after_commit
from ..models import Campaign, ErrorLog, Lead, OptOut, User
from . import serialize
from .events import EventBroker
from .pause import MESSAGES, DbPause

if TYPE_CHECKING:  # pragma: no cover
    from ..geo import Gazetteer
    from ..listings import ListingsStore
    from ..reader import Reader
    from .worker import Worker

log = logging.getLogger("nearbynudge")


class OptOutCache:
    """Site owners who asked NearbyNudgeBot to stay away (by registrable domain)."""

    def __init__(self, db: Database):
        self.db = db
        self._domains: set[str] = set()
        self._lock = threading.Lock()
        self.refresh()

    def refresh(self) -> None:
        domains = self.db.run(lambda s: {d for (d,) in s.execute(select(OptOut.domain)).all()})
        with self._lock:
            self._domains = {d.lower() for d in domains}

    def contains(self, domain: str) -> bool:
        d = (domain or "").lower()
        with self._lock:
            return d in self._domains or any(d.endswith("." + x) for x in self._domains)


@dataclass
class AppState:
    settings: Settings
    db: Database
    ai: AIClient
    pause: DbPause
    broker: EventBroker
    optouts: OptOutCache
    reader: Reader | None = None
    listings: ListingsStore | None = None
    gazetteer: Gazetteer | None = None
    worker: Worker | None = None
    area_loads: dict[str, asyncio.Task[Any]] = field(default_factory=dict)
    background_tasks: set[asyncio.Task[Any]] = field(default_factory=set)
    web_search_state: str = "unknown"  # available | unavailable | unknown

    # ---------- AI status ----------

    def ai_state(self) -> tuple[str, str | None, str | None]:
        """(state, reason, message)"""
        if not self.ai.configured:
            return "unconfigured", "unconfigured", MESSAGES["unconfigured"]
        st = self.pause.state()
        if st:
            reason = st.get("reason")
            return "paused", reason, MESSAGES.get(reason or "down", MESSAGES["down"])
        return "ok", None, None

    def paused_message(self) -> str | None:
        state, _, message = self.ai_state()
        return message if state != "ok" else None

    # ---------- profile helpers ----------

    @staticmethod
    def footer_for(user: User | None) -> str:
        return emailtext.build_footer(user.profile if user else None)

    # ---------- live events ----------

    def publish_lead(self, db: Session, lead: Lead) -> None:
        """Sends the lead's new state to open review desks once this transaction is saved."""
        data = serialize.lead_summary(lead, serialize.subjects_for(db, [lead]).get(lead.id))
        if lead.status == "replaced":
            data["status"] = "failed"
            data["replaced"] = True
        after_commit(db, partial(self.broker.publish, lead.campaign_id, "lead", data))

    def publish_campaign(self, db: Session, campaign: Campaign) -> None:
        """Sends the campaign's new counts to open review desks once this transaction is saved."""
        data = serialize.campaign_summary(
            db, campaign, paused_message=self.paused_message(), concurrency=self.settings.worker_concurrency
        )
        after_commit(db, partial(self.broker.publish, campaign.id, "campaign", data))

    # ---------- errors ----------

    async def alog_error(self, where: str, message: str, *, exc: BaseException | None = None,
                         campaign_id: str | None = None, lead_id: str | None = None) -> None:
        await asyncio.to_thread(self.log_error, where, message, exc=exc, campaign_id=campaign_id, lead_id=lead_id)

    def log_error(self, where: str, message: str, *, exc: BaseException | None = None,
                  campaign_id: str | None = None, lead_id: str | None = None) -> None:
        detail = "".join(traceback.format_exception(exc))[-4000:] if exc else None
        try:
            self.db.run(lambda s: s.add(ErrorLog(where=where, message=message[:2000], detail=detail,
                                                 campaign_id=campaign_id, lead_id=lead_id)))
        except Exception:  # noqa: BLE001
            log.exception("could not write the error log")
        log.error("%s: %s", where, message, exc_info=exc)

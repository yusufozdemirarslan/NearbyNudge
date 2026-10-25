"""In-process event broker for live campaign updates (Server-Sent Events)."""

from __future__ import annotations

import asyncio
import json
import threading
from collections import defaultdict
from typing import Any


class EventBroker:
    """Thread-safe publish; async subscribe. One process, so memory is enough."""

    def __init__(self) -> None:
        self._subs: dict[str, set[asyncio.Queue[dict[str, Any]]]] = defaultdict(set)
        self._lock = threading.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def subscribe(self, campaign_id: str) -> asyncio.Queue[dict[str, Any]]:
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=500)
        with self._lock:
            self._subs[campaign_id].add(q)
        return q

    def unsubscribe(self, campaign_id: str, q: asyncio.Queue[dict[str, Any]]) -> None:
        with self._lock:
            subs = self._subs.get(campaign_id)
            if subs:
                subs.discard(q)
                if not subs:
                    self._subs.pop(campaign_id, None)

    def publish(self, campaign_id: str, event: str, data: dict[str, Any]) -> None:
        with self._lock:
            queues = list(self._subs.get(campaign_id, ()))
        if not queues:
            return
        payload = {"event": event, "data": data}
        loop = self._loop
        for q in queues:
            if loop is None:
                _put(q, payload)
            else:
                try:
                    running = asyncio.get_running_loop()
                except RuntimeError:
                    running = None
                if running is loop:
                    _put(q, payload)
                else:
                    loop.call_soon_threadsafe(_put, q, payload)

    def subscriber_count(self, campaign_id: str) -> int:
        with self._lock:
            return len(self._subs.get(campaign_id, ()))


def _put(q: asyncio.Queue[dict[str, Any]], payload: dict[str, Any]) -> None:
    try:
        q.put_nowait(payload)
    except asyncio.QueueFull:  # a stalled client; drop the oldest event
        try:
            q.get_nowait()
            q.put_nowait(payload)
        except (asyncio.QueueEmpty, asyncio.QueueFull):
            pass


def sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n"

"""An in-memory web for reader tests: routes absolute URLs to canned responses via httpx.MockTransport."""

from __future__ import annotations

import inspect
import time
from typing import Callable

import httpx

HTML = "text/html; charset=utf-8"


def page(title: str, body: str, head: str = "") -> str:
    return f"<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>{title}</title>{head}</head><body>{body}</body></html>"


def long_text(words: int = 120) -> str:
    sentence = "Our friendly team cares for families in Arlington with gentle, unhurried visits and clear advice. "
    return "<p>" + (sentence * (words // 14 + 1)) + "</p>"


def _key(url: httpx.URL | str) -> str:
    url = httpx.URL(str(url))
    path = url.path or "/"
    return f"{url.scheme}://{url.netloc.decode('ascii').lower()}{path}"


class FakeWeb:
    def __init__(self) -> None:
        self.routes: dict[str, Callable | tuple] = {}
        self.requests: list[httpx.Request] = []
        self.times: list[tuple[float, str]] = []

    # routes -----------------------------------------------------------------
    def add(self, url: str, status: int = 200, body: str | bytes = "", *, content_type: str | None = HTML,
            headers: dict[str, str] | None = None) -> None:
        self.routes[_key(url)] = (status, body, content_type, dict(headers or {}))

    def html(self, url: str, title: str = "Page", body: str = "", status: int = 200, head: str = "") -> None:
        self.add(url, status, page(title, body or long_text(), head))

    def robots(self, origin: str, body: str = "User-agent: *\nAllow: /\n", status: int = 200) -> None:
        self.add(origin.rstrip("/") + "/robots.txt", status, body, content_type="text/plain")

    def redirect(self, url: str, location: str, status: int = 301) -> None:
        self.add(url, status, "", headers={"Location": location})

    def handle(self, url: str, fn: Callable) -> None:
        """fn(request) -> httpx.Response (may be async, may raise httpx errors)."""
        self.routes[_key(url)] = fn

    # transport --------------------------------------------------------------
    async def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        self.times.append((time.monotonic(), str(request.url)))
        route = self.routes.get(_key(request.url))
        if route is None:
            return httpx.Response(404, text="not found", headers={"Content-Type": "text/plain"})
        if callable(route):
            result = route(request)
            return await result if inspect.isawaitable(result) else result
        status, body, content_type, headers = route
        headers = dict(headers)
        if content_type is not None:
            headers.setdefault("Content-Type", content_type)
        content = body.encode("utf-8") if isinstance(body, str) else body
        return httpx.Response(status, content=content, headers=headers)

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self)

    def requested(self) -> list[str]:
        return [str(r.url) for r in self.requests]

    def page_requests(self) -> list[str]:
        return [u for u in self.requested() if not u.endswith("/robots.txt")]

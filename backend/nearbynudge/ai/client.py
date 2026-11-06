"""The AI client: Claude Sonnet 5.5 through the Anthropic API, NearbyNudge's one outside API.

Every call goes through `AIClient.create`, which applies the account rate limit, the effort
level, prompt caching on the skill instructions, server-side refusal fallback, and records
tokens and cost. Account problems (key, billing) pause all AI work; overload pauses it briefly.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import deque
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, TypeVar

import anthropic
from pydantic import BaseModel, ValidationError

from .pricing import WEB_SEARCH_PER_REQUEST, cost_usd

log = logging.getLogger("nearbynudge.ai")

T = TypeVar("T", bound=BaseModel)

FALLBACK_BETA = "server-side-fallback-2026-07-01"


@dataclass
class CallContext:
    skill: str
    user_id: str | None = None
    campaign_id: str | None = None
    lead_id: str | None = None


class AIError(Exception):
    def __init__(self, message: str, *, code: str, status: int | None = None, cost_usd: float = 0.0):
        super().__init__(message)
        self.code = code
        self.status = status
        self.cost_usd = cost_usd


class AIPaused(AIError):
    """The account can't be used right now (key, billing); work waits until it's fixed."""


class AIUnavailable(AIError):
    """Rate limited, overloaded or unreachable after retries; try again shortly."""


class AIRequestError(AIError):
    """The API rejected this request; retrying the same request won't help."""


class AIRefusal(AIRequestError):
    """The model declined (stop_reason "refusal")."""


class StructuredOutputError(AIError):
    """The answer didn't fit the requested shape after asking once more (PRD QC2)."""


class PauseControl:
    def pause(self, reason: str, *, seconds: float | None) -> None:  # pragma: no cover - interface
        raise NotImplementedError


class _NoPause(PauseControl):
    def pause(self, reason: str, *, seconds: float | None) -> None:
        log.warning("AI pause requested (%s) but no pause control is attached", reason)


Recorder = Callable[[CallContext, dict[str, Any]], Awaitable[None]]


@dataclass
class AIResponse:
    message: Any  # anthropic BetaMessage
    content: list[Any]  # content blocks, to append unchanged as the assistant turn
    stop_reason: str | None
    text: str
    cost_usd: float
    latency_ms: int
    usage: dict[str, int]

    def tool_uses(self) -> list[Any]:
        return [b for b in self.content if getattr(b, "type", None) == "tool_use"]

    def blocks_of(self, kind: str) -> list[Any]:
        return [b for b in self.content if getattr(b, "type", None) == kind]


@dataclass
class _Window:
    rpm: int
    times: deque[float] = field(default_factory=deque)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def acquire(self) -> None:
        while True:
            async with self.lock:
                now = time.monotonic()
                while self.times and now - self.times[0] >= 60:
                    self.times.popleft()
                if len(self.times) < self.rpm:
                    self.times.append(now)
                    return
                wait = 60 - (now - self.times[0]) + 0.05
            await asyncio.sleep(max(wait, 0.05))


def output_format(model: type[BaseModel]) -> dict[str, Any]:
    return {"type": "json_schema", "schema": anthropic.transform_schema(model)}


def strict_tool(name: str, description: str, model: type[BaseModel]) -> dict[str, Any]:
    return {"name": name, "description": description, "input_schema": anthropic.transform_schema(model), "strict": True}


class AIClient:
    def __init__(
        self,
        *,
        api_key: str,
        model: str = "claude-sonnet-5-5",
        effort: str = "medium",
        rpm: int = 50,
        max_concurrency: int = 8,
        timeout_s: float = 180.0,
        fallbacks: bool = True,
        max_retries: int = 3,
        recorder: Recorder | None = None,
        pause: PauseControl | None = None,
        base_url: str | None = None,
        http_client: Any | None = None,
        outage_pause_s: float = 60.0,
    ):
        self.model = model
        self.effort = effort
        self.fallbacks = fallbacks
        self.outage_pause_s = outage_pause_s
        self.recorder = recorder
        self.pause_control = pause or _NoPause()
        self._key = api_key.strip()
        self._window = _Window(rpm=max(1, rpm))
        self._sem = asyncio.Semaphore(max(1, max_concurrency))
        kwargs: dict[str, Any] = {"api_key": self._key or "missing", "timeout": timeout_s, "max_retries": max_retries}
        if base_url:
            kwargs["base_url"] = base_url
        if http_client is not None:
            kwargs["http_client"] = http_client
        self.sdk = anthropic.AsyncAnthropic(**kwargs)

    @property
    def configured(self) -> bool:
        return bool(self._key)

    async def aclose(self) -> None:
        await self.sdk.close()

    async def create(
        self,
        ctx: CallContext,
        *,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        output: type[BaseModel] | None = None,
        max_tokens: int = 16000,
        cache_conversation: bool = False,
    ) -> AIResponse:
        """One Messages API request. `system` must be stable text (it is cached)."""
        if not self.configured:
            raise AIPaused("The Anthropic API key isn't set.", code="unconfigured")
        output_config: dict[str, Any] = {"effort": self.effort}
        if output is not None:
            output_config["format"] = output_format(output)
        kwargs: dict[str, Any] = {
            "model": self.model,
            "max_tokens": max_tokens,
            "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            "messages": messages,
            "output_config": output_config,
        }
        if tools:
            kwargs["tools"] = tools
        if cache_conversation:
            kwargs["cache_control"] = {"type": "ephemeral"}
        if self.fallbacks:
            kwargs["betas"] = [FALLBACK_BETA]
            kwargs["fallbacks"] = "default"

        await self._window.acquire()
        started = time.monotonic()
        try:
            async with self._sem:
                try:
                    msg = await self.sdk.beta.messages.create(**kwargs)
                except anthropic.BadRequestError as exc:
                    text = _message_of(exc).lower()
                    if self.fallbacks and ("anthropic-beta" in text or "fallback" in text):
                        # this account doesn't offer server-side fallback: carry on without it
                        log.warning("refusal fallback isn't available for this key; continuing without it")
                        self.fallbacks = False
                        kwargs.pop("betas", None)
                        kwargs.pop("fallbacks", None)
                        msg = await self.sdk.beta.messages.create(**kwargs)
                    else:
                        raise
        except anthropic.AuthenticationError as exc:
            err = AIPaused("The Anthropic API rejected the key.", code="auth", status=401)
            await self._record_error(ctx, started, err)
            await self._pause("auth", seconds=None)
            raise err from exc
        except anthropic.PermissionDeniedError as exc:
            err = AIPaused("The Anthropic API key isn't allowed to do this.", code="auth", status=403)
            await self._record_error(ctx, started, err)
            await self._pause("auth", seconds=None)
            raise err from exc
        except anthropic.NotFoundError as exc:
            err0 = AIPaused(f"The AI model {self.model} isn't available to this key.", code="config", status=404)
            await self._record_error(ctx, started, err0)
            await self._pause("config", seconds=None)
            raise err0 from exc
        except anthropic.RateLimitError as exc:
            err = AIUnavailable("The AI is rate limited right now.", code="rate_limited", status=429)
            await self._record_error(ctx, started, err)
            await self._pause("rate_limited", seconds=_retry_after(exc) or self.outage_pause_s)
            raise err from exc
        except anthropic.BadRequestError as exc:
            message = _message_of(exc)
            if "credit balance" in message.lower() or "billing" in message.lower():
                err = AIPaused("The Anthropic account is out of credit.", code="balance", status=400)
                await self._record_error(ctx, started, err)
                await self._pause("balance", seconds=None)
                raise err from exc
            err2 = AIRequestError(f"The AI rejected the request: {message}", code="bad_request", status=400)
            await self._record_error(ctx, started, err2)
            raise err2 from exc
        except anthropic.APIStatusError as exc:
            status = exc.status_code
            if status == 402:
                err = AIPaused("The Anthropic account is out of credit.", code="balance", status=402)
                await self._record_error(ctx, started, err)
                await self._pause("balance", seconds=None)
                raise err from exc
            if status >= 500:
                err3 = AIUnavailable(f"The AI service is busy ({status}).", code="down", status=status)
                await self._record_error(ctx, started, err3)
                await self._pause("down", seconds=self.outage_pause_s)
                raise err3 from exc
            err4 = AIRequestError(f"The AI rejected the request ({status}): {_message_of(exc)}", code="bad_request", status=status)
            await self._record_error(ctx, started, err4)
            raise err4 from exc
        except anthropic.APITimeoutError as exc:  # one slow request: retry it later, don't pause everything
            err6 = AIUnavailable("The AI took too long to answer.", code="timeout")
            await self._record_error(ctx, started, err6)
            raise err6 from exc
        except anthropic.APIConnectionError as exc:
            err5 = AIUnavailable("The AI service didn't respond.", code="network")
            await self._record_error(ctx, started, err5)
            await self._pause("down", seconds=self.outage_pause_s)
            raise err5 from exc

        latency = int((time.monotonic() - started) * 1000)
        usage = _usage(msg)
        cost = _cost(msg, getattr(msg, "model", self.model) or self.model, usage)
        await self._record(ctx, latency, usage, cost, status="ok", error=None)
        content = list(msg.content or [])
        text = "".join(getattr(b, "text", "") for b in content if getattr(b, "type", None) == "text")
        resp = AIResponse(
            message=msg, content=content, stop_reason=msg.stop_reason, text=text,
            cost_usd=cost, latency_ms=latency, usage=usage,
        )
        if msg.stop_reason == "refusal":
            details = getattr(msg, "stop_details", None)
            category = getattr(details, "category", None) if details else None
            raise AIRefusal(f"The AI declined this request ({category or 'no category'}).", code="refusal", cost_usd=cost)
        return resp

    async def structured(
        self,
        ctx: CallContext,
        *,
        system: str,
        user: str | list[dict[str, Any]],
        output: type[T],
        max_tokens: int = 16000,
        attempts: int = 2,
    ) -> tuple[T, float]:
        """Ask for one answer matching `output`; check it field by field and ask once more if needed."""
        messages: list[dict[str, Any]] = [{"role": "user", "content": user}]
        total = 0.0
        problem = "no answer"
        for attempt in range(attempts):
            resp = await self.create(ctx, system=system, messages=messages, output=output, max_tokens=max_tokens)
            total += resp.cost_usd
            if resp.stop_reason == "max_tokens":
                problem = "the answer was cut off"
                max_tokens = min(20000, int(max_tokens * 1.5))  # stays within non-streaming request limits
                continue  # retry the same request with more room
            try:
                return output.model_validate(json.loads(resp.text)), total
            except ValueError as exc:  # json.JSONDecodeError and pydantic ValidationError are both ValueErrors
                problem = _problem(exc)
            if attempt + 1 < attempts:
                messages = [
                    *messages,
                    {"role": "assistant", "content": resp.content},
                    {"role": "user", "content": f"That answer couldn't be used: {problem}. Please answer again in full."},
                ]
        raise StructuredOutputError(f"The AI's answer didn't fit: {problem}", code="structured", cost_usd=total)

    async def probe(self) -> bool:
        """A tiny request to check that the account works again (used while paused)."""
        try:
            await self.create(
                CallContext(skill="probe"),
                system="Reply with the single word OK.",
                messages=[{"role": "user", "content": "Status check."}],
                max_tokens=64,
            )
            return True
        except AIError:
            return False

    # ---------- accounting ----------

    async def _record(self, ctx: CallContext, latency: int, usage: dict[str, int], cost: float, *, status: str, error: AIError | None) -> None:
        if self.recorder is None:
            return
        row = {
            "created_at": datetime.now(UTC).replace(tzinfo=None),
            "skill": ctx.skill,
            "model": self.model,
            "thinking": True,
            "latency_ms": latency,
            "cost_usd": cost,
            "status": status,
            "error_code": error.code if error else None,
            "error_message": str(error)[:2000] if error else None,
            **usage,
        }
        try:
            await self.recorder(ctx, row)
        except Exception:  # noqa: BLE001 - accounting must never break the work
            log.exception("failed to record AI usage")

    async def _pause(self, reason: str, *, seconds: float | None) -> None:
        """Pause AI work; saving the pause is a database write, made off the event loop."""
        await asyncio.to_thread(self.pause_control.pause, reason, seconds=seconds)

    async def _record_error(self, ctx: CallContext, started: float, err: AIError) -> None:
        latency = int((time.monotonic() - started) * 1000)
        zero = {"input_tokens": 0, "cache_write_tokens": 0, "cache_read_tokens": 0, "output_tokens": 0, "web_searches": 0}
        await self._record(ctx, latency, zero, 0.0, status="error", error=err)


def _attempts(msg: Any) -> list[Any]:
    """Every billed attempt of the request. With server-side fallback the top-level usage covers only the attempt
    that answered; `usage.iterations` lists each attempt (a declined one too) with its own model and tokens."""
    u = getattr(msg, "usage", None)
    return list(getattr(u, "iterations", None) or []) or ([u] if u is not None else [])


def _usage(msg: Any) -> dict[str, int]:
    u = getattr(msg, "usage", None)
    server = getattr(u, "server_tool_use", None) if u else None
    attempts = _attempts(msg)

    def total(field: str) -> int:
        return sum(int(getattr(a, field, 0) or 0) for a in attempts)
    return {
        "input_tokens": total("input_tokens"),
        "cache_write_tokens": total("cache_creation_input_tokens"),
        "cache_read_tokens": total("cache_read_input_tokens"),
        "output_tokens": total("output_tokens"),
        "web_searches": int(getattr(server, "web_search_requests", 0) or 0) if server else 0,
    }


def _cost(msg: Any, model: str, usage: dict[str, int]) -> float:
    """Each attempt at its own model's rates. A refusal before any output is billed only in some refusal categories,
    which the usage doesn't say per attempt, so it's counted: the recorded spend is never less than the bill."""
    attempts = _attempts(msg)
    total = sum(
        cost_usd(getattr(a, "model", None) or model,
                 input_tokens=int(getattr(a, "input_tokens", 0) or 0),
                 cache_write_tokens=int(getattr(a, "cache_creation_input_tokens", 0) or 0),
                 cache_read_tokens=int(getattr(a, "cache_read_input_tokens", 0) or 0),
                 output_tokens=int(getattr(a, "output_tokens", 0) or 0))
        for a in attempts
    )
    return round(total + usage["web_searches"] * WEB_SEARCH_PER_REQUEST, 8)


def _message_of(exc: anthropic.APIStatusError) -> str:
    try:
        body = exc.body if isinstance(exc.body, dict) else {}
        err = body.get("error") if isinstance(body, dict) else None
        if isinstance(err, dict) and err.get("message"):
            return str(err["message"])[:400]
    except Exception:  # noqa: BLE001
        pass
    return str(getattr(exc, "message", "") or exc)[:400]


def _retry_after(exc: anthropic.APIStatusError) -> float | None:
    try:
        value = exc.response.headers.get("retry-after")
        return min(120.0, max(1.0, float(value))) if value else None
    except Exception:  # noqa: BLE001
        return None


def _problem(exc: Exception) -> str:
    if isinstance(exc, ValidationError):
        parts = []
        for e in exc.errors()[:6]:
            loc = ".".join(str(x) for x in e.get("loc", ()))
            parts.append(f"{loc or 'answer'}: {e.get('msg')}")
        return "; ".join(parts)
    return "the reply was not valid JSON"

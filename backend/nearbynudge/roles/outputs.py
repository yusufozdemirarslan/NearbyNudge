"""Answer shapes for the five AI roles (sent to the API as JSON schemas, then checked here)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, field_validator


def clean(v: str | None) -> str:
    return " ".join((v or "").split())


# ---------- planner ----------

class PlanQuestionOut(BaseModel):
    text: str
    categories: list[str]

    @field_validator("text")
    @classmethod
    def _text(cls, v: str) -> str:
        return clean(v)


class PlanOut(BaseModel):
    restatement: str
    include: list[str]
    question: PlanQuestionOut | None
    warning: str | None

    @field_validator("restatement")
    @classmethod
    def _restatement(cls, v: str) -> str:
        v = clean(v)
        if not v:
            raise ValueError("restatement is empty")
        return v


# ---------- scout ----------

class RankItem(BaseModel):
    id: str
    score: int
    reason: str

    @field_validator("score")
    @classmethod
    def _score(cls, v: int) -> int:
        return max(0, min(100, int(v)))

    @field_validator("reason")
    @classmethod
    def _reason(cls, v: str) -> str:
        return clean(v)


class RankingOut(BaseModel):
    ranking: list[RankItem]


# ---------- researcher ----------

class FactOut(BaseModel):
    text: str
    quote: str
    url: str

    @field_validator("text", "quote", "url")
    @classmethod
    def _c(cls, v: str) -> str:
        return clean(v)


class VerificationOut(BaseModel):
    operating: Literal["yes", "no", "unclear"]
    address_match: Literal["yes", "no", "unclear"]
    closed_signal: bool
    note: str


class ResearchOut(BaseModel):
    summary: str
    owner_name: str | None
    facts: list[FactOut]
    verification: VerificationOut

    @field_validator("owner_name")
    @classmethod
    def _owner(cls, v: str | None) -> str | None:
        v = clean(v)
        return v[:80] or None


class ReadPagesIn(BaseModel):
    urls: list[str]


# ---------- writer ----------

HookKind = Literal[
    "site_gap", "no_online_booking", "missing_hours", "missing_prices", "no_website", "good_news", "seasonal", "other"
]


class HookOut(BaseModel):
    kind: HookKind
    title: str
    reason: str
    fact_ids: list[str]

    @field_validator("title", "reason")
    @classmethod
    def _c(cls, v: str) -> str:
        return clean(v)


class StrategyOut(BaseModel):
    fit_score: int
    fit_reason: str
    hook: HookOut
    alternatives: list[HookOut]

    @field_validator("fit_score")
    @classmethod
    def _score(cls, v: int) -> int:
        return max(0, min(100, int(v)))

    @field_validator("fit_reason")
    @classmethod
    def _reason(cls, v: str) -> str:
        return clean(v)


class SentenceOut(BaseModel):
    text: str
    kind: Literal["claim", "offer", "other"]
    fact_ids: list[str]

    @field_validator("text")
    @classmethod
    def _text(cls, v: str) -> str:
        return clean(v)


class EmailOut(BaseModel):
    subject: str
    greeting: str
    paragraphs: list[list[SentenceOut]]
    signoff: str

    @field_validator("subject", "greeting", "signoff")
    @classmethod
    def _c(cls, v: str) -> str:
        return clean(v)

    @field_validator("paragraphs")
    @classmethod
    def _paras(cls, v: list[list[SentenceOut]]) -> list[list[SentenceOut]]:
        v = [[s for s in p if s.text] for p in v]
        v = [p for p in v if p]
        if not v:
            raise ValueError("the email body is empty")
        return v


# ---------- editor ----------

class CheckOut(BaseModel):
    passed: bool
    note: str | None


class EditorChecksOut(BaseModel):
    facts: CheckOut
    rules: CheckOut
    spam: CheckOut
    subject: CheckOut


class SentenceVerdict(BaseModel):
    id: str
    supported: bool
    note: str | None


class EditorOut(BaseModel):
    checks: EditorChecksOut
    sentences: list[SentenceVerdict]
    fixes: list[str]
    fixed_email: EmailOut | None

"""Writer: picks the hook and scores fit, writes the email, and rewrites it (HK1, WR1, WR3)."""

from __future__ import annotations

from typing import Any

from ..ai.client import AIClient, CallContext
from .outputs import EmailOut, HookOut, StrategyOut
from .skills import PromptFact, business_block, offer_block, render_email, render_facts, skill_text, today_line

REWRITE_GUIDE = {
    "shorter": "shorter: 80 to 95 words; keep the strongest fact and the ask.",
    "friendlier": "friendlier: warmer and more relaxed; same facts and ask.",
    "more_direct": "more_direct: lead with the point; fewer words; same facts and ask.",
    "another_hook": "another_hook: rebuild the email around the hook below.",
    "remove_fact": "remove_fact: drop or rewrite every sentence that relied on the fact below; add nothing unsupported.",
}


def _hook_text(h: HookOut) -> str:
    return f"{h.title} ({h.kind}): {h.reason} [evidence: {', '.join(h.fact_ids) or 'none'}]"


def _clean_ids(ids: list[str], known: set[str]) -> list[str]:
    return [i for i in dict.fromkeys(ids) if i in known]


def _sanitize_email(email: EmailOut, known: set[str]) -> EmailOut:
    for para in email.paragraphs:
        for s in para:
            s.fact_ids = _clean_ids(s.fact_ids, known) if s.kind == "claim" else []
    return email


async def strategy(
    ai: AIClient, ctx: CallContext, *, business: dict[str, Any], offer: dict[str, Any], facts: list[PromptFact]
) -> tuple[StrategyOut, float]:
    user = (
        f"{today_line()}\nMode: strategy\n\n## Business\n{business_block(business)}\n\n"
        f"## Sender's offer\n{offer_block(offer)}\n\n## Facts\n{render_facts(facts)}"
    )
    out, cost = await ai.structured(ctx, system=skill_text("writer"), user=user, output=StrategyOut, max_tokens=12000)
    known = {f.pid for f in facts}
    out.hook.fact_ids = _clean_ids(out.hook.fact_ids, known)
    alts = []
    for h in out.alternatives:
        h.fact_ids = _clean_ids(h.fact_ids, known)
        if h.title and h.title.lower() != out.hook.title.lower():
            alts.append(h)
    out.alternatives = alts[:2]
    return out, cost


async def write_email(
    ai: AIClient,
    ctx: CallContext,
    *,
    business: dict[str, Any],
    offer: dict[str, Any],
    sender: dict[str, Any],
    facts: list[PromptFact],
    hook: HookOut,
) -> tuple[EmailOut, float]:
    user = (
        f"{today_line()}\nMode: email\n\n## Business\n{business_block(business)}\n\n"
        f"## Sender's offer\n{offer_block(offer, sender)}\n\n## Facts\n{render_facts(facts)}\n\n"
        f"## Hook to use\n{_hook_text(hook)}"
    )
    out, cost = await ai.structured(ctx, system=skill_text("writer"), user=user, output=EmailOut, max_tokens=12000)
    return _sanitize_email(out, {f.pid for f in facts}), cost


async def rewrite_email(
    ai: AIClient,
    ctx: CallContext,
    *,
    business: dict[str, Any],
    offer: dict[str, Any],
    sender: dict[str, Any],
    facts: list[PromptFact],
    current: EmailOut,
    mode: str,
    hook: HookOut | None = None,
    removed_fact: PromptFact | None = None,
) -> tuple[EmailOut, float]:
    email_text, _ = render_email(current)
    extra = ""
    if mode == "another_hook" and hook is not None:
        extra = f"\n\n## Hook to use\n{_hook_text(hook)}"
    if mode == "remove_fact" and removed_fact is not None:
        extra = f"\n\n## Fact to remove (the user says it is wrong)\n{removed_fact.pid}. {removed_fact.text}"
    user = (
        f"{today_line()}\nMode: rewrite\nChange wanted: {REWRITE_GUIDE.get(mode, mode)}\n\n"
        f"## Business\n{business_block(business)}\n\n## Sender's offer\n{offer_block(offer, sender)}\n\n"
        f"## Facts\n{render_facts(facts)}\n\n## Current email\n{email_text}{extra}"
    )
    out, cost = await ai.structured(ctx, system=skill_text("writer"), user=user, output=EmailOut, max_tokens=12000)
    return _sanitize_email(out, {f.pid for f in facts}), cost

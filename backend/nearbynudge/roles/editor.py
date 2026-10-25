"""Editor: checks facts against quotes and the writing rules; fixes problems (QC1)."""

from __future__ import annotations

from typing import Any

from .. import emailtext
from ..ai.client import AIClient, CallContext
from .outputs import EditorOut, EmailOut
from .skills import PromptFact, business_block, offer_block, render_email, render_facts, skill_text, today_line


async def check(
    ai: AIClient,
    ctx: CallContext,
    *,
    business: dict[str, Any],
    offer: dict[str, Any],
    facts: list[PromptFact],
    email: EmailOut,
    code_issues: list[str],
) -> tuple[EditorOut, list[str], float]:
    """Returns (verdict, sentence ids in order, cost)."""
    email_text, ids = render_email(email)
    issues = "\n".join(f"- {i}" for i in code_issues) or "(none found)"
    paragraphs = [[{"text": s.text} for s in p] for p in email.paragraphs]
    words = emailtext.email_word_count(email.greeting, paragraphs, email.signoff)
    subject_words = emailtext.count_words(email.subject)
    user = (
        f"{today_line()}\n\n## Business\n{business_block(business)}\n\n## Sender's offer\n{offer_block(offer)}\n\n"
        f"## Facts\n{render_facts(facts)}\n\n## Email to check\n{email_text}\n\n"
        f"## Counts from our code (exact; use these, don't recount)\n"
        f"Email: {words} words, counting greeting, body and sign-off (target {emailtext.WORD_MIN}-{emailtext.WORD_MAX}). "
        f"Subject: {subject_words} words (must be under 10).\n\n"
        f"## Problems our code already found\n{issues}"
    )
    out, cost = await ai.structured(ctx, system=skill_text("editor"), user=user, output=EditorOut, max_tokens=12000)
    known = {f.pid for f in facts}
    if out.fixed_email is not None:
        for para in out.fixed_email.paragraphs:
            for s in para:
                s.fact_ids = [i for i in dict.fromkeys(s.fact_ids) if i in known] if s.kind == "claim" else []
    return out, ids, cost

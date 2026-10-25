"""Planner: restates the brief and maps the industry to listing categories (CS2)."""

from __future__ import annotations

from typing import Any

from ..ai.client import AIClient, CallContext
from .outputs import PlanOut
from .skills import skill_text, today_line


async def plan(
    ai: AIClient,
    ctx: CallContext,
    *,
    inp: dict[str, Any],
    location_label: str,
    categories: list[tuple[str, str, int]],
    scope: str,  # "area" (counts near the location) or "all" (area not loaded yet)
) -> tuple[PlanOut, float]:
    where = "near the location" if scope == "area" else "across our loaded data (this area is not loaded yet)"
    cat_lines = "\n".join(f"- {key} | {label} | {count}" for key, label, count in categories[:400])
    user = (
        f"{today_line()}\n\n"
        f"## Campaign inputs\n"
        f"Location: {location_label} (the user typed: {inp['location']})\n"
        f"Radius: {inp['radius_mi']:g} miles\n"
        f"Industry (user's words): {inp['industry']}\n"
        f"Offer: {inp['offer_what']}\n"
        f"Proof point: {inp.get('offer_proof') or '(none)'}\n"
        f"Ask: {inp['offer_cta']}\n"
        f"Tone: {inp.get('tone', 'professional')}\n"
        f"Businesses wanted: {inp['lead_target']}\n\n"
        f"## Listing categories (key | label | businesses {where})\n{cat_lines or '(none)'}"
    )
    out, cost = await ai.structured(ctx, system=skill_text("planner"), user=user, output=PlanOut, max_tokens=8000)
    known = {k for k, _, _ in categories}
    out.include = [k for k in dict.fromkeys(out.include) if k in known]
    if out.question is not None:
        extra = [k for k in dict.fromkeys(out.question.categories) if k in known and k not in out.include]
        out.question = out.question.model_copy(update={"categories": extra}) if extra and out.question.text else None
    return out, cost

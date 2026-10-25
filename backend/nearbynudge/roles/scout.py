"""Scout: ranks listed businesses by fit with a one-line reason (LD3)."""

from __future__ import annotations

from typing import Any

from ..ai.client import AIClient, CallContext
from .outputs import RankItem, RankingOut
from .skills import skill_text, today_line


def _domain(url: str | None) -> str:
    if not url:
        return "no website"
    u = url.split("://", 1)[-1].split("/", 1)[0].lower()
    return u[4:] if u.startswith("www.") else u


async def rank(
    ai: AIClient,
    ctx: CallContext,
    *,
    inp: dict[str, Any],
    location_label: str,
    candidates: list[dict[str, Any]],  # {id, name, category_label, distance_mi, website, locality}
    want: int,
    can_check_without_site: bool,
) -> tuple[list[RankItem], float]:
    lines = []
    for c in candidates:
        lines.append(
            f"- id={c['id']} | {c['name']} | {c.get('category_label') or 'unknown'} | {c.get('distance_mi')} mi | "
            f"{_domain(c.get('website'))} | {c.get('locality') or ''}"
        )
    user = (
        f"{today_line()}\n\n"
        f"## Offer\nWhat the user sells: {inp['offer_what']}\nProof point: {inp.get('offer_proof') or '(none)'}\n"
        f"Ask: {inp['offer_cta']}\n\n"
        f"## Target\nIndustry: {inp['industry']}\nLocation: {location_label}, within {inp['radius_mi']:g} miles\n"
        f"Businesses wanted: {want}\n"
        f"Businesses without a website can be checked: {'yes' if can_check_without_site else 'no'}\n\n"
        f"## Candidates (id | name | category | distance | website | town)\n" + "\n".join(lines)
    )
    out, cost = await ai.structured(ctx, system=skill_text("scout"), user=user, output=RankingOut, max_tokens=12000)
    valid = {c["id"] for c in candidates}
    seen: set[str] = set()
    ranked: list[RankItem] = []
    for item in out.ranking:
        if item.id in valid and item.id not in seen:
            seen.add(item.id)
            ranked.append(item)
    return ranked, cost

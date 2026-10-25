"""Claude API list prices (first-party), as of October 2026."""

from __future__ import annotations

# USD per 1 million tokens. Claude Sonnet 5.5; a server-side fallback runs on Claude Sonnet 5 at the same rates.
PRICES: dict[str, dict[str, float]] = {
    "claude-sonnet-5-5": {"input": 2.00, "cache_write": 2.50, "cache_read": 0.20, "output": 10.00},
    "claude-sonnet-5": {"input": 2.00, "cache_write": 2.50, "cache_read": 0.20, "output": 10.00},
}
DEFAULT_MODEL = "claude-sonnet-5-5"
WEB_SEARCH_PER_REQUEST = 0.01  # $10 per 1,000 searches, plus the result tokens


def cost_usd(
    model: str,
    *,
    input_tokens: int,
    cache_write_tokens: int,
    cache_read_tokens: int,
    output_tokens: int,
    web_searches: int = 0,
) -> float:
    p = PRICES.get(model, PRICES[DEFAULT_MODEL])
    total = (
        input_tokens * p["input"]
        + cache_write_tokens * p["cache_write"]
        + cache_read_tokens * p["cache_read"]
        + output_tokens * p["output"]
    ) / 1_000_000
    total += web_searches * WEB_SEARCH_PER_REQUEST
    return round(total, 8)

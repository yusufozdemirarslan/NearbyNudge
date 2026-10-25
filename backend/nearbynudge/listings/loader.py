"""Metro areas loaded ahead of time (monthly, PRD LD1); anywhere else loads on demand."""

from __future__ import annotations

from collections.abc import Callable

from .store import ListingsStore

# bbox = (xmin, ymin, xmax, ymax) in degrees (west, south, east, north).
METROS: dict[str, dict] = {
    "dc": {
        "label": "Washington, DC metro (DC, Arlington, Alexandria, Fairfax, Bethesda, Silver Spring)",
        "bbox": (-77.40, 38.70, -76.85, 39.10),
    },
    "nyc": {
        "label": "New York City metro (Manhattan, Brooklyn, Queens, the Bronx, Staten Island, "
        "Jersey City, Hoboken, Newark)",
        "bbox": (-74.26, 40.49, -73.70, 40.92),
    },
    "chicago": {
        "label": "Chicago metro (Chicago, Evanston, Skokie, Oak Park, Cicero)",
        "bbox": (-87.95, 41.64, -87.52, 42.07),
    },
    "la": {
        "label": "Los Angeles metro (Los Angeles, Santa Monica, Burbank, Glendale, Pasadena, Long Beach)",
        "bbox": (-118.67, 33.70, -118.10, 34.34),
    },
    "austin": {
        "label": "Austin metro (Austin, Round Rock, Cedar Park, Pflugerville)",
        "bbox": (-97.95, 30.10, -97.55, 30.55),
    },
}


def load_metro(
    store: ListingsStore, key: str, *, progress: Callable[[str], None] | None = None
) -> int:
    """Load (or refresh) one metro from the latest Overture release; returns places written."""
    metro = METROS.get(key)
    if metro is None:
        raise KeyError(f"Unknown metro {key!r}; choose one of {', '.join(sorted(METROS))}")
    xmin, ymin, xmax, ymax = metro["bbox"]
    return store.load_bbox(key, xmin, ymin, xmax, ymax, progress=progress)

"""The reader: a polite web reader plus the code-only site check and contact finder.

    reader = Reader("NearbyNudgeBot/2.0 (+http://localhost:8000/bot)")
    budget = SiteBudget(max_pages=5)
    home = await reader.fetch_home("samplestudio.example", budget)
    pages = [await reader.fetch(link.url, site=home.final_url, budget=budget) for link in chosen_links]
    check = site_check(home, pages)
    contact = find_contact(listing_emails=[], website=home.final_url, pages=[home, *pages], listing_label="...")
"""

from .contact import ContactResult, find_contact
from .fetcher import Reader
from .labels import page_label, pick_links
from .sitecheck import SiteCheckResult, site_check
from .textutil import mask_contacts, quote_in_text, text_fragment_url
from .types import READER_ERRORS, Link, PageResult, SiteBudget
from .urls import normalize_url, registrable_domain

__all__ = [
    "READER_ERRORS",
    "ContactResult",
    "Link",
    "PageResult",
    "Reader",
    "SiteBudget",
    "SiteCheckResult",
    "find_contact",
    "mask_contacts",
    "normalize_url",
    "page_label",
    "pick_links",
    "quote_in_text",
    "registrable_domain",
    "site_check",
    "text_fragment_url",
]

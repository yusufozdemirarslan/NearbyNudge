"""Release check (PRD section 3): the code connects only to the AI API, businesses' own websites and open data.

Backend: every file that can open a network connection must be on the list below, with its purpose,
and web addresses in code (not docstrings or comments) must point to an allowed host. Hosted on Vercel, the app
also reaches its own database and Vercel's job queue: that's the hosting, not an outside service.
Dashboard: the built files may contain web addresses only as documentation strings (license
banners, error-help links, XML namespaces); the browser's Content-Security-Policy
(`default-src 'self'`) blocks any connection beyond our own server at run time.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

from .config import ROOT

URL_RE = re.compile(r"https?://([A-Za-z0-9.\-]+)")
NETWORK_CALL_RE = re.compile(
    r"\b(httpx2?\.(?:AsyncClient|Client|get|post|request|stream)|urllib\.request|requests\.(?:get|post|Session)|"
    r"aiohttp|socket\.create_connection|AsyncAnthropic|Anthropic\(|getaddrinfo|INSTALL httpfs|read_parquet\(|"
    r"urlopen|open_connection|QueueClient)"
)

# Files allowed to open network connections, and why.
NETWORK_FILES = {
    "ai/client.py": "the one outside API: Claude through the official Anthropic SDK",
    "reader/fetcher.py": "the polite reader: each researched business's own public website",
    "listings/store.py": "Overture Maps open data (anonymous S3 download of the monthly listings)",
    "listings/sql.py": "Overture Maps open data (the parquet read used by the loader)",
    "listings/loader.py": "Overture Maps open data (metro loads)",
    "geo/gazetteer.py": "U.S. Census Gazetteer open data download (place and ZIP centers)",
    "serverless.py": "hosting only: Vercel Queues, which runs the background jobs when the app is hosted on Vercel",
}
ALLOWED_HOSTS = {
    "api.anthropic.com", "overturemaps-us-west-2.s3.us-west-2.amazonaws.com", "overturemaps-us-west-2.s3.amazonaws.com",
    "www2.census.gov", "localhost", "127.0.0.1",
    "www.w3.org",  # XML namespace names, never fetched
}
# Strings that look like addresses but are offline inputs (never fetched), per file.
NOT_CONNECTIONS = {
    "reader/contact.py": {"a."},  # probe string for the offline tld parser
    "reader/urls.py": {"www.example.co.uk"},  # self-test of the offline tld parser
}
# Documentation strings that may appear in the built dashboard (never fetched; CSP would block them anyway).
DOC_HOSTS = {
    "www.w3.org", "tailwindcss.com", "base-ui.com", "react.dev", "reactjs.org", "tanstack.com", "localhost", "127.0.0.1",
    "json-schema.org", "redux.js.org", "redux-toolkit.js.org", "bit.ly",  # library error-help text
}


def _code_strings(source: str) -> list[str]:
    """String constants in code, excluding docstrings (comments are not in the AST)."""
    tree = ast.parse(source)
    docstrings: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = getattr(node, "body", [])
            if body and isinstance(body[0], ast.Expr) and isinstance(getattr(body[0], "value", None), ast.Constant):
                docstrings.add(id(body[0].value))
    return [n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str) and id(n) not in docstrings]


def check_connections(root: Path = ROOT) -> list[str]:
    problems: list[str] = []
    pkg = root / "backend" / "nearbynudge"
    for path in sorted(pkg.rglob("*.py")):
        rel = path.relative_to(pkg).as_posix()
        if rel == "checks.py":
            continue
        source = path.read_text(encoding="utf-8", errors="replace")
        code_only = "\n".join(_code_strings(source))
        stripped = re.sub(r"#.*", "", source)
        if NETWORK_CALL_RE.search(stripped) and rel not in NETWORK_FILES:
            problems.append(f"backend/nearbynudge/{rel}: opens network connections but isn't on the approved list")
        for host in {h.lower() for h in URL_RE.findall(code_only)}:
            if host in NOT_CONNECTIONS.get(rel, set()):
                continue
            if host not in ALLOWED_HOSTS and not host.endswith(".example"):
                problems.append(f"backend/nearbynudge/{rel}: code points at {host}")
    dist = root / "frontend" / "dist"
    if dist.is_dir():
        for path in sorted(dist.rglob("*")):
            if path.suffix.lower() not in (".js", ".css", ".html"):
                continue
            for host in {h.lower() for h in URL_RE.findall(path.read_text(encoding="utf-8", errors="replace"))}:
                if host not in DOC_HOSTS:
                    problems.append(f"frontend/dist/{path.relative_to(dist).as_posix()}: contains {host}")
    return problems

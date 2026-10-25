"""Serve the fixture business sites, each on its own port of 127.0.0.1.

    python backend/tests/sites/serve.py --base-port 8701

prints {"studio": "http://127.0.0.1:8701", ...} and serves until Ctrl+C. Tests use
start_sites()/stop_sites() (ephemeral ports) through the `fixture_sites` pytest fixture.
Every site is fictional. Standard library only, so the script also runs outside the venv.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import functools
import json
import os
import signal
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

SITES_DIR = Path(__file__).resolve().parent
SITE_NAMES = ("studio", "family", "nosolicit", "closed", "blocked", "botcheck", "injection")
YEAR_TOKEN = b"%%YEAR%%"  # replaced with the current year when served

_CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".xml": "application/xml",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}

_RUNNING: dict[str, tuple[ThreadingHTTPServer, threading.Thread]] = {}
_LOCK = threading.Lock()


class FixtureHandler(SimpleHTTPRequestHandler):
    """Static files with pretty directory URLs, a fixed content-type map and the year filled in."""

    server_version = "FixtureSite/1.0"
    sys_version = ""
    page_status = 200  # status for HTML pages
    extra_headers: tuple[tuple[str, str], ...] = ()
    verbose = False

    def log_message(self, format, *args):  # noqa: A002 - signature from BaseHTTPRequestHandler
        if self.verbose:
            sys.stderr.write("%s %s\n" % (self.address_string(), format % args))

    def send_head(self):
        parts = urlsplit(self.path)
        path = self.translate_path(parts.path)
        if os.path.isdir(path):
            if not parts.path.endswith("/"):
                self.send_response(301)
                self.send_header("Location", urlunsplit(("", "", parts.path + "/", parts.query, "")))
                self.send_header("Content-Length", "0")
                self.end_headers()
                return None
            path = os.path.join(path, "index.html")
        if not os.path.isfile(path):
            self.send_error(404, "Not Found")
            return None
        suffix = os.path.splitext(path)[1].lower()
        data = Path(path).read_bytes()
        status = 200
        content_type = _CONTENT_TYPES.get(suffix, "application/octet-stream")
        if content_type.startswith("text/html"):
            data = data.replace(YEAR_TOKEN, str(_dt.date.today().year).encode("ascii"))
            status = self.page_status
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        for name, value in self.extra_headers:
            self.send_header(name, value)
        self.end_headers()
        return BytesIO(data)


class BotCheckHandler(FixtureHandler):
    """Answers every page with a Cloudflare-style challenge and HTTP 503, like a real bot wall."""

    server_version = "cloudflare"
    page_status = 503
    extra_headers = (("cf-mitigated", "challenge"), ("Cache-Control", "private, max-age=0, no-store"))


class _Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = sys.platform != "win32"  # on Windows SO_REUSEADDR lets two servers share a port


def start_sites(base_port: int = 0, host: str = "127.0.0.1", names: tuple[str, ...] = SITE_NAMES,
                verbose: bool = False) -> dict[str, str]:
    """Start one threaded server per site and return {name: base_url}.

    base_port=0 picks free ephemeral ports; otherwise site i listens on base_port + i
    (studio 8701, family 8702, nosolicit 8703, closed 8704, blocked 8705, botcheck 8706, injection 8707).
    """
    urls: dict[str, str] = {}
    try:
        for index, name in enumerate(names):
            directory = SITES_DIR / name
            if not directory.is_dir():
                raise FileNotFoundError(f"no fixture site named {name!r} in {SITES_DIR}")
            handler_class = BotCheckHandler if name == "botcheck" else FixtureHandler
            handler = functools.partial(type("Handler", (handler_class,), {"verbose": verbose}), directory=str(directory))
            server = _Server((host, base_port + index if base_port else 0), handler)
            thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.1},
                                      name=f"fixture-site-{name}", daemon=True)
            thread.start()
            url = f"http://{host}:{server.server_address[1]}"
            with _LOCK:
                _RUNNING[url] = (server, thread)
            urls[name] = url
    except Exception:
        stop_sites(urls)
        raise
    return urls


def stop_sites(urls: dict[str, str] | None = None) -> None:
    """Stop the given sites (a start_sites() result), or every running fixture site."""
    with _LOCK:
        targets = list(urls.values()) if urls is not None else list(_RUNNING)
        entries = [_RUNNING.pop(url) for url in targets if url in _RUNNING]
    for server, thread in entries:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Serve the NearbyNudge fixture business sites.")
    parser.add_argument("--base-port", type=int, default=8701, help="first port (0 = pick free ports)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--verbose", action="store_true", help="log every request to stderr")
    args = parser.parse_args(argv)

    def interrupt(signum, frame):  # SIGTERM / CTRL_BREAK stop as cleanly as Ctrl+C
        raise KeyboardInterrupt

    for name in ("SIGTERM", "SIGBREAK"):
        if hasattr(signal, name):
            signal.signal(getattr(signal, name), interrupt)
    urls = start_sites(args.base_port, args.host, verbose=args.verbose)
    print(json.dumps(urls), flush=True)
    try:
        while True:
            time.sleep(0.5)  # short sleeps keep Ctrl+C responsive on Windows
    except KeyboardInterrupt:
        pass
    finally:
        stop_sites(urls)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

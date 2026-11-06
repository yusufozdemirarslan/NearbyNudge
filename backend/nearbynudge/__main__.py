"""Command line: python -m nearbynudge <command>."""

from __future__ import annotations

import argparse
import logging
import sys


def _settings():
    from .config import get_settings

    return get_settings()


def cmd_serve(args: argparse.Namespace) -> None:
    s = _settings()
    s.validate_for_start()
    if args.reload:
        import uvicorn

        from .netserve import SHUTDOWN_GRACE_S

        uvicorn.run("nearbynudge.app:create_app", factory=True, host=args.host, port=args.port, reload=True,
                    log_level="info", proxy_headers=False, timeout_graceful_shutdown=SHUTDOWN_GRACE_S)
        return
    from .netserve import serve

    serve("nearbynudge.app:create_app", args.port, host=args.host, factory=True)


def cmd_setup_data(args: argparse.Namespace) -> None:
    from .geo import Gazetteer
    from .listings import ListingsStore, loader

    s = _settings()
    s.data_dir.mkdir(parents=True, exist_ok=True)
    print("Downloading Census location files (free, public domain)...")
    Gazetteer.download(s.data_dir)
    store = ListingsStore(s.listings_file)
    try:
        for metro in args.metro:
            print(f"Loading Overture Maps places for {metro} (free open data; this can take a few minutes)...")
            n = loader.load_metro(store, metro, progress=lambda m: print("  " + m))
            print(f"  {n} places loaded")
        print("Store:", store.stats())
    finally:
        store.close()


def cmd_load_listings(args: argparse.Namespace) -> None:
    from .listings import ListingsStore, loader

    s = _settings()
    store = ListingsStore(s.listings_file)
    try:
        if args.bbox:
            xmin, ymin, xmax, ymax = (float(x) for x in args.bbox.split(","))
            n = store.load_bbox(args.name or "custom", xmin, ymin, xmax, ymax, progress=print)
        else:
            n = loader.load_metro(store, args.metro, progress=print)
        print(f"{n} places loaded")
    finally:
        store.close()


def cmd_purge(_: argparse.Namespace) -> None:
    from .app import purge
    from .db import Database

    s = _settings()
    db = Database(s.database_url)
    db.create_all()
    print(purge(db))


def cmd_status(_: argparse.Namespace) -> None:
    s = _settings()
    key = s.anthropic_api_key.strip()
    print(f"AI: {s.ai_model} at effort {s.ai_effort}; key {'set (' + key[:7] + '…)' if key else 'NOT SET'}")
    print(f"Data folder: {s.data_dir} (exists: {s.data_dir.exists()})")
    print(f"Listings: {s.listings_file} (exists: {s.listings_file.exists()})")
    print(f"Location files: {(s.data_dir / 'gazetteer').exists()}")
    print(f"Dashboard build: {(s.frontend_dist / 'index.html').exists()}")
    if s.login_enabled:
        print(f"Address: {s.public_url} (sign-in on, as {s.login_email.strip().lower()})")
    else:
        print(f"Address: {s.public_url} (sign-in off: everyone who opens it uses the one workspace)")


def cmd_hash_password(_: argparse.Namespace) -> None:
    """Reads a password from stdin (never from the command line, where it would stay in the shell history) and
    prints the value for NN_LOGIN_PASSWORD_HASH."""
    from .auth import hash_password

    password = sys.stdin.readline().rstrip("\r\n")
    if len(password) < 10:
        print("Use a password of at least 10 characters.", file=sys.stderr)
        sys.exit(1)
    print(hash_password(password))


def cmd_check_connections(_: argparse.Namespace) -> None:
    from .checks import check_connections

    problems = check_connections()
    for p in problems:
        print(p)
    if problems:
        sys.exit(1)
    print("OK: the code connects only to the Anthropic API, businesses' own websites and the open data downloads.")


def main(argv: list[str] | None = None) -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    p = argparse.ArgumentParser(prog="nearbynudge")
    sub = p.add_subparsers(dest="cmd", required=True)
    sp = sub.add_parser("serve", help="run the web app")
    sp.add_argument("--host", default="127.0.0.1")
    sp.add_argument("--port", type=int, default=8000)
    sp.add_argument("--reload", action="store_true")
    sp.set_defaults(fn=cmd_serve)
    sp = sub.add_parser("setup-data", help="download location files and load business listings")
    sp.add_argument("--metro", nargs="+", default=["dc"])
    sp.set_defaults(fn=cmd_setup_data)
    sp = sub.add_parser("load-listings", help="load Overture places for a metro or a bounding box")
    sp.add_argument("--metro", default="dc")
    sp.add_argument("--bbox", help="xmin,ymin,xmax,ymax")
    sp.add_argument("--name")
    sp.set_defaults(fn=cmd_load_listings)
    sub.add_parser("purge", help="apply retention rules now").set_defaults(fn=cmd_purge)
    sub.add_parser("status", help="show configuration").set_defaults(fn=cmd_status)
    sub.add_parser("hash-password", help="read a password from stdin and print its NN_LOGIN_PASSWORD_HASH").set_defaults(
        fn=cmd_hash_password)
    sub.add_parser("check-connections", help="release check: outside connections in the code").set_defaults(fn=cmd_check_connections)
    args = p.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main()

"""Vercel's build step (pyproject.toml: [tool.vercel.scripts] build). Runs on Vercel after the Python packages
are installed, in the project folder, and prepares what the deployment carries:

1. The dashboard: `npm ci` and `npm run build` in frontend/ (frontend/dist), then frontend/node_modules is removed
   so it isn't bundled into the functions.
2. The data in data/: the Census location files and the DC-area business listings from Overture Maps (the same
   open data `python -m nearbynudge setup-data` loads on this computer), with DuckDB's httpfs extension, which the
   functions can't install into their home folder.
3. Packing: the listings are copied without the free blocks the load's rewrites leave (about a third of the file
   is data), and the listings and the extension are compressed with zstd. That keeps the functions small enough
   for Vercel to bundle all their packages; each server instance unpacks them into its temporary folder at start
   (serverless.listings_copy and duckdb_extension_dir).

Run it on this computer only to try the build: it replaces frontend/dist and writes into data/.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tarfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))


def run(cmd: list[str], cwd: Path) -> None:
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, cwd=cwd, check=True)


def build_dashboard() -> None:
    frontend = ROOT / "frontend"
    npm = shutil.which("npm")
    if npm is None:
        raise SystemExit("npm isn't available, so the dashboard can't be built")
    run([npm, "ci", "--include=dev", "--no-audit", "--no-fund"], frontend)
    run([npm, "run", "build"], frontend)
    if not (frontend / "dist" / "index.html").is_file():
        raise SystemExit("the dashboard build made no frontend/dist/index.html")
    shutil.rmtree(frontend / "node_modules")


def load_data() -> None:
    from nearbynudge.geo import Gazetteer
    from nearbynudge.listings import ListingsStore, loader

    data = ROOT / "data"
    data.mkdir(exist_ok=True)
    started = time.monotonic()
    print("Downloading the Census location files", flush=True)
    Gazetteer.download(data)
    store = ListingsStore(data / "listings.duckdb", extension_dir=data / "duckdb_extensions")
    try:
        print("Loading DC-area business listings from Overture Maps", flush=True)
        n = loader.load_metro(store, "dc", progress=lambda message: print("  " + message, flush=True))
        print(f"{n:,} places loaded; {store.stats()}", flush=True)
    finally:
        store.close()
    Gazetteer.open(data)  # fails the build if the location files can't be read
    print(f"Data ready in {time.monotonic() - started:.0f} s", flush=True)


def pack_data() -> None:
    import duckdb
    from compression import zstd

    data = ROOT / "data"
    raw = data / "listings.duckdb"
    compact = data / "listings.compact.duckdb"
    con = duckdb.connect()
    try:
        con.execute(f"ATTACH '{raw.as_posix()}' AS src (READ_ONLY)")
        con.execute(f"ATTACH '{compact.as_posix()}' AS dst")
        con.execute("COPY FROM DATABASE src TO dst")
    finally:
        con.close()
    packed = data / "listings.duckdb.zst"
    with compact.open("rb") as fin, zstd.open(packed, "wb", level=9) as fout:
        shutil.copyfileobj(fin, fout, 4 << 20)
    print(f"Listings: {raw.stat().st_size / 1e6:.0f} MB, compacted {compact.stat().st_size / 1e6:.0f} MB, "
          f"packed {packed.stat().st_size / 1e6:.0f} MB", flush=True)
    raw.unlink()
    compact.unlink()
    extensions = data / "duckdb_extensions"
    if extensions.is_dir():
        with tarfile.open(data / "duckdb_extensions.tar.zst", "w:zst") as tar:
            tar.add(extensions, arcname="duckdb_extensions")
        shutil.rmtree(extensions)
        print(f"DuckDB extensions packed: {(data / 'duckdb_extensions.tar.zst').stat().st_size / 1e6:.0f} MB", flush=True)


if __name__ == "__main__":
    build_dashboard()
    load_data()
    pack_data()

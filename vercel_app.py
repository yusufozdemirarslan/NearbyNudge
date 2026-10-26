"""Vercel's entry point for the web app (pyproject.toml: [tool.vercel] entrypoint). The app lives in backend/nearbynudge."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "backend"))

from nearbynudge.app import create_app  # noqa: E402

app = create_app()

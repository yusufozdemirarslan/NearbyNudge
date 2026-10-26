"""Vercel's entry point for the background jobs (pyproject.toml: [[tool.vercel.subscribers]]).

Importing it registers the one Vercel Queues subscriber, nearbynudge.queue_worker.run_job.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "backend"))

from nearbynudge.queue_worker import run_job  # noqa: E402

__all__ = ["run_job"]

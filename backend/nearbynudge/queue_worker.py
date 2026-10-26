"""Hosted background work: Vercel runs this subscriber once for each job message (pyproject: [[tool.vercel.subscribers]]).

Vercel imports this module when it builds the deployment, to read the subscription, so it stays light: the app
itself loads on the first message.
"""

from __future__ import annotations

from typing import Any

from vercel.queue import Message, subscribe

TOPIC = "nearbynudge-jobs"  # serverless.TOPIC


@subscribe(topic=TOPIC, max_concurrency=4, max_attempts=6, retry_after=30)
async def run_job(message: Message[dict[str, Any]]) -> None:
    from .serverless import handle_job_message

    await handle_job_message(message.payload)

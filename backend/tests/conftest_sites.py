"""Pytest plugin with the fixture business sites (load via pytest_plugins = ["tests.conftest_sites"])."""

from __future__ import annotations

import pytest

from tests.sites.serve import start_sites, stop_sites


@pytest.fixture(scope="session")
def fixture_sites() -> dict[str, str]:
    """{name: "http://127.0.0.1:<port>"} for studio, family, nosolicit, closed, blocked, botcheck, injection."""
    urls = start_sites(base_port=0)
    try:
        yield urls
    finally:
        stop_sites(urls)

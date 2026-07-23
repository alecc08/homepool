"""Unit tests for the Homepool API client's error classification.

Run with (from this directory): python -m pytest test_api.py -v
Or from the repo root: python -m pytest --rootdir=custom_components/homepool/tests \
  custom_components/homepool/tests/test_api.py -v

No pytest-homeassistant-custom-component harness needed — api.py has zero
homeassistant.* imports, so it's tested here with plain asyncio + unittest.mock.
Lives in its own `tests/` directory (no __init__.py) rather than alongside api.py,
and needs an explicit rootdir when invoked from the repo root: `..`'s __init__.py
imports homeassistant.*/voluptuous at module level, and pytest's package-aware
collection would import it while walking from the repo root down to this file
unless rootdir is pinned here.
"""
from __future__ import annotations

import asyncio
import socket
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from aiohttp import ClientConnectorError, ClientError

sys.path.insert(0, str(Path(__file__).parent.parent))

from api import (  # noqa: E402
    HomepoolApiError,
    HomepoolAuthError,
    HomepoolCannotResolveHostError,
    HomepoolClient,
    HomepoolConnectionRefusedError,
    HomepoolTimeoutError,
    build_candidate_base_urls,
)


def _make_client(request_side_effect) -> HomepoolClient:
    session = MagicMock()
    session.request = AsyncMock(side_effect=request_side_effect)
    return HomepoolClient(session, "https://example.test", "key")


def _connector_error(os_error: OSError) -> ClientConnectorError:
    conn_key = MagicMock()
    return ClientConnectorError(conn_key, os_error)


def test_timeout_raises_homepool_timeout_error() -> None:
    client = _make_client(TimeoutError())
    with pytest.raises(HomepoolTimeoutError):
        asyncio.run(client._get("/v1/installations"))


def test_dns_failure_raises_cannot_resolve_host_error() -> None:
    client = _make_client(_connector_error(socket.gaierror("Name or service not known")))
    with pytest.raises(HomepoolCannotResolveHostError):
        asyncio.run(client._get("/v1/installations"))


def test_connection_refused_raises_connection_refused_error() -> None:
    client = _make_client(_connector_error(ConnectionRefusedError()))
    with pytest.raises(HomepoolConnectionRefusedError):
        asyncio.run(client._get("/v1/installations"))


def test_generic_client_error_raises_homepool_api_error() -> None:
    client = _make_client(ClientError("boom"))
    with pytest.raises(HomepoolApiError):
        asyncio.run(client._get("/v1/installations"))


def test_401_response_raises_homepool_auth_error() -> None:
    resp = MagicMock()
    resp.status = 401
    session = MagicMock()
    session.request = AsyncMock(return_value=resp)
    client = HomepoolClient(session, "https://example.test", "key")
    with pytest.raises(HomepoolAuthError):
        asyncio.run(client._get("/v1/installations"))


def test_candidate_urls_bare_host_port_fans_out_scheme_and_path() -> None:
    assert build_candidate_base_urls("192.168.1.5:8090") == [
        "https://192.168.1.5:8090",
        "https://192.168.1.5:8090/api",
        "http://192.168.1.5:8090",
        "http://192.168.1.5:8090/api",
    ]


def test_candidate_urls_explicit_scheme_does_not_fan_out_scheme() -> None:
    assert build_candidate_base_urls("http://192.168.1.5:8090") == [
        "http://192.168.1.5:8090",
        "http://192.168.1.5:8090/api",
    ]


def test_candidate_urls_already_ending_in_api_has_no_duplicate() -> None:
    assert build_candidate_base_urls("https://homepool.example.com/api") == [
        "https://homepool.example.com/api",
    ]


def test_candidate_urls_strips_trailing_slash_and_whitespace() -> None:
    assert build_candidate_base_urls("  https://homepool.example.com/api/  ") == [
        "https://homepool.example.com/api",
    ]

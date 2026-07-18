"""Thin async client for the Pooly public API (/v1/*)."""
from __future__ import annotations

import asyncio

from aiohttp import ClientError, ClientSession

TIMEOUT_SECONDS = 15


class PoolyApiError(Exception):
    """Raised when a Pooly API call fails."""


class PoolyAuthError(PoolyApiError):
    """Raised when the API key is rejected."""


class PoolyClient:
    def __init__(self, session: ClientSession, base_url: str, api_key: str) -> None:
        self._session = session
        self._base_url = base_url.rstrip("/")
        self._headers = {"Authorization": f"Bearer {api_key}"}

    async def _get(self, path: str, params: dict | None = None) -> object:
        try:
            async with asyncio.timeout(TIMEOUT_SECONDS):
                resp = await self._session.get(
                    f"{self._base_url}{path}", headers=self._headers, params=params
                )
                if resp.status == 401:
                    raise PoolyAuthError("Invalid API key")
                resp.raise_for_status()
                return await resp.json()
        except (ClientError, TimeoutError) as err:
            raise PoolyApiError(str(err)) from err

    async def list_installations(self) -> list[dict]:
        return await self._get("/v1/installations")

    async def get_current(self, installation_id: int) -> dict:
        return await self._get("/v1/current", params={"installation_id": installation_id})

    async def get_todo(self, installation_id: int) -> dict:
        return await self._get("/v1/todo", params={"installation_id": installation_id})

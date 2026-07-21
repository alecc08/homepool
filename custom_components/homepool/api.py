"""Thin async client for the Homepool public API (/v1/*)."""
from __future__ import annotations

import asyncio

from aiohttp import ClientError, ClientSession

TIMEOUT_SECONDS = 15


class HomepoolApiError(Exception):
    """Raised when a Homepool API call fails."""


class HomepoolAuthError(HomepoolApiError):
    """Raised when the API key is rejected."""


class HomepoolClient:
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
                    raise HomepoolAuthError("Invalid API key")
                resp.raise_for_status()
                return await resp.json()
        except (ClientError, TimeoutError) as err:
            raise HomepoolApiError(str(err)) from err

    async def _post(self, path: str, json: dict) -> object:
        try:
            async with asyncio.timeout(TIMEOUT_SECONDS):
                resp = await self._session.post(
                    f"{self._base_url}{path}", headers=self._headers, json=json
                )
                if resp.status == 401:
                    raise HomepoolAuthError("Invalid API key")
                resp.raise_for_status()
                return await resp.json()
        except (ClientError, TimeoutError) as err:
            raise HomepoolApiError(str(err)) from err

    async def list_installations(self) -> list[dict]:
        return await self._get("/v1/installations")

    async def get_current(self, installation_id: int) -> dict:
        return await self._get("/v1/current", params={"installation_id": installation_id})

    async def get_todo(self, installation_id: int) -> list[dict]:
        # As of configurable maintenance, /v1/todo returns a list of task
        # objects ({id, key, builtin_key, label, icon, interval_days,
        # days_until_due, last_date}) rather than the old fixed two-key object.
        return await self._get("/v1/todo", params={"installation_id": installation_id})

    async def get_history(
        self,
        installation_id: int,
        *,
        limit: int = 100,
        type: str = "all",
        from_date: str | None = None,
    ) -> list[dict]:
        params: dict = {"installation_id": installation_id, "limit": limit, "type": type}
        if from_date is not None:
            params["from_date"] = from_date
        return await self._get("/v1/history", params=params)

    async def create_maintenance(
        self,
        installation_id: int,
        action_type: str,
        notes: str | None = None,
        date: str | None = None,
    ) -> dict:
        payload = {"installation_id": installation_id, "action_type": action_type}
        if notes is not None:
            payload["notes"] = notes
        if date is not None:
            payload["date"] = date
        return await self._post("/v1/maintenance", payload)

    async def complete_task(self, installation_id: int, task_id: int) -> dict:
        # "Mark done" for a configurable maintenance task: logs a completion for
        # the task's primary action_type server-side, so custom tasks work
        # without the caller knowing the action_type string.
        return await self._post(
            "/v1/maintenance/complete",
            {"installation_id": installation_id, "task_id": task_id},
        )

    async def create_measurement(self, installation_id: int, **fields: object) -> dict:
        payload = {"installation_id": installation_id, **{k: v for k, v in fields.items() if v is not None}}
        return await self._post("/v1/measurements", payload)

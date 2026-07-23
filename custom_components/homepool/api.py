"""Thin async client for the Homepool public API (/v1/*)."""
from __future__ import annotations

import asyncio
import socket

from aiohttp import ClientConnectorError, ClientError, ClientSession

TIMEOUT_SECONDS = 15


class HomepoolApiError(Exception):
    """Raised when a Homepool API call fails."""


class HomepoolAuthError(HomepoolApiError):
    """Raised when the API key is rejected."""


class HomepoolTimeoutError(HomepoolApiError):
    """Raised when a request to the Homepool server times out."""


class HomepoolCannotResolveHostError(HomepoolApiError):
    """Raised when the Homepool server's hostname cannot be resolved."""


class HomepoolConnectionRefusedError(HomepoolApiError):
    """Raised when the Homepool server refuses the connection."""


def build_candidate_base_urls(raw_url: str) -> list[str]:
    """Build an ordered list of base URLs to try for a user-entered server URL.

    Tries the URL as typed first. Only fans out across both http/https schemes
    when the user didn't specify one (an explicit scheme is respected as-is).
    For each scheme candidate, also tries appending "/api" if not already present.
    """
    raw = raw_url.strip().rstrip("/")
    has_scheme = raw.startswith("http://") or raw.startswith("https://")
    bases = [raw] if has_scheme else [f"https://{raw}", f"http://{raw}"]
    candidates: list[str] = []
    for base in bases:
        candidates.append(base)
        if not base.endswith("/api"):
            candidates.append(f"{base}/api")
    seen: set[str] = set()
    ordered: list[str] = []
    for candidate in candidates:
        if candidate not in seen:
            seen.add(candidate)
            ordered.append(candidate)
    return ordered


class HomepoolClient:
    def __init__(self, session: ClientSession, base_url: str, api_key: str) -> None:
        self._session = session
        self._base_url = base_url.rstrip("/")
        self._headers = {"Authorization": f"Bearer {api_key}"}

    async def _request(self, method: str, path: str, **kwargs: object) -> object:
        try:
            async with asyncio.timeout(TIMEOUT_SECONDS):
                resp = await self._session.request(
                    method, f"{self._base_url}{path}", headers=self._headers, **kwargs
                )
                if resp.status == 401:
                    raise HomepoolAuthError("Invalid API key")
                resp.raise_for_status()
                return await resp.json()
        except TimeoutError as err:
            raise HomepoolTimeoutError(str(err)) from err
        except ClientConnectorError as err:
            os_error = err.os_error
            if isinstance(os_error, socket.gaierror):
                raise HomepoolCannotResolveHostError(str(err)) from err
            if isinstance(os_error, ConnectionRefusedError):
                raise HomepoolConnectionRefusedError(str(err)) from err
            raise HomepoolApiError(str(err)) from err
        except ClientError as err:
            raise HomepoolApiError(str(err)) from err

    async def _get(self, path: str, params: dict | None = None) -> object:
        return await self._request("GET", path, params=params)

    async def _post(self, path: str, json: dict) -> object:
        return await self._request("POST", path, json=json)

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

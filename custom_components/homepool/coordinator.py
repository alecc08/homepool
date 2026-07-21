"""DataUpdateCoordinator for Homepool."""
from __future__ import annotations

import logging
from datetime import timedelta

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import HomepoolApiError, HomepoolClient
from .const import DEFAULT_SCAN_INTERVAL_MINUTES, DOMAIN, HISTORY_LIMIT

_LOGGER = logging.getLogger(__name__)


class HomepoolDataUpdateCoordinator(DataUpdateCoordinator[dict[int, dict]]):
    """Polls /v1/installations then /v1/current for each installation."""

    def __init__(self, hass: HomeAssistant, base_url: str, api_key: str) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(minutes=DEFAULT_SCAN_INTERVAL_MINUTES),
        )
        self.client = HomepoolClient(async_get_clientsession(hass), base_url, api_key)

    async def _async_update_data(self) -> dict[int, dict]:
        try:
            installations = await self.client.list_installations()
            data: dict[int, dict] = {}
            for installation in installations:
                fields = await self.client.get_current(installation["id"])
                # /v1/todo is a list of task objects; key it by each task's
                # stable `key` (builtin_key or custom_<id>) so the sensor and
                # button entities can look their task up in O(1) and keep a
                # stable unique_id across renames.
                todo_list = await self.client.get_todo(installation["id"])
                todo = {task["key"]: task for task in todo_list}
                # History is a nice-to-have for the frontend table card; a
                # failure here must not sink the whole update (which the params
                # and todo sensors depend on), so degrade to an empty list.
                try:
                    raw = await self.client.get_history(
                        installation["id"], limit=HISTORY_LIMIT
                    )
                    # Strip null fields (every non-measurement row otherwise
                    # carries nine null param columns) to keep the sensor's
                    # `entries` attribute small.
                    history = [
                        {k: v for k, v in entry.items() if v is not None}
                        for entry in raw
                    ]
                except HomepoolApiError as err:
                    _LOGGER.debug("history fetch failed for %s: %s", installation["id"], err)
                    history = []
                data[installation["id"]] = {
                    "name": installation["name"],
                    "type": installation["type"],
                    "sanitizer": installation.get("sanitizer"),
                    "fields": fields,
                    "todo": todo,
                    "history": history,
                }
            return data
        except HomepoolApiError as err:
            raise UpdateFailed(str(err)) from err

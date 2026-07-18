"""DataUpdateCoordinator for Pooly."""
from __future__ import annotations

import logging
from datetime import timedelta

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import PoolyApiError, PoolyClient
from .const import DEFAULT_SCAN_INTERVAL_MINUTES, DOMAIN

_LOGGER = logging.getLogger(__name__)


class PoolyDataUpdateCoordinator(DataUpdateCoordinator[dict[int, dict]]):
    """Polls /v1/installations then /v1/current for each installation."""

    def __init__(self, hass: HomeAssistant, base_url: str, api_key: str) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(minutes=DEFAULT_SCAN_INTERVAL_MINUTES),
        )
        self.client = PoolyClient(async_get_clientsession(hass), base_url, api_key)

    async def _async_update_data(self) -> dict[int, dict]:
        try:
            installations = await self.client.list_installations()
            data: dict[int, dict] = {}
            for installation in installations:
                fields = await self.client.get_current(installation["id"])
                todo = await self.client.get_todo(installation["id"])
                data[installation["id"]] = {
                    "name": installation["name"],
                    "type": installation["type"],
                    "fields": fields,
                    "todo": todo,
                }
            return data
        except PoolyApiError as err:
            raise UpdateFailed(str(err)) from err

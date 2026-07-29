"""Optional write-back of external sensor readings into homepool.

When a user maps a homepool reading to one of their own entities (see
external.py) they can additionally opt in to having Home Assistant record those
readings as real homepool measurements, so the web app's history, trends and
dosing advice see the smart probe's data too.

Deliberately conservative, because every push creates a row in the user's
history:

* opt-in per installation, off by default;
* polled on a fixed interval (default 60 min) rather than on every state
  change, so a chatty probe can't spam the server;
* readings are rounded to the precision homepool records, and a snapshot is
  only sent when at least one reading actually moved since the last push;
* one measurement per interval carrying every overridden reading, matching how
  a human logs a full test — not one row per field.

Uses the existing POST /v1/measurements route through api.py; no new server
endpoint was needed.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers.event import async_track_time_interval

from .api import HomepoolApiError
from .coordinator import HomepoolDataUpdateCoordinator
from .external import (
    PUSH_BACK_NOTE,
    external_value,
    rounded_readings,
    should_push,
)

_LOGGER = logging.getLogger(__name__)


class HomepoolPushBack:
    """Periodically logs one installation's external readings to homepool."""

    def __init__(
        self,
        hass: HomeAssistant,
        coordinator: HomepoolDataUpdateCoordinator,
        installation_id: int,
        sources: dict[str, str],
        interval_minutes: int,
    ) -> None:
        self.hass = hass
        self.coordinator = coordinator
        self.installation_id = installation_id
        self.sources = sources
        self.interval = timedelta(minutes=interval_minutes)
        self._last_pushed: dict[str, float] = {}

    @callback
    def async_start(self) -> CALLBACK_TYPE:
        """Starts the interval timer; returns the unsubscribe callback."""
        return async_track_time_interval(self.hass, self._async_tick, self.interval)

    def collect(self) -> dict[str, float]:
        """Current usable readings from the mapped entities, in homepool units."""
        installation = self.coordinator.data.get(self.installation_id) or {}
        fields = installation.get("fields") or {}
        readings: dict[str, float] = {}
        for field, entity_id in self.sources.items():
            state = self.hass.states.get(entity_id)
            if state is None:
                continue
            homepool_value = fields.get(field) or {}
            value = external_value(
                state.state,
                state.attributes.get("unit_of_measurement"),
                homepool_value.get("unit"),
            )
            if value is not None:
                readings[field] = value
        return rounded_readings(readings)

    async def _async_tick(self, now: datetime | None = None) -> None:
        readings = self.collect()
        if not should_push(readings, self._last_pushed):
            return
        try:
            await self.coordinator.client.create_measurement(
                self.installation_id, notes=PUSH_BACK_NOTE, **readings
            )
        except HomepoolApiError as err:
            # A read-only share gets a 403 here; log once per interval and keep
            # the entities working rather than tearing the entry down.
            _LOGGER.warning(
                "homepool: could not push external readings for installation %s: %s",
                self.installation_id,
                err,
            )
            return
        self._last_pushed = readings
        await self.coordinator.async_request_refresh()

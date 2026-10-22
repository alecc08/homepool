"""Switch platform for homepool: the season switch.

One "Open" switch per installation, mirroring the API's `is_open`. Switching it
off winterizes the pool: maintenance is paused and the chemistry alerts and
dosing advice go quiet, while history stays readable and loggable — including
the closing and opening chores themselves. Switching it back on resumes the
countdowns exactly where they stopped, because closing stores nothing.

Season state is owner-only server-side, so a switch belonging to an
installation someone shared with a viewer reads correctly but refuses to flip.
"""
from __future__ import annotations

from homeassistant.components.switch import ENTITY_ID_FORMAT, SwitchEntity
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity import async_generate_entity_id
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from . import HomepoolConfigEntry
from .api import HomepoolApiError
from .const import DOMAIN
from .coordinator import HomepoolDataUpdateCoordinator

ICON_OPEN = "mdi:pool"
ICON_CLOSED = "mdi:snowflake"


async def async_setup_entry(
    hass: HomeAssistant,
    entry: HomepoolConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator = entry.runtime_data
    # One per installation, like the history and treatments sensors: the season
    # state belongs to the pool itself, so it exists even for a pool that has no
    # maintenance tasks at all.
    async_add_entities(
        HomepoolOpenSwitch(coordinator, entry.entry_id, installation_id)
        for installation_id in coordinator.data
    )


class HomepoolOpenSwitch(CoordinatorEntity[HomepoolDataUpdateCoordinator], SwitchEntity):
    """Open (in season) / closed (winterized) for a single installation."""

    _attr_has_entity_name = True
    _attr_name = "Open"
    _attr_translation_key = "pool_open"

    def __init__(
        self,
        coordinator: HomepoolDataUpdateCoordinator,
        entry_id: str,
        installation_id: int,
    ) -> None:
        super().__init__(coordinator)
        self._installation_id = installation_id
        self._attr_unique_id = f"{entry_id}_{installation_id}_open"

        # Deterministic, area-free entity-id (see HomepoolSensor) so the switch
        # shares the installation's prefix and the card finds it by suffix.
        name = coordinator.data[installation_id]["name"]
        self.entity_id = async_generate_entity_id(
            ENTITY_ID_FORMAT, f"{name} Open", hass=coordinator.hass
        )

    @property
    def _installation(self) -> dict | None:
        return self.coordinator.data.get(self._installation_id)

    @property
    def device_info(self) -> DeviceInfo | None:
        installation = self._installation
        if not installation:
            return None
        return DeviceInfo(
            identifiers={(DOMAIN, str(self._installation_id))},
            name=installation["name"],
            manufacturer="homepool",
            model=installation["type"].capitalize(),
        )

    @property
    def available(self) -> bool:
        return super().available and self._installation is not None

    @property
    def icon(self) -> str:
        return ICON_OPEN if self.is_on else ICON_CLOSED

    @property
    def is_on(self) -> bool:
        installation = self._installation
        # "Open" is the safe reading for a server that has no season switch, and
        # for an installation that just vanished from the last poll.
        return installation.get("is_open", True) if installation else True

    @property
    def extra_state_attributes(self) -> dict | None:
        installation = self._installation
        if not installation:
            return None
        # The reason a maintenance sensor's "days until due" is blank: automations
        # and dashboards get the season state without parsing entity ids.
        return {"closed_for_season": not self.is_on}

    async def _async_set_open(self, is_open: bool) -> None:
        try:
            await self.coordinator.client.set_installation_open(
                self._installation_id, is_open
            )
        except HomepoolApiError as err:
            raise HomeAssistantError(str(err)) from err
        # Optimistic writes are not the style here: the state the user sees is
        # whatever the server accepted, so re-read it immediately (same as the
        # "mark done" buttons).
        await self.coordinator.async_request_refresh()

    async def async_turn_on(self, **kwargs: object) -> None:
        await self._async_set_open(True)

    async def async_turn_off(self, **kwargs: object) -> None:
        await self._async_set_open(False)

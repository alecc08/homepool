"""Button platform for homepool maintenance quick-actions.

One "mark done" button per configurable maintenance task, driven by the API's
/v1/todo task list. Pressing a button completes the task server-side (logging
its primary action_type), so custom tasks work without the integration knowing
the action_type string.
"""
from __future__ import annotations

from homeassistant.components.button import ENTITY_ID_FORMAT, ButtonEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity import async_generate_entity_id
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from . import HomepoolConfigEntry
from .const import DOMAIN
from .coordinator import HomepoolDataUpdateCoordinator

DEFAULT_BUTTON_ICON = "mdi:check-circle-outline"


async def async_setup_entry(
    hass: HomeAssistant,
    entry: HomepoolConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator = entry.runtime_data

    # Buttons are data-driven like the todo sensors: one per configurable task.
    # A coordinator listener adds buttons for tasks first seen after setup (HA
    # only calls async_setup_entry once), so newly-added/enabled tasks appear
    # without an integration reload.
    known_tasks: set[tuple[int, str]] = set()

    def _add_task_buttons() -> None:
        new: list[ButtonEntity] = []
        for installation_id, installation in coordinator.data.items():
            for task_key in installation.get("todo", {}):
                marker = (installation_id, task_key)
                if marker in known_tasks:
                    continue
                known_tasks.add(marker)
                new.append(
                    HomepoolMaintenanceButton(coordinator, entry.entry_id, installation_id, task_key)
                )
        if new:
            async_add_entities(new)

    _add_task_buttons()
    entry.async_on_unload(coordinator.async_add_listener(_add_task_buttons))


class HomepoolMaintenanceButton(CoordinatorEntity[HomepoolDataUpdateCoordinator], ButtonEntity):
    """Marks a configurable maintenance task done for a single installation."""

    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: HomepoolDataUpdateCoordinator,
        entry_id: str,
        installation_id: int,
        task_key: str,
    ) -> None:
        super().__init__(coordinator)
        self._installation_id = installation_id
        self._task_key = task_key
        self._attr_unique_id = f"{entry_id}_{installation_id}_button_{task_key}"

        # Deterministic, area-free entity-id (see issue #42) so buttons share the
        # installation's prefix and the card's sensor->button matching finds them
        # (e.g. button.home_log_ph_measurement). `self.name` already falls back
        # to task_key when the label is missing.
        name = coordinator.data[installation_id]["name"]
        self.entity_id = async_generate_entity_id(
            ENTITY_ID_FORMAT, f"{name} {self.name}", hass=coordinator.hass
        )

    @property
    def _installation(self) -> dict | None:
        return self.coordinator.data.get(self._installation_id)

    @property
    def _task(self) -> dict | None:
        installation = self._installation
        if not installation:
            return None
        return installation.get("todo", {}).get(self._task_key)

    @property
    def name(self) -> str:
        task = self._task
        label = task.get("label") if task else None
        return f"Log {label}" if label else f"Log {self._task_key}"

    @property
    def icon(self) -> str:
        task = self._task
        return (task.get("icon") if task else None) or DEFAULT_BUTTON_ICON

    @property
    def extra_state_attributes(self) -> dict | None:
        # task_key lets the Lovelace card discover task buttons reliably; label
        # gives it a display name without parsing the friendly_name.
        task = self._task
        attrs: dict = {"task_key": self._task_key}
        if task and task.get("label") is not None:
            attrs["label"] = task["label"]
        return attrs

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
        return super().available and self._task is not None

    async def async_press(self) -> None:
        task = self._task
        if not task:
            return
        await self.coordinator.client.complete_task(self._installation_id, task["id"])
        await self.coordinator.async_request_refresh()

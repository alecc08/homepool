"""Sensor platform for homepool."""
from __future__ import annotations

from homeassistant.components.sensor import SensorEntity, SensorStateClass
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from . import HomepoolConfigEntry
from .const import DOMAIN, FIELD_META, FIELD_NAMES
from .coordinator import HomepoolDataUpdateCoordinator

# Fallback icon when a task payload carries no icon of its own.
DEFAULT_TODO_ICON = "mdi:calendar-clock"


async def async_setup_entry(
    hass: HomeAssistant,
    entry: HomepoolConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator = entry.runtime_data
    entities: list[SensorEntity] = []
    for installation_id, installation in coordinator.data.items():
        for field, value in installation["fields"].items():
            if field not in FIELD_META or not value:
                continue
            entities.append(
                HomepoolSensor(coordinator, entry.entry_id, installation_id, field)
            )
        entities.append(
            HomepoolHistorySensor(coordinator, entry.entry_id, installation_id)
        )

    # Maintenance-task sensors are fully data-driven: one "days until due" sensor
    # per configurable task. Because tasks can be added/enabled after setup, a
    # coordinator listener adds sensors for task keys first seen on a later poll
    # (HA only calls async_setup_entry once).
    known_tasks: set[tuple[int, str]] = set()

    def _add_task_sensors() -> None:
        new: list[SensorEntity] = []
        for installation_id, installation in coordinator.data.items():
            for task_key in installation.get("todo", {}):
                marker = (installation_id, task_key)
                if marker in known_tasks:
                    continue
                known_tasks.add(marker)
                new.append(
                    HomepoolTodoSensor(coordinator, entry.entry_id, installation_id, task_key)
                )
        if new:
            async_add_entities(new)

    _add_task_sensors()
    async_add_entities(entities)
    entry.async_on_unload(coordinator.async_add_listener(_add_task_sensors))


class HomepoolSensor(CoordinatorEntity[HomepoolDataUpdateCoordinator], SensorEntity):
    """A single measurement field for a single installation."""

    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: HomepoolDataUpdateCoordinator,
        entry_id: str,
        installation_id: int,
        field: str,
    ) -> None:
        super().__init__(coordinator)
        self._installation_id = installation_id
        self._field = field

        device_class, state_class, icon = FIELD_META[field]
        self._attr_device_class = device_class
        self._attr_state_class = state_class
        self._attr_icon = icon
        self._attr_name = FIELD_NAMES[field]
        self._attr_unique_id = f"{entry_id}_{installation_id}_{field}"

    @property
    def _installation(self) -> dict | None:
        return self.coordinator.data.get(self._installation_id)

    @property
    def _field_value(self) -> dict | None:
        installation = self._installation
        if not installation:
            return None
        return installation["fields"].get(self._field)

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
        return super().available and self._field_value is not None

    @property
    def native_value(self) -> float | None:
        value = self._field_value
        return value["value"] if value else None

    @property
    def native_unit_of_measurement(self) -> str | None:
        value = self._field_value
        return value.get("unit") if value else None

    @property
    def extra_state_attributes(self) -> dict | None:
        value = self._field_value
        if not value:
            return None
        attrs = {"date": value["date"]}
        # status/ideal_min/ideal_max/acceptable_min/acceptable_max are only
        # present on servers new enough to send them (apps/api/main.py
        # ParamValueOut) — older servers simply omit the keys, and the
        # homepool-card frontend degrades to neutral tiles when they're absent.
        for key in ("status", "ideal_min", "ideal_max", "acceptable_min", "acceptable_max"):
            if key in value:
                attrs[key] = value[key]
        installation = self._installation
        if installation and installation.get("sanitizer"):
            attrs["sanitizer"] = installation["sanitizer"]
        return attrs


class HomepoolTodoSensor(CoordinatorEntity[HomepoolDataUpdateCoordinator], SensorEntity):
    """Days-until-due for a single maintenance task on a single installation.

    A plain numeric sensor (not a binary_sensor) so users can build their own
    automation thresholds (e.g. "notify at <=3 days" vs "notify only when
    overdue") via a templated trigger instead of a hardcoded due-soon window.
    """

    _attr_has_entity_name = True
    _attr_native_unit_of_measurement = "d"
    _attr_state_class = SensorStateClass.MEASUREMENT

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
        # Namespaced with "_todo_" so this can never collide with a field-based
        # unique_id. Keyed by the task's stable `key` so it survives renames.
        self._attr_unique_id = f"{entry_id}_{installation_id}_todo_{task_key}"

    @property
    def _installation(self) -> dict | None:
        return self.coordinator.data.get(self._installation_id)

    @property
    def _task_value(self) -> dict | None:
        installation = self._installation
        if not installation:
            return None
        return installation.get("todo", {}).get(self._task_key)

    @property
    def name(self) -> str:
        value = self._task_value
        label = value.get("label") if value else None
        return f"Days Until {label} Due" if label else f"Days Until {self._task_key} Due"

    @property
    def icon(self) -> str:
        value = self._task_value
        return (value.get("icon") if value else None) or DEFAULT_TODO_ICON

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
        return super().available and self._task_value is not None

    @property
    def native_value(self) -> int | None:
        value = self._task_value
        return value["days_until_due"] if value else None

    @property
    def extra_state_attributes(self) -> dict | None:
        value = self._task_value
        if not value:
            return None
        # task_key lets the Lovelace card discover due sensors reliably instead
        # of guessing entity-id suffixes; label gives it a display name without
        # having to parse the friendly_name.
        attrs: dict = {"task_key": self._task_key}
        if value.get("label") is not None:
            attrs["label"] = value["label"]
        if value.get("last_date") is not None:
            attrs["last_date"] = value["last_date"]
        if value.get("interval_days") is not None:
            attrs["interval_days"] = value["interval_days"]
        return attrs


class HomepoolHistorySensor(CoordinatorEntity[HomepoolDataUpdateCoordinator], SensorEntity):
    """Recent action history (measurements, treatments, maintenance) for a
    single installation.

    State is the number of entries; the entries themselves ride on the
    `entries` attribute, which the homepool history Lovelace card renders as a
    table. Frontend-facing only — hence no device/state class.
    """

    _attr_has_entity_name = True
    _attr_icon = "mdi:history"
    _attr_name = "History"

    def __init__(
        self,
        coordinator: HomepoolDataUpdateCoordinator,
        entry_id: str,
        installation_id: int,
    ) -> None:
        super().__init__(coordinator)
        self._installation_id = installation_id
        self._attr_unique_id = f"{entry_id}_{installation_id}_history"

    @property
    def _installation(self) -> dict | None:
        return self.coordinator.data.get(self._installation_id)

    @property
    def _history(self) -> list[dict]:
        installation = self._installation
        return installation.get("history", []) if installation else []

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
    def native_value(self) -> int:
        return len(self._history)

    @property
    def extra_state_attributes(self) -> dict:
        return {"entries": self._history}

"""Sensor platform for homepool."""
from __future__ import annotations

from homeassistant.components.sensor import (
    ENTITY_ID_FORMAT,
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.core import Event, EventStateChangedData, HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity import async_generate_entity_id
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import dt as dt_util

from . import HomepoolConfigEntry
from .const import DOMAIN, FIELD_META, FIELD_NAMES
from .coordinator import HomepoolDataUpdateCoordinator
from .external import external_value, recompute_status, source_entity

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
        for field in FIELD_META:
            # A field gets an entity when homepool has a value for it *or* when
            # the user mapped it to one of their own entities — the latter lets
            # a smart probe surface a reading homepool has never recorded.
            override = source_entity(entry.options, installation_id, field)
            if not installation["fields"].get(field) and not override:
                continue
            entities.append(
                HomepoolSensor(
                    coordinator, entry.entry_id, installation_id, field, override
                )
            )
        entities.append(
            HomepoolHistorySensor(coordinator, entry.entry_id, installation_id)
        )
        entities.append(
            HomepoolTreatmentsSensor(coordinator, entry.entry_id, installation_id)
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
    """A single measurement field for a single installation.

    Optionally backed by an external Home Assistant entity (`source_entity_id`)
    instead of homepool's own last recorded value — a smart pH probe, a
    template sensor, an input_number, whatever the user picked in the options
    flow. The override is applied *inside* this entity rather than by asking
    users to swap entity ids in their dashboards, so the bundled Lovelace cards
    (which resolve everything from one `sensor.<installation>_…` prefix) keep
    working untouched. The active source is published on the `source` /
    `source_entity_id` attributes.

    Any external reading that isn't usable — unavailable, unknown,
    non-numeric, or in a unit that can't be reconciled with homepool's — falls
    back to homepool's value instead of blanking the entity.
    """

    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: HomepoolDataUpdateCoordinator,
        entry_id: str,
        installation_id: int,
        field: str,
        source_entity_id: str | None = None,
    ) -> None:
        super().__init__(coordinator)
        self._installation_id = installation_id
        self._field = field
        self._source_entity_id = source_entity_id

        device_class, state_class, icon = FIELD_META[field]
        self._attr_device_class = device_class
        self._attr_state_class = state_class
        self._attr_icon = icon
        self._attr_name = FIELD_NAMES[field]
        self._attr_unique_id = f"{entry_id}_{installation_id}_{field}"

        # Pin the entity-id to a deterministic, area-free slug so every entity
        # for one installation shares a single prefix (e.g. sensor.home_ph).
        # Passing this via async_generate_entity_id makes HA treat it as a
        # suggested object-id and skip prefixing the area name at first-time
        # registration (see issue #42) — friendly names are unaffected.
        name = coordinator.data[installation_id]["name"]
        self.entity_id = async_generate_entity_id(
            ENTITY_ID_FORMAT, f"{name} {FIELD_NAMES[field]}", hass=coordinator.hass
        )

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
    def _homepool_unit(self) -> str | None:
        value = self._field_value
        return value.get("unit") if value else None

    @property
    def _source_state(self):
        """The overriding entity's state object, if one is configured."""
        # Guarding against self-reference keeps a mis-configuration (or an
        # entity-id rename that collides) from making the sensor read itself.
        if not self._source_entity_id or self._source_entity_id == self.entity_id:
            return None
        if self.hass is None:
            return None
        return self.hass.states.get(self._source_entity_id)

    @property
    def _external_value(self) -> float | None:
        """The overriding entity's reading, converted into homepool's unit."""
        state = self._source_state
        if state is None:
            return None
        return external_value(
            state.state,
            state.attributes.get("unit_of_measurement"),
            self._homepool_unit,
        )

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        if self._source_entity_id:
            self.async_on_remove(
                async_track_state_change_event(
                    self.hass, [self._source_entity_id], self._handle_source_change
                )
            )

    @callback
    def _handle_source_change(self, event: Event[EventStateChangedData]) -> None:
        self.async_write_ha_state()

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
        # A working external source keeps the entity alive even while the
        # homepool server itself is unreachable.
        if self._external_value is not None:
            return True
        return super().available and self._field_value is not None

    @property
    def native_value(self) -> float | None:
        external = self._external_value
        if external is not None:
            return external
        value = self._field_value
        return value["value"] if value else None

    @property
    def native_unit_of_measurement(self) -> str | None:
        # pH is unitless in Home Assistant's PH device class; never let an
        # external probe's cosmetic "pH" unit leak through and get rejected.
        if self._attr_device_class == SensorDeviceClass.PH:
            return None
        unit = self._homepool_unit
        if unit:
            return unit
        # No homepool reading yet (override-only field): pass the source
        # entity's own unit through rather than showing a bare number.
        state = self._source_state
        return state.attributes.get("unit_of_measurement") if state else None

    @property
    def extra_state_attributes(self) -> dict | None:
        external = self._external_value
        attrs: dict = {}
        if self._source_entity_id:
            attrs["source_entity_id"] = self._source_entity_id
            attrs["source"] = "external" if external is not None else "homepool"
        value = self._field_value
        if value:
            attrs["date"] = value["date"]
            # status/ideal_min/ideal_max/acceptable_min/acceptable_max are only
            # present on servers new enough to send them (apps/api/main.py
            # ParamValueOut) — older servers simply omit the keys, and the
            # homepool-card frontend degrades to neutral tiles when they're
            # absent.
            for key in ("status", "ideal_min", "ideal_max", "acceptable_min", "acceptable_max"):
                if key in value:
                    attrs[key] = value[key]
        if external is not None:
            # The reading on show is the live external one, so `date` (which the
            # card renders as "measured N days ago") is now, and `status` has to
            # be re-derived against that value rather than describing whatever
            # homepool last recorded.
            attrs["date"] = dt_util.now().date().isoformat()
            status = recompute_status(external, attrs)
            if status is not None:
                attrs["status"] = status
            else:
                attrs.pop("status", None)
        installation = self._installation
        if installation and installation.get("sanitizer"):
            attrs["sanitizer"] = installation["sanitizer"]
        return attrs or None


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

        # Deterministic, area-free entity-id (see issue #42 / HomepoolSensor).
        # `self.name` already falls back to task_key when the label is missing.
        name = coordinator.data[installation_id]["name"]
        self.entity_id = async_generate_entity_id(
            ENTITY_ID_FORMAT, f"{name} {self.name}", hass=coordinator.hass
        )

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

        # Deterministic, area-free entity-id (see issue #42 / HomepoolSensor).
        # The history card requires exactly <prefix>_history.
        name = coordinator.data[installation_id]["name"]
        self.entity_id = async_generate_entity_id(
            ENTITY_ID_FORMAT, f"{name} History", hass=coordinator.hass
        )

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


class HomepoolTreatmentsSensor(CoordinatorEntity[HomepoolDataUpdateCoordinator], SensorEntity):
    """The installation's enabled treatment products.

    State is the number of products; the catalog rides on the `treatments`
    attribute. This exists because the Lovelace card can only read
    `hass.states` — it is how the card's "Log treatment" form knows which
    products to offer, and which unit each one defaults to. Frontend-facing
    only, like the history sensor.
    """

    _attr_has_entity_name = True
    _attr_icon = "mdi:beaker-plus"
    _attr_name = "Treatments"

    def __init__(
        self,
        coordinator: HomepoolDataUpdateCoordinator,
        entry_id: str,
        installation_id: int,
    ) -> None:
        super().__init__(coordinator)
        self._installation_id = installation_id
        self._attr_unique_id = f"{entry_id}_{installation_id}_treatments"

        # Deterministic, area-free entity-id (see issue #42 / HomepoolSensor).
        # The card derives this from its entity_prefix, so it must be exactly
        # <prefix>_treatments.
        name = coordinator.data[installation_id]["name"]
        self.entity_id = async_generate_entity_id(
            ENTITY_ID_FORMAT, f"{name} Treatments", hass=coordinator.hass
        )

    @property
    def _installation(self) -> dict | None:
        return self.coordinator.data.get(self._installation_id)

    @property
    def _treatments(self) -> list[dict]:
        installation = self._installation
        return installation.get("treatments", []) if installation else []

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
        return len(self._treatments)

    @property
    def extra_state_attributes(self) -> dict:
        # Only what the card's picker needs — the full catalog rows carry
        # server-side ids and dosage links no frontend uses.
        return {
            "treatments": [
                {
                    "key": product["key"],
                    "label": product["label"],
                    "icon": product.get("icon"),
                    "default_unit": product.get("default_unit", ""),
                    "param": product.get("param"),
                }
                for product in self._treatments
            ]
        }

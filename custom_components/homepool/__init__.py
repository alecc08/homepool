"""The Homepool integration."""
from __future__ import annotations

import json
import logging
from pathlib import Path

import voluptuous as vol
from homeassistant.components import frontend
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.const import CONF_API_KEY, CONF_URL, Platform
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv

from .api import HomepoolApiError
from .const import DOMAIN
from .coordinator import HomepoolDataUpdateCoordinator
from .external import configured_sources, push_back_enabled, push_interval_minutes
from .pushback import HomepoolPushBack

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [Platform.SENSOR, Platform.BUTTON]

# Only configurable via the UI config flow, never YAML.
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

# Served by async_setup below. The Lovelace card (frontend/homepool-card.js) is a
# hand-written vanilla ES module with no build step — this integration serves it
# directly rather than shipping a separate HACS "plugin" repo (HACS allows only
# one category per repo, and this one is registered as Integration).
CARD_URL_PATH = "/homepool/homepool-card.js"
_FRONTEND_DIR = Path(__file__).parent / "frontend"


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Registers the Lovelace card's static JS once per HA run (independent of
    config entries — the resource should be available even before a user adds
    their first homepool installation)."""
    manifest = json.loads((Path(__file__).parent / "manifest.json").read_text())
    await hass.http.async_register_static_paths(
        [StaticPathConfig(CARD_URL_PATH, str(_FRONTEND_DIR / "homepool-card.js"), cache_headers=True)]
    )
    # The ?v= cache-bust is mandatory: browsers/HA frontend aggressively cache
    # extra_js_url resources, so without a version bump on every card change,
    # users get served a stale card after an update.
    frontend.add_extra_js_url(hass, f"{CARD_URL_PATH}?v={manifest['version']}")
    return True

SERVICE_LOG_MEASUREMENT = "log_measurement"
SERVICE_LOG_MAINTENANCE = "log_maintenance"
SERVICE_LOG_TREATMENT = "log_treatment"

# `date` is optional everywhere and means "this happened then, not now" — for
# recording something you did days ago and forgot to log. Omitted means today.
SERVICE_LOG_MEASUREMENT_SCHEMA = vol.Schema(
    {
        vol.Required("installation_id"): cv.positive_int,
        vol.Optional("date"): cv.date,
        vol.Optional("ph"): vol.Coerce(float),
        vol.Optional("chlorine"): vol.Coerce(float),
        vol.Optional("bromine"): vol.Coerce(float),
        vol.Optional("tac"): vol.Coerce(float),
        vol.Optional("hardness"): vol.Coerce(float),
        vol.Optional("salt"): vol.Coerce(float),
        vol.Optional("stabilizer"): vol.Coerce(float),
        vol.Optional("cc"): vol.Coerce(float),
        vol.Optional("temp"): vol.Coerce(float),
        vol.Optional("notes"): cv.string,
    }
)

# `task` is a task key, the same string the todo sensors and "log" buttons
# publish as their `task_key` attribute — so an automation can name a task
# without hardcoding a database id.
SERVICE_LOG_MAINTENANCE_SCHEMA = vol.Schema(
    {
        vol.Required("installation_id"): cv.positive_int,
        vol.Required("task"): cv.string,
        vol.Optional("date"): cv.date,
        vol.Optional("notes"): cv.string,
    }
)

# `treatment` is a product key from the installation's treatment catalog — the
# same strings the Treatments sensor publishes, so an automation can name a
# product without hardcoding a database id. `unit` is optional and defaults
# server-side to the product's own unit.
SERVICE_LOG_TREATMENT_SCHEMA = vol.Schema(
    {
        vol.Required("installation_id"): cv.positive_int,
        vol.Required("treatment"): cv.string,
        vol.Optional("qty"): vol.Coerce(str),
        vol.Optional("unit"): cv.string,
        vol.Optional("brand"): cv.string,
        vol.Optional("date"): cv.date,
        vol.Optional("notes"): cv.string,
    }
)

type HomepoolConfigEntry = ConfigEntry[HomepoolDataUpdateCoordinator]


def _coordinator_for_installation(
    hass: HomeAssistant, installation_id: int
) -> HomepoolDataUpdateCoordinator:
    """Finds the loaded config entry that owns an installation. Services take an
    installation_id rather than a target entity, so the owning entry has to be
    resolved by looking at what each coordinator polled."""
    for entry in hass.config_entries.async_entries(DOMAIN):
        coordinator = entry.runtime_data
        if coordinator is not None and installation_id in coordinator.data:
            return coordinator
    raise HomeAssistantError(f"Unknown Homepool installation_id: {installation_id}")


async def async_setup_entry(hass: HomeAssistant, entry: HomepoolConfigEntry) -> bool:
    coordinator = HomepoolDataUpdateCoordinator(
        hass, entry.data[CONF_URL], entry.data[CONF_API_KEY]
    )
    await coordinator.async_config_entry_first_refresh()

    entry.runtime_data = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # The options flow rewrites which entity backs which reading, and entities
    # are built once at platform setup — so reload the entry whenever options
    # change instead of trying to re-plumb live entities.
    entry.async_on_unload(entry.add_update_listener(_async_options_updated))

    # Opt-in write-back of externally-sourced readings into homepool.
    for installation_id in coordinator.data:
        if not push_back_enabled(entry.options, installation_id):
            continue
        sources = configured_sources(entry.options, installation_id)
        if not sources:
            continue
        pusher = HomepoolPushBack(
            hass,
            coordinator,
            installation_id,
            sources,
            push_interval_minutes(entry.options, installation_id),
        )
        entry.async_on_unload(pusher.async_start())

    if not hass.services.has_service(DOMAIN, SERVICE_LOG_MEASUREMENT):
        async def _async_log_measurement(call: ServiceCall) -> None:
            installation_id = call.data["installation_id"]
            coordinator = _coordinator_for_installation(hass, installation_id)
            fields = {
                k: v for k, v in call.data.items()
                if k not in ("installation_id",)
            }
            # cv.date hands back a datetime.date; the API speaks ISO strings.
            if "date" in fields:
                fields["date"] = fields["date"].isoformat()
            try:
                await coordinator.client.create_measurement(installation_id, **fields)
            except HomepoolApiError as err:
                raise HomeAssistantError(str(err)) from err
            await coordinator.async_request_refresh()

        hass.services.async_register(
            DOMAIN, SERVICE_LOG_MEASUREMENT, _async_log_measurement, schema=SERVICE_LOG_MEASUREMENT_SCHEMA
        )

    if not hass.services.has_service(DOMAIN, SERVICE_LOG_MAINTENANCE):
        async def _async_log_maintenance(call: ServiceCall) -> None:
            installation_id = call.data["installation_id"]
            task_key = call.data["task"]
            coordinator = _coordinator_for_installation(hass, installation_id)
            task = coordinator.data[installation_id].get("todo", {}).get(task_key)
            if task is None:
                known = sorted(coordinator.data[installation_id].get("todo", {}))
                raise HomeAssistantError(
                    f"Unknown Homepool maintenance task '{task_key}'. Known tasks: {', '.join(known) or 'none'}"
                )
            call_date = call.data.get("date")
            try:
                await coordinator.client.complete_task(
                    installation_id,
                    task["id"],
                    date=call_date.isoformat() if call_date else None,
                    notes=call.data.get("notes"),
                )
            except HomepoolApiError as err:
                raise HomeAssistantError(str(err)) from err
            await coordinator.async_request_refresh()

        hass.services.async_register(
            DOMAIN, SERVICE_LOG_MAINTENANCE, _async_log_maintenance, schema=SERVICE_LOG_MAINTENANCE_SCHEMA
        )

    if not hass.services.has_service(DOMAIN, SERVICE_LOG_TREATMENT):
        async def _async_log_treatment(call: ServiceCall) -> None:
            installation_id = call.data["installation_id"]
            treatment_key = call.data["treatment"]
            coordinator = _coordinator_for_installation(hass, installation_id)
            catalog = coordinator.data[installation_id].get("treatments", [])
            if not any(product["key"] == treatment_key for product in catalog):
                known = sorted(product["key"] for product in catalog)
                raise HomeAssistantError(
                    f"Unknown Homepool treatment '{treatment_key}'. Known treatments: {', '.join(known) or 'none'}"
                )
            fields = {
                k: v for k, v in call.data.items()
                if k not in ("installation_id", "treatment")
            }
            # cv.date hands back a datetime.date; the API speaks ISO strings.
            if "date" in fields:
                fields["date"] = fields["date"].isoformat()
            try:
                await coordinator.client.create_treatment(
                    installation_id, treatment_key, **fields
                )
            except HomepoolApiError as err:
                raise HomeAssistantError(str(err)) from err
            await coordinator.async_request_refresh()

        hass.services.async_register(
            DOMAIN, SERVICE_LOG_TREATMENT, _async_log_treatment, schema=SERVICE_LOG_TREATMENT_SCHEMA
        )

    return True


async def _async_options_updated(hass: HomeAssistant, entry: HomepoolConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: HomepoolConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        other_loaded = [
            e for e in hass.config_entries.async_entries(DOMAIN)
            if e.entry_id != entry.entry_id and e.state is ConfigEntryState.LOADED
        ]
        if not other_loaded:
            hass.services.async_remove(DOMAIN, SERVICE_LOG_MEASUREMENT)
            hass.services.async_remove(DOMAIN, SERVICE_LOG_MAINTENANCE)
            hass.services.async_remove(DOMAIN, SERVICE_LOG_TREATMENT)
    return unloaded

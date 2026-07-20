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

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [Platform.SENSOR, Platform.BUTTON]

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

SERVICE_LOG_MEASUREMENT_SCHEMA = vol.Schema(
    {
        vol.Required("installation_id"): cv.positive_int,
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

type HomepoolConfigEntry = ConfigEntry[HomepoolDataUpdateCoordinator]


async def async_setup_entry(hass: HomeAssistant, entry: HomepoolConfigEntry) -> bool:
    coordinator = HomepoolDataUpdateCoordinator(
        hass, entry.data[CONF_URL], entry.data[CONF_API_KEY]
    )
    await coordinator.async_config_entry_first_refresh()

    entry.runtime_data = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    if not hass.services.has_service(DOMAIN, SERVICE_LOG_MEASUREMENT):
        async def _async_log_measurement(call: ServiceCall) -> None:
            installation_id = call.data["installation_id"]
            fields = {
                k: v for k, v in call.data.items()
                if k not in ("installation_id",)
            }
            for candidate_entry in hass.config_entries.async_entries(DOMAIN):
                candidate_coordinator = candidate_entry.runtime_data
                if candidate_coordinator is None or installation_id not in candidate_coordinator.data:
                    continue
                try:
                    await candidate_coordinator.client.create_measurement(installation_id, **fields)
                except HomepoolApiError as err:
                    raise HomeAssistantError(str(err)) from err
                await candidate_coordinator.async_request_refresh()
                return
            raise HomeAssistantError(f"Unknown Homepool installation_id: {installation_id}")

        hass.services.async_register(
            DOMAIN, SERVICE_LOG_MEASUREMENT, _async_log_measurement, schema=SERVICE_LOG_MEASUREMENT_SCHEMA
        )

    return True


async def async_unload_entry(hass: HomeAssistant, entry: HomepoolConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        other_loaded = [
            e for e in hass.config_entries.async_entries(DOMAIN)
            if e.entry_id != entry.entry_id and e.state is ConfigEntryState.LOADED
        ]
        if not other_loaded:
            hass.services.async_remove(DOMAIN, SERVICE_LOG_MEASUREMENT)
    return unloaded

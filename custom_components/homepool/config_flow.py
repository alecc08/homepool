"""Config flow for Homepool."""
from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol
from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.const import CONF_API_KEY, CONF_URL
from homeassistant.core import callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.selector import (
    BooleanSelector,
    EntitySelector,
    EntitySelectorConfig,
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    SelectOptionDict,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
)

from .api import (
    HomepoolApiError,
    HomepoolAuthError,
    HomepoolCannotResolveHostError,
    HomepoolClient,
    HomepoolConnectionRefusedError,
    HomepoolTimeoutError,
    build_candidate_base_urls,
)
from .const import DOMAIN, FIELD_META
from .external import (
    CONF_INSTALLATIONS,
    CONF_PUSH_BACK,
    CONF_PUSH_INTERVAL,
    CONF_SOURCES,
    DEFAULT_PUSH_INTERVAL_MINUTES,
    MAX_PUSH_INTERVAL_MINUTES,
    MIN_PUSH_INTERVAL_MINUTES,
    installation_options,
)

CONF_INSTALLATION = "installation"

# Domains a homepool reading may be sourced from. `sensor` covers smart probes
# and template sensors; `number`/`input_number` let someone drive a reading from
# a helper they set by hand or from an automation.
SOURCE_DOMAINS = ["sensor", "number", "input_number"]

_LOGGER = logging.getLogger(__name__)

STEP_USER_DATA_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_URL): str,
        vol.Required(CONF_API_KEY): str,
    }
)


class HomepoolConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Homepool."""

    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return HomepoolOptionsFlow()

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            api_key = user_input[CONF_API_KEY]
            session = async_get_clientsession(self.hass)
            installations: list[dict] | None = None
            working_base_url: str | None = None
            error_key = "cannot_connect"

            for candidate in build_candidate_base_urls(user_input[CONF_URL]):
                client = HomepoolClient(session, candidate, api_key)
                try:
                    installations = await client.list_installations()
                except HomepoolAuthError:
                    error_key = "invalid_auth"
                    break
                except HomepoolTimeoutError:
                    error_key = "timeout"
                    break
                except HomepoolCannotResolveHostError:
                    error_key = "cannot_resolve_host"
                    break
                except HomepoolConnectionRefusedError:
                    error_key = "connection_refused"
                    continue
                except HomepoolApiError:
                    error_key = "cannot_connect"
                    continue
                else:
                    working_base_url = candidate
                    _LOGGER.debug("homepool config flow: connected using %s", candidate)
                    break

            if installations is None:
                errors["base"] = error_key
            elif not installations:
                errors["base"] = "no_installations"
            else:
                await self.async_set_unique_id(f"{working_base_url}:{api_key}")
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title="Homepool",
                    data={CONF_URL: working_base_url, CONF_API_KEY: api_key},
                )

        return self.async_show_form(
            step_id="user", data_schema=STEP_USER_DATA_SCHEMA, errors=errors
        )


class HomepoolOptionsFlow(OptionsFlow):
    """Lets a user point homepool readings at their own Home Assistant entities.

    One entry can carry several installations, so the flow is two steps: pick a
    pool/spa (skipped when there's only one), then map each reading to an
    entity. Options are stored per installation id under `installations`, and
    the entry is reloaded on save so the sensor platform rebuilds with the new
    mapping (see __init__.py's update listener).
    """

    def __init__(self) -> None:
        self._installation_id: int | None = None

    @property
    def _installations(self) -> dict[int, dict]:
        coordinator = getattr(self.config_entry, "runtime_data", None)
        return dict(coordinator.data) if coordinator and coordinator.data else {}

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        installations = self._installations
        if not installations:
            # Entry not loaded (server unreachable): we have no installation
            # list to build the per-reading form from.
            return self.async_abort(reason="no_installations")

        if user_input is not None:
            self._installation_id = int(user_input[CONF_INSTALLATION])
            return await self.async_step_sensors()

        if len(installations) == 1:
            self._installation_id = next(iter(installations))
            return await self.async_step_sensors()

        options = [
            SelectOptionDict(value=str(installation_id), label=data["name"])
            for installation_id, data in sorted(
                installations.items(), key=lambda item: item[1]["name"]
            )
        ]
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_INSTALLATION): SelectSelector(
                        SelectSelectorConfig(
                            options=options, mode=SelectSelectorMode.DROPDOWN
                        )
                    )
                }
            ),
        )

    async def async_step_sensors(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        installation_id = self._installation_id
        current = installation_options(self.config_entry.options, installation_id)
        sources = current.get(CONF_SOURCES) or {}

        if user_input is not None:
            # A cleared entity picker simply omits its key, which is exactly how
            # an override is removed again.
            new_sources = {
                field: user_input[field]
                for field in FIELD_META
                if user_input.get(field)
            }
            installations = dict(
                self.config_entry.options.get(CONF_INSTALLATIONS) or {}
            )
            installations[str(installation_id)] = {
                CONF_SOURCES: new_sources,
                CONF_PUSH_BACK: bool(user_input.get(CONF_PUSH_BACK)),
                CONF_PUSH_INTERVAL: int(
                    user_input.get(CONF_PUSH_INTERVAL, DEFAULT_PUSH_INTERVAL_MINUTES)
                ),
            }
            options = dict(self.config_entry.options)
            options[CONF_INSTALLATIONS] = installations
            return self.async_create_entry(title="", data=options)

        # Never offer this entry's own entities as a source — selecting one
        # would make a sensor read from itself.
        own_entities = [
            entry.entity_id
            for entry in er.async_entries_for_config_entry(
                er.async_get(self.hass), self.config_entry.entry_id
            )
        ]
        entity_selector = EntitySelector(
            EntitySelectorConfig(domain=SOURCE_DOMAINS, exclude_entities=own_entities)
        )

        schema: dict = {}
        for field in FIELD_META:
            schema[
                vol.Optional(
                    field, description={"suggested_value": sources.get(field)}
                )
            ] = entity_selector
        schema[
            vol.Optional(CONF_PUSH_BACK, default=bool(current.get(CONF_PUSH_BACK)))
        ] = BooleanSelector()
        schema[
            vol.Optional(
                CONF_PUSH_INTERVAL,
                default=current.get(CONF_PUSH_INTERVAL, DEFAULT_PUSH_INTERVAL_MINUTES),
            )
        ] = NumberSelector(
            NumberSelectorConfig(
                min=MIN_PUSH_INTERVAL_MINUTES,
                max=MAX_PUSH_INTERVAL_MINUTES,
                step=5,
                mode=NumberSelectorMode.BOX,
                unit_of_measurement="min",
            )
        )

        installation = self._installations.get(installation_id) or {}
        return self.async_show_form(
            step_id="sensors",
            data_schema=vol.Schema(schema),
            description_placeholders={"installation": installation.get("name", "")},
        )

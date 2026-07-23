"""Config flow for Homepool."""
from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol
from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.const import CONF_API_KEY, CONF_URL
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import (
    HomepoolApiError,
    HomepoolAuthError,
    HomepoolCannotResolveHostError,
    HomepoolClient,
    HomepoolConnectionRefusedError,
    HomepoolTimeoutError,
    build_candidate_base_urls,
)
from .const import DOMAIN

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

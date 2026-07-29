"""Unit tests for the external-sensor override logic.

Run with (from this directory): python -m pytest test_external.py -v
Or from the repo root: python -m pytest --rootdir=custom_components/homepool/tests \
  custom_components/homepool/tests/test_external.py -v

Like test_api.py, this needs no pytest-homeassistant-custom-component harness:
external.py has zero homeassistant.* imports on purpose, so the options
parsing, unit reconciliation and push-back gating can be tested with plain
pytest. See test_api.py's docstring for why rootdir has to be pinned here.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from external import (  # noqa: E402
    DEFAULT_PUSH_INTERVAL_MINUTES,
    MAX_PUSH_INTERVAL_MINUTES,
    MIN_PUSH_INTERVAL_MINUTES,
    configured_sources,
    convert_unit,
    external_value,
    installation_options,
    parse_state_value,
    push_back_enabled,
    push_interval_minutes,
    recompute_status,
    round_for_push,
    rounded_readings,
    should_push,
    source_entity,
)

OPTIONS = {
    "installations": {
        "1": {
            "sources": {"ph": "sensor.ph_probe", "temp": "sensor.pool_temp"},
            "push_back": True,
            "push_interval_minutes": 30,
        },
        "2": {"sources": {}},
    }
}


# --- Options parsing --------------------------------------------------------


def test_installation_options_accepts_int_and_str_ids() -> None:
    assert installation_options(OPTIONS, 1)["push_back"] is True
    assert installation_options(OPTIONS, "1")["push_back"] is True


def test_installation_options_missing_returns_empty_dict() -> None:
    assert installation_options(OPTIONS, 99) == {}
    assert installation_options(None, 1) == {}
    assert installation_options({}, 1) == {}


def test_configured_sources_drops_empty_values() -> None:
    options = {"installations": {"1": {"sources": {"ph": "sensor.a", "temp": ""}}}}
    assert configured_sources(options, 1) == {"ph": "sensor.a"}


def test_source_entity_returns_none_when_not_overridden() -> None:
    assert source_entity(OPTIONS, 1, "ph") == "sensor.ph_probe"
    assert source_entity(OPTIONS, 1, "chlorine") is None
    assert source_entity(OPTIONS, 2, "ph") is None


def test_push_back_is_opt_in() -> None:
    assert push_back_enabled(OPTIONS, 1) is True
    assert push_back_enabled(OPTIONS, 2) is False
    assert push_back_enabled(None, 1) is False


def test_push_interval_defaults_and_clamps() -> None:
    assert push_interval_minutes(OPTIONS, 1) == 30
    assert push_interval_minutes(OPTIONS, 2) == DEFAULT_PUSH_INTERVAL_MINUTES
    assert push_interval_minutes({"installations": {"1": {"push_interval_minutes": 1}}}, 1) == (
        MIN_PUSH_INTERVAL_MINUTES
    )
    assert push_interval_minutes({"installations": {"1": {"push_interval_minutes": 99999}}}, 1) == (
        MAX_PUSH_INTERVAL_MINUTES
    )
    assert push_interval_minutes({"installations": {"1": {"push_interval_minutes": "nope"}}}, 1) == (
        DEFAULT_PUSH_INTERVAL_MINUTES
    )


# --- State parsing ----------------------------------------------------------


def test_parse_state_value_rejects_unavailable_states() -> None:
    assert parse_state_value("7.2") == 7.2
    assert parse_state_value(7) == 7.0
    for bad in ("unknown", "unavailable", "", "  ", None, "not a number", "on"):
        assert parse_state_value(bad) is None


# --- Unit reconciliation ----------------------------------------------------


def test_convert_unit_passes_through_identical_or_unknown_units() -> None:
    assert convert_unit(7.2, "mg/L", "mg/L") == 7.2
    assert convert_unit(7.2, None, "mg/L") == 7.2
    assert convert_unit(7.2, "mg/L", None) == 7.2
    assert convert_unit(7.2, "", "") == 7.2


def test_convert_unit_treats_ppm_and_mg_per_litre_as_equivalent() -> None:
    assert convert_unit(1.5, "ppm", "mg/L") == 1.5
    assert convert_unit(1.5, "mg/L", "ppm") == 1.5


def test_convert_unit_converts_temperature_scales() -> None:
    assert convert_unit(86.0, "°F", "°C") == 30.0
    assert convert_unit(30.0, "°C", "°F") == 86.0
    assert convert_unit(303.15, "K", "°C") == 30.0


def test_convert_unit_refuses_incompatible_scales() -> None:
    # g/L is 1000x ppm and °dH is a different hardness scale entirely — better
    # to fall back to homepool's own value than show a wrong number.
    assert convert_unit(3.0, "g/L", "ppm") is None
    assert convert_unit(12.0, "°dH", "ppm") is None
    assert convert_unit(30.0, "°C", "ppm") is None


def test_external_value_end_to_end() -> None:
    assert external_value("86.0", "°F", "°C") == 30.0
    assert external_value("unavailable", "°F", "°C") is None
    assert external_value("7.4", None, None) == 7.4
    assert external_value("3", "g/L", "ppm") is None


# --- Status recomputation ---------------------------------------------------

BANDS = {
    "ideal_min": 7.0,
    "ideal_max": 7.6,
    "acceptable_min": 6.8,
    "acceptable_max": 7.8,
}


def test_recompute_status_mirrors_the_server_bands() -> None:
    assert recompute_status(7.2, BANDS) == "ok"
    assert recompute_status(7.7, BANDS) == "warn"
    assert recompute_status(8.4, BANDS) == "danger"


def test_recompute_status_is_none_without_bands() -> None:
    assert recompute_status(7.2, {}) is None
    assert recompute_status(7.2, {"date": "2026-07-01"}) is None


def test_recompute_status_danger_when_only_ideal_is_known() -> None:
    assert recompute_status(9.0, {"ideal_min": 7.0, "ideal_max": 7.6}) == "danger"


# --- Push-back gating -------------------------------------------------------


def test_round_for_push_uses_per_field_precision() -> None:
    assert round_for_push("ph", 7.2349) == 7.23
    assert round_for_push("tac", 118.6) == 119
    assert round_for_push("temp", 27.449) == 27.4


def test_rounded_readings_rounds_every_field() -> None:
    assert rounded_readings({"ph": 7.2349, "salt": 3210.4}) == {"ph": 7.23, "salt": 3210}


def test_should_push_requires_values() -> None:
    assert should_push({}, None) is False
    assert should_push({}, {"ph": 7.2}) is False


def test_should_push_on_first_run_and_on_change_only() -> None:
    assert should_push({"ph": 7.2}, None) is True
    assert should_push({"ph": 7.2}, {}) is True
    assert should_push({"ph": 7.2}, {"ph": 7.2}) is False
    assert should_push({"ph": 7.3}, {"ph": 7.2}) is True


def test_should_push_when_a_new_field_appears() -> None:
    assert should_push({"ph": 7.2, "temp": 27.0}, {"ph": 7.2}) is True

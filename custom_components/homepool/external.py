"""External-sensor override logic for the homepool integration.

Users can point any homepool reading (pH, chlorine, temperature, ...) at an
existing Home Assistant entity — a smart probe, a template sensor, whatever —
instead of the value homepool itself last recorded. This module holds the
*pure* part of that feature: reading the per-installation options blob,
validating/converting an external state value into homepool's own unit, and
deciding whether a value is worth pushing back to the server.

Deliberately free of any `homeassistant.*` import so it can be unit-tested with
plain pytest (see tests/test_external.py), exactly like api.py.
"""
from __future__ import annotations

from typing import Any, Mapping

# --- Options blob -----------------------------------------------------------
#
# Config-entry options are shaped as:
#
#   {
#     "installations": {
#       "<installation_id>": {
#         "sources": {"ph": "sensor.my_ph_probe", ...},
#         "push_back": true,
#         "push_interval_minutes": 60
#       }
#     }
#   }
#
# Installation ids are dict keys, so they're strings (options round-trip
# through JSON in .storage); every accessor below coerces on the way in.

CONF_INSTALLATIONS = "installations"
CONF_SOURCES = "sources"
CONF_PUSH_BACK = "push_back"
CONF_PUSH_INTERVAL = "push_interval_minutes"

DEFAULT_PUSH_INTERVAL_MINUTES = 60
MIN_PUSH_INTERVAL_MINUTES = 5
MAX_PUSH_INTERVAL_MINUTES = 1440

# Note attached to measurements the integration pushes back, so rows created
# from a smart probe are distinguishable from ones a human typed in.
PUSH_BACK_NOTE = "Logged automatically from Home Assistant"


def installation_options(
    options: Mapping[str, Any] | None, installation_id: int | str
) -> dict[str, Any]:
    """Per-installation options sub-dict ({} when nothing is configured)."""
    if not options:
        return {}
    installations = options.get(CONF_INSTALLATIONS) or {}
    if not isinstance(installations, Mapping):
        return {}
    value = installations.get(str(installation_id)) or {}
    return dict(value) if isinstance(value, Mapping) else {}


def configured_sources(
    options: Mapping[str, Any] | None, installation_id: int | str
) -> dict[str, str]:
    """{field: source entity_id} overrides configured for one installation."""
    sources = installation_options(options, installation_id).get(CONF_SOURCES) or {}
    if not isinstance(sources, Mapping):
        return {}
    return {str(k): str(v) for k, v in sources.items() if v}


def source_entity(
    options: Mapping[str, Any] | None, installation_id: int | str, field: str
) -> str | None:
    """The entity overriding `field`, or None when homepool's own value is used."""
    return configured_sources(options, installation_id).get(field)


def push_back_enabled(
    options: Mapping[str, Any] | None, installation_id: int | str
) -> bool:
    """Whether external readings should be written back to homepool. Opt-in."""
    return bool(installation_options(options, installation_id).get(CONF_PUSH_BACK))


def push_interval_minutes(
    options: Mapping[str, Any] | None, installation_id: int | str
) -> int:
    """Minutes between push-back attempts, clamped to a sane band."""
    raw = installation_options(options, installation_id).get(CONF_PUSH_INTERVAL)
    try:
        minutes = int(float(raw))
    except (TypeError, ValueError):
        return DEFAULT_PUSH_INTERVAL_MINUTES
    return max(MIN_PUSH_INTERVAL_MINUTES, min(MAX_PUSH_INTERVAL_MINUTES, minutes))


# --- Units ------------------------------------------------------------------

# States Home Assistant uses for "no usable value".
_NON_NUMERIC_STATES = {"", "unknown", "unavailable", "none", "null"}

# Units that are numerically interchangeable for pool chemistry (1 ppm of a
# dissolved solid in water == 1 mg/L). Anything outside a shared group (g/L,
# °dH, °f ...) is a genuine scale difference we refuse to guess at.
_EQUIVALENT_UNITS: tuple[frozenset[str], ...] = (
    frozenset({"ppm", "mg/l"}),
)

# Normalized temperature units -> the scale they denote.
_TEMPERATURE_UNITS = {
    "°c": "C", "c": "C", "celsius": "C",
    "°f": "F", "f": "F", "fahrenheit": "F",
    "k": "K", "kelvin": "K",
}

# Decimal places used when comparing/pushing a field back to homepool. Doubles
# as a noise filter: a probe that wobbles in the 3rd decimal never triggers a
# new measurement row.
PUSH_ROUNDING = {
    "ph": 2,
    "chlorine": 2,
    "bromine": 2,
    "cc": 2,
    "tac": 0,
    "hardness": 0,
    "salt": 0,
    "stabilizer": 0,
    "temp": 1,
}


def normalize_unit(unit: Any) -> str:
    """Casefolded, whitespace-stripped unit string ("" when unknown)."""
    if unit is None:
        return ""
    return str(unit).strip().lower()


def _to_celsius(value: float, unit: str) -> float:
    if unit == "F":
        return (value - 32.0) * 5.0 / 9.0
    if unit == "K":
        return value - 273.15
    return value


def _from_celsius(value: float, unit: str) -> float:
    if unit == "F":
        return value * 9.0 / 5.0 + 32.0
    if unit == "K":
        return value + 273.15
    return value


def convert_unit(value: float, source_unit: Any, target_unit: Any) -> float | None:
    """Express `value` in `target_unit`, or None when the units don't reconcile.

    An unknown unit on either side (None/"") is treated as "assume they match" —
    plenty of template sensors carry no unit, and refusing those would be more
    annoying than useful. Genuinely incompatible units (g/L vs ppm, °dH vs ppm)
    return None so the caller can fall back to homepool's own value instead of
    showing a number that's wrong by orders of magnitude.
    """
    source = normalize_unit(source_unit)
    target = normalize_unit(target_unit)
    if not source or not target or source == target:
        return value
    if source in _TEMPERATURE_UNITS and target in _TEMPERATURE_UNITS:
        celsius = _to_celsius(value, _TEMPERATURE_UNITS[source])
        return _from_celsius(celsius, _TEMPERATURE_UNITS[target])
    for group in _EQUIVALENT_UNITS:
        if source in group and target in group:
            return value
    return None


def parse_state_value(state: Any) -> float | None:
    """Float behind a Home Assistant state string, or None if there isn't one."""
    if state is None:
        return None
    if isinstance(state, str) and state.strip().lower() in _NON_NUMERIC_STATES:
        return None
    try:
        return float(state)
    except (TypeError, ValueError):
        return None


def external_value(state: Any, source_unit: Any, target_unit: Any) -> float | None:
    """A usable reading from an external entity's state, in homepool's unit.

    Returns None for unknown/unavailable/non-numeric states and for unit
    mismatches — every caller treats None as "fall back to homepool".
    """
    value = parse_state_value(state)
    if value is None:
        return None
    return convert_unit(value, source_unit, target_unit)


# --- Status -----------------------------------------------------------------

STATUS_KEYS = ("ideal_min", "ideal_max", "acceptable_min", "acceptable_max")


def recompute_status(value: float, bounds: Mapping[str, Any]) -> str | None:
    """Re-derive the ok/warn/danger status for an externally-sourced reading.

    The server computes `status` for the value *homepool* last recorded, which
    is not the number the entity is showing once a reading is overridden. The
    ideal/acceptable bands ride along on the same payload though, so the status
    can be recomputed locally against the live value — mirroring
    apps/api/water_params.py's `param_status` exactly (ok = within ideal,
    warn = within acceptable, danger = outside both).

    Returns None when the server sent no bands for this field, matching its own
    "absent means unknown" convention.
    """
    ideal_min, ideal_max = bounds.get("ideal_min"), bounds.get("ideal_max")
    acceptable_min = bounds.get("acceptable_min")
    acceptable_max = bounds.get("acceptable_max")
    if all(bounds.get(key) is None for key in STATUS_KEYS):
        return None
    if ideal_min is not None and ideal_max is not None and ideal_min <= value <= ideal_max:
        return "ok"
    if (
        acceptable_min is not None
        and acceptable_max is not None
        and acceptable_min <= value <= acceptable_max
    ):
        return "warn"
    return "danger"


# --- Push-back --------------------------------------------------------------


def round_for_push(field: str, value: float) -> float:
    """Round a reading to the precision homepool actually records for it."""
    return round(value, PUSH_ROUNDING.get(field, 2))


def rounded_readings(values: Mapping[str, float]) -> dict[str, float]:
    return {field: round_for_push(field, value) for field, value in values.items()}


def should_push(
    current: Mapping[str, float], last_pushed: Mapping[str, float] | None
) -> bool:
    """Whether this snapshot is worth a new measurement row.

    True when there's anything to send and at least one field moved since the
    last successful push — so a stable pool doesn't accumulate an identical row
    every interval, but a real change is recorded promptly.
    """
    if not current:
        return False
    if not last_pushed:
        return True
    return any(last_pushed.get(field) != value for field, value in current.items())

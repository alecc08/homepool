# apps/api/simulator.py
#
# Freestyle "what-if" tools (issue #11): unlike dosage.py's compute_recommendations,
# which is driven by a stored installation reading, these take user-supplied values
# directly -- so someone can ask "if my TAC were 50 and I want 130, in a 10,000 L pool,
# how much baking soda?" without having logged a measurement first. Reuses
# TREATMENT_TABLE/_options_with_amounts from dosage.py rather than duplicating the
# per-option dosing math.
from typing import Dict

from dosage import (
    TREATMENT_TABLE,
    _SWG_RAISE_GUIDANCE,
    _guidance_only_recommendation,
    _options_with_amounts,
)

JOULES_PER_KG_PER_C = 4186.0  # specific heat of water
KG_PER_LITER = 1.0  # water density ~= 1 kg/L, close enough for this estimate
JOULES_PER_KWH = 3.6e6


def simulate_dosage(
    param: str, current_value: float, target_value: float, volume_L: float, sanitizer: str,
) -> Dict:
    """Same option/amount shape as compute_recommendations' entries, but driven by
    user-supplied current/target values instead of a stored installation reading."""
    if target_value == current_value:
        raise ValueError("target_value must differ from current_value")
    direction = "raise" if target_value > current_value else "lower"
    delta = target_value - current_value

    if param == "cl" and direction == "raise" and sanitizer == "salt":
        direction_entry = _SWG_RAISE_GUIDANCE
    else:
        table_entry = TREATMENT_TABLE.get(param)
        if table_entry is None:
            raise ValueError(f"Unsupported param: {param}")
        direction_entry = table_entry.get(direction)
        if direction_entry is None:
            raise ValueError(f"No treatment guidance for {param}/{direction}")

    if direction_entry.get("guidance_only"):
        return _guidance_only_recommendation(
            param, current_value, target_value, direction, True, direction_entry["notes_key"],
        )

    # The simulator only has the one param the user is adjusting. For a tac sim that value
    # IS the current TA, so pass it through; otherwise leave TA/pH None and let
    # _compute_side_effect fall back to typical values (the caveat text covers the estimate).
    current_ta = current_value if param == "tac" else None
    options_out = _options_with_amounts(
        direction_entry["options"], delta, volume_L, current_ta=current_ta, current_ph=None,
    )
    return {
        "param": param,
        "current_value": current_value,
        "target_value": target_value,
        "direction": direction,
        "volume_known": True,
        "options": options_out,
    }


def simulate_heating_energy(
    volume_L: float, current_temp_c: float, target_temp_c: float, efficiency: float = 0.9,
) -> Dict:
    """kWh = mass(kg) * specific_heat(J/kg*C) * delta_T(C) / J_per_kWh / efficiency.
    Returns both the raw kWh estimate and the efficiency assumption used, so the UI can
    make clear this is a rough estimate, not a heater-specific figure."""
    mass_kg = volume_L * KG_PER_LITER
    delta_temp_c = target_temp_c - current_temp_c
    kwh = mass_kg * JOULES_PER_KG_PER_C * delta_temp_c / JOULES_PER_KWH / efficiency
    return {
        "kwh": round(kwh, 2),
        "delta_temp_c": delta_temp_c,
        "efficiency": efficiency,
    }

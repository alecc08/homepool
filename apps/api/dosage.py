# apps/api/dosage.py
#
# Pure-function dosage-recommendation engine (issue #16). Given already-fetched
# current readings (water_params.extract_current_conditions) and effective
# ranges (main.py's WATER_PARAMS + _merge_range_overrides), works out what to
# add — and how much, when the installation's volume is known — to bring an
# out-of-band parameter back toward its ideal midpoint. No DB access, so it's
# trivially unit-testable in isolation from FastAPI/SQLModel.
from typing import Dict, List, Optional

from models import Installation

GAL_TO_L = 3.78541

# extract_current_conditions() (water_params.py) keys its dict by the parsed
# measurement-field names, which don't all match WATER_PARAMS' range keys
# (cl/br/cya vs chlorine/bromine/stabilizer) — mirrors installationParamsToRanges
# in apps/web/src/utils.ts, which performs the same translation on the frontend.
RANGE_TO_CURRENT_FIELD = {
    "ph": "ph",
    "cl": "chlorine",
    "br": "bromine",
    "cc": "cc",
    "tac": "tac",
    "temp": "temp",
    "salt": "salt",
    "cya": "stabilizer",
    "hardness": "hardness",
}


def _exact_option(
    product_id: str,
    form: str,
    dose_amount: float,
    dose_param_delta: float,
    dose_volume_L: float = 1000.0,
    purity: Optional[float] = None,
    notes_key: Optional[str] = None,
    amount_unit: Optional[str] = None,
    side_effect: Optional[Dict] = None,
) -> Dict:
    return {
        "product_id": product_id,
        "form": form,
        "purity": purity,
        "exact": True,
        "dose_amount": dose_amount,
        "dose_param_delta": dose_param_delta,
        "dose_volume_L": dose_volume_L,
        "notes_key": notes_key,
        # Which output field the computed amount lands in. Defaults to the product's
        # physical form (solid -> grams, liquid -> mL), but can be overridden --
        # e.g. cya_liquid states its dose in grams of active ingredient, not a poured
        # volume, since liquid CYA concentration varies too much by brand to convert.
        "amount_unit": amount_unit or ("grams" if form == "solid" else "ml"),
        # Optional secondary-parameter shift this product causes (issue #40). A spec
        # ({"kind": ..., ...}) resolved to a concrete {param, delta, notes_key} at
        # compute time by _compute_side_effect; None for products with no meaningful
        # secondary effect.
        "side_effect": side_effect,
    }


def _inexact_option(
    product_id: str,
    form: str,
    notes_key: str,
    purity: Optional[float] = None,
) -> Dict:
    return {
        "product_id": product_id,
        "form": form,
        "purity": purity,
        "exact": False,
        "dose_amount": None,
        "dose_param_delta": None,
        "dose_volume_L": None,
        "notes_key": notes_key,
        "amount_unit": "grams" if form == "solid" else "ml",
    }


# Dilution/partial drain-refill is the only fix for "too high" salt, hardness,
# CYA, and TA (and for excess chlorine/bromine) — there's no product to dose.
_DILUTION_GUIDANCE = {"guidance_only": True, "notes_key": "dosage_dilution_required"}

# One entry per WATER_PARAMS key that has an actionable treatment. cc and temp
# are deliberately absent: no universal dosing guidance applies to either.
TREATMENT_TABLE: Dict[str, Dict] = {
    "salt": {
        "raise": {"options": [_exact_option("pool_salt", "solid", 1000.0, 1000.0)]},
        "lower": _DILUTION_GUIDANCE,
    },
    "hardness": {
        "raise": {"options": [_exact_option("calcium_chloride", "solid", 15.0, 10.0, purity=0.77)]},
        "lower": _DILUTION_GUIDANCE,
    },
    "cya": {
        "raise": {
            "options": [
                _exact_option(
                    "cya_granular", "solid", 9.7, 10.0,
                    notes_key="dosage_cya_granular_test_lag",
                    side_effect={"kind": "cya_lowers_ph", "notes_key": "dosage_cya_lowers_ph_too"},
                ),
                # Same active-ingredient dose as granular -- liquid CYA is just cyanuric
                # acid pre-dissolved at a brand-specific concentration, so we state the
                # active mass needed (grams) rather than guessing a volume.
                _exact_option(
                    "cya_liquid", "liquid", 9.7, 10.0,
                    amount_unit="grams", notes_key="dosage_cya_liquid_active_grams",
                    side_effect={"kind": "cya_lowers_ph", "notes_key": "dosage_cya_lowers_ph_too"},
                ),
            ]
        },
        "lower": _DILUTION_GUIDANCE,
    },
    "tac": {
        "raise": {"options": [_exact_option(
            "baking_soda", "solid", 17.5, 10.0, purity=0.974,
            side_effect={"kind": "ph_toward_8_3", "notes_key": "dosage_baking_soda_raises_ph_too"},
        )]},
        "lower": _DILUTION_GUIDANCE,
    },
    "ph": {
        "raise": {
            "options": [
                _exact_option(
                    "soda_ash", "solid", 4.5, 0.2, notes_key="dosage_ph_approximate",
                    side_effect={"kind": "linear_ta", "delta_per_chunk": 5.0,
                                 "notes_key": "dosage_soda_ash_raises_ta_too"},
                ),
            ]
        },
        "lower": {
            "options": [
                _exact_option(
                    "muriatic_acid", "liquid", 25.0, 0.2, purity=0.3145,
                    side_effect={"kind": "linear_ta", "delta_per_chunk": -10.0,
                                 "notes_key": "dosage_ph_lowers_ta_too"},
                ),
                _inexact_option("dry_acid", "solid", notes_key="dosage_ph_lowers_ta_too"),
            ]
        },
    },
    "cl": {
        "raise": {
            "options": [
                _inexact_option("liquid_chlorine", "liquid", notes_key="dosage_chlorine_varies"),
                _inexact_option("cal_hypo", "solid", notes_key="dosage_chlorine_varies"),
                _inexact_option("dichlor", "solid", notes_key="dosage_chlorine_varies"),
            ]
        },
        "lower": _DILUTION_GUIDANCE,
    },
    "br": {
        "raise": {
            "options": [
                _inexact_option("bromine_tablets", "solid", notes_key="dosage_chlorine_varies"),
            ]
        },
        "lower": _DILUTION_GUIDANCE,
    },
}

# Salt pools generate chlorine via the SWG cell, not by dosing — replaces the
# "cl"/"raise" entry entirely when installation.sanitizer == "salt".
_SWG_RAISE_GUIDANCE = {"guidance_only": True, "notes_key": "dosage_increase_swg_runtime"}


def _volume_in_liters(installation: Installation) -> Optional[float]:
    if installation.volume is None:
        return None
    if installation.volume_unit == "gal":
        return installation.volume * GAL_TO_L
    return installation.volume


def _compute_side_effect(
    spec: Optional[Dict],
    delta: float,
    dose_param_delta: Optional[float],
    current_ta: Optional[float],
    current_ph: Optional[float],
) -> Optional[Dict]:
    """Resolves a TREATMENT_TABLE option's secondary-effect spec (issue #40) into a
    concrete {param, delta, notes_key}, or None if the option has no side effect.

    `delta` is how far the *primary* param is being moved (same value the amount math
    uses); `dose_param_delta` is that option's per-chunk primary step. The pH-shift
    kinds are water-chemistry-aware because a fixed "pH per ppm" is off by 2-3x across
    the normal TA range -- pH sensitivity scales roughly inversely with buffering (TA),
    so we lean on the measured TA/pH when we have them and fall back to typical values
    otherwise."""
    if not spec:
        return None
    kind = spec["kind"]

    if kind == "linear_ta":
        # Stoichiometric, volume-independent: the TA shift scales with the same dose
        # multiplier the primary amount uses. soda ash: +5 ppm TA per 0.2-pH chunk;
        # muriatic acid: -10 ppm TA per 0.2-pH chunk.
        multiplier = abs(delta) / dose_param_delta
        ta_shift = round(multiplier * spec["delta_per_chunk"], 1)
        return {"param": "tac", "delta": ta_shift, "notes_key": spec["notes_key"]}

    if kind == "ph_toward_8_3":
        # Adding bicarbonate (baking soda) pulls pH toward its equilibrium ~8.3 by a
        # fraction set by how much buffer you add relative to what's already there.
        # Self-bounding: shrinks near 8.3, and can go negative if pH already exceeds it.
        ta_delta = abs(delta)
        ta_before = current_ta if current_ta is not None else 90.0
        ph_eff = current_ph if current_ph is not None else 7.5
        dph = round((8.3 - ph_eff) * (ta_delta / (ta_before + ta_delta)), 2)
        return {"param": "ph", "delta": dph, "notes_key": spec["notes_key"]}

    if kind == "cya_lowers_ph":
        # Cyanuric acid is mildly acidic; the pH drop scales inversely with TA (buffer).
        # Anchored on -0.19 pH per 10 ppm CYA at TA 120. First-order only, so clamp the
        # magnitude to <=0.5 pH to avoid an unphysical extrapolation at low TA / big adds.
        ta_eff = current_ta if current_ta is not None else 90.0
        dph = -0.19 * (120.0 / ta_eff) * (abs(delta) / 10.0)
        dph = max(-0.5, min(0.5, dph))
        return {"param": "ph", "delta": round(dph, 2), "notes_key": spec["notes_key"]}

    return None


def _options_with_amounts(
    options: List[Dict],
    delta: float,
    volume_L: Optional[float],
    current_ta: Optional[float] = None,
    current_ph: Optional[float] = None,
) -> List[Dict]:
    """Computes amount_grams/amount_ml for each TREATMENT_TABLE option, given how far the
    param needs to move (delta) and the installation's volume. Shared by
    compute_recommendations (delta from a stored reading) and simulate_dosage (delta from
    user-supplied what-if values) so the dosing math lives in exactly one place."""
    options_out = []
    for opt in options:
        amount = None
        if opt["exact"] and volume_L is not None:
            amount = round(
                opt["dose_amount"] * (abs(delta) / opt["dose_param_delta"]) * (volume_L / opt["dose_volume_L"]),
                2,
            )
        options_out.append({
            "product_id": opt["product_id"],
            "form": opt["form"],
            "exact": opt["exact"],
            "amount_grams": amount if amount is not None and opt["amount_unit"] == "grams" else None,
            "amount_ml": amount if amount is not None and opt["amount_unit"] == "ml" else None,
            "notes_key": opt.get("notes_key"),
            "side_effect": _compute_side_effect(
                opt.get("side_effect"), delta, opt.get("dose_param_delta"), current_ta, current_ph,
            ),
        })
    return options_out


def _guidance_only_recommendation(
    param: str, current_value: float, target_value: float, direction: str,
    volume_known: bool, notes_key: str,
) -> Dict:
    return {
        "param": param,
        "current_value": current_value,
        "target_value": target_value,
        "direction": direction,
        "volume_known": volume_known,
        "options": [{
            "product_id": None,
            "form": None,
            "exact": False,
            "amount_grams": None,
            "amount_ml": None,
            "notes_key": notes_key,
            "side_effect": None,
        }],
    }


def compute_recommendations(current: Dict, ranges: Dict, installation: Installation) -> List[Dict]:
    """For each param in `ranges` whose `current` value falls outside its
    ideal band, returns a dosing recommendation — matching the dashboard's
    "Watch" status, which also fires on leaving the ideal (not acceptable)
    band. Params with no known current value, or that are within their ideal
    band, are omitted entirely. Never invents amounts for non-exact products
    or when the installation's volume isn't set — `amount_grams`/`amount_ml`
    are None in those cases."""
    volume_L = _volume_in_liters(installation)
    volume_known = volume_L is not None

    # Measured TA/pH drive the water-chemistry-aware pH side-effect estimates (issue #40);
    # None when the reading lacks them, in which case _compute_side_effect falls back to
    # typical values.
    ta_entry = current.get("tac")
    current_ta = ta_entry["value"] if ta_entry else None
    ph_entry = current.get("ph")
    current_ph = ph_entry["value"] if ph_entry else None

    recommendations: List[Dict] = []
    for param, bands in ranges.items():
        acceptable = bands.get("acceptable")
        ideal = bands.get("ideal")
        if not acceptable or not ideal:
            continue

        current_field = RANGE_TO_CURRENT_FIELD.get(param)
        if current_field is None:
            continue
        current_entry = current.get(current_field)
        if current_entry is None:
            continue
        current_value = current_entry["value"]

        lo, hi = ideal
        if lo <= current_value <= hi:
            continue
        direction = "raise" if current_value < lo else "lower"
        target_value = (ideal[0] + ideal[1]) / 2
        delta = target_value - current_value

        if param == "cl" and direction == "raise" and installation.sanitizer == "salt":
            direction_entry = _SWG_RAISE_GUIDANCE
        else:
            table_entry = TREATMENT_TABLE.get(param)
            if table_entry is None:
                continue
            direction_entry = table_entry.get(direction)
            if direction_entry is None:
                continue

        if direction_entry.get("guidance_only"):
            recommendations.append(_guidance_only_recommendation(
                param, current_value, target_value, direction, volume_known,
                direction_entry["notes_key"],
            ))
            continue

        options_out = _options_with_amounts(
            direction_entry["options"], delta, volume_L, current_ta, current_ph,
        )

        recommendations.append({
            "param": param,
            "current_value": current_value,
            "target_value": target_value,
            "direction": direction,
            "volume_known": volume_known,
            "options": options_out,
        })

    return recommendations

from datetime import date

from dosage import compute_recommendations
from main import WATER_PARAMS
from models import Installation


def make_installation(**kwargs) -> Installation:
    defaults = dict(user_id=1, type="pool", sanitizer="chlorine", volume=10000, volume_unit="L")
    defaults.update(kwargs)
    return Installation(**defaults)


def current_of(**values) -> dict:
    return {field: {"value": v, "date": date.today(), "unit": None} for field, v in values.items()}


def ranges_for(installation: Installation) -> dict:
    return WATER_PARAMS[(installation.type, installation.sanitizer)]


def test_salt_raise_is_stoichiometric():
    # PoolMath's rule of thumb: 8.34 lb of salt per 1000 US gal raises salt by 1000 ppm.
    # In metric terms that's ~1000 g per 1000 L per 1000 ppm -- exactly our dose rate.
    installation = make_installation(sanitizer="salt", volume=1000, volume_unit="L")
    ranges = ranges_for(installation)
    current = current_of(salt=2000, ph=7.4, stabilizer=70, chlorine=4.0)
    recs = compute_recommendations(current, ranges, installation)
    salt_rec = next(r for r in recs if r["param"] == "salt")
    assert salt_rec["direction"] == "raise"
    option = salt_rec["options"][0]
    assert option["product_id"] == "pool_salt"
    # target midpoint of ideal (2700, 3400) = 3050; delta = 1050 ppm over 1000 L
    assert option["amount_grams"] == 1050.0


def test_tac_raise_baking_soda():
    installation = make_installation(sanitizer="bromine", volume=1000, volume_unit="L")
    ranges = ranges_for(installation)
    current = current_of(tac=50, ph=7.4, bromine=3.0)
    recs = compute_recommendations(current, ranges, installation)
    tac_rec = next(r for r in recs if r["param"] == "tac")
    assert tac_rec["direction"] == "raise"
    # ideal midpoint (80, 180) = 130; delta = 80 ppm; 17.5g / 10ppm / 1000L * 80/10 * 1 = 140.0g
    assert tac_rec["options"][0]["amount_grams"] == 140.0
    assert tac_rec["options"][0]["exact"] is True


def test_ph_raise_soda_ash_tagged_approximate():
    installation = make_installation(sanitizer="chlorine", volume=1000, volume_unit="L")
    ranges = ranges_for(installation)
    current = current_of(ph=6.5, chlorine=2.0, tac=100)
    recs = compute_recommendations(current, ranges, installation)
    ph_rec = next(r for r in recs if r["param"] == "ph")
    assert ph_rec["direction"] == "raise"
    option = ph_rec["options"][0]
    assert option["product_id"] == "soda_ash"
    assert option["notes_key"] == "dosage_ph_approximate"
    assert option["amount_grams"] is not None


def test_ph_lower_muriatic_acid_tagged_ta_side_effect():
    installation = make_installation(sanitizer="chlorine", volume=1000, volume_unit="L")
    ranges = ranges_for(installation)
    current = current_of(ph=8.2, chlorine=2.0, tac=100)
    recs = compute_recommendations(current, ranges, installation)
    ph_rec = next(r for r in recs if r["param"] == "ph")
    assert ph_rec["direction"] == "lower"
    exact_option = next(o for o in ph_rec["options"] if o["exact"])
    assert exact_option["product_id"] == "muriatic_acid"
    assert exact_option["amount_ml"] is not None
    # ph 8.2 -> target 7.4: delta -0.8 = 4 chunks of 0.2; -10 ppm TA/chunk => -40.0 ppm.
    assert exact_option["side_effect"] == {
        "param": "tac", "delta": -40.0, "notes_key": "dosage_ph_lowers_ta_too",
    }
    # dry acid is guidance-only but still carries the directional -TA note (no number).
    inexact_option = next(o for o in ph_rec["options"] if not o["exact"])
    assert inexact_option["notes_key"] == "dosage_ph_lowers_ta_too"
    assert inexact_option["amount_grams"] is None
    assert inexact_option["side_effect"] is None


def test_soda_ash_raise_reports_ta_side_effect():
    installation = make_installation(sanitizer="chlorine", volume=1000, volume_unit="L")
    ranges = ranges_for(installation)
    current = current_of(ph=6.5, chlorine=2.0, tac=100)
    recs = compute_recommendations(current, ranges, installation)
    ph_rec = next(r for r in recs if r["param"] == "ph")
    assert ph_rec["direction"] == "raise"
    option = next(o for o in ph_rec["options"] if o["product_id"] == "soda_ash")
    # ph 6.5 -> target 7.4: delta +0.9 = 4.5 chunks of 0.2; +5 ppm TA/chunk => +22.5 ppm.
    assert option["side_effect"] == {
        "param": "tac", "delta": 22.5, "notes_key": "dosage_soda_ash_raises_ta_too",
    }


def test_baking_soda_raise_reports_ph_side_effect():
    installation = make_installation(sanitizer="chlorine", volume=1000, volume_unit="L")
    ranges = ranges_for(installation)
    # tac 50 -> target 130 (ideal midpoint): ta_delta 80. pH 7.2.
    recs = compute_recommendations(current_of(tac=50, ph=7.2, chlorine=2.0), ranges, installation)
    tac_rec = next(r for r in recs if r["param"] == "tac")
    option = tac_rec["options"][0]
    # (8.3 - 7.2) * 80/(50+80) = 1.1 * 0.6154 = 0.68
    assert option["side_effect"] == {
        "param": "ph", "delta": 0.68, "notes_key": "dosage_baking_soda_raises_ph_too",
    }
    # Same TA add but a higher measured pH => a smaller nudge (uses the reading, not a constant).
    recs_high = compute_recommendations(current_of(tac=50, ph=7.8, chlorine=2.0), ranges, installation)
    option_high = next(r for r in recs_high if r["param"] == "tac")["options"][0]
    assert option_high["side_effect"]["delta"] == 0.31
    assert option_high["side_effect"]["delta"] < option["side_effect"]["delta"]


def test_cya_raise_reports_ph_side_effect_ta_scaled():
    installation = make_installation(sanitizer="salt", volume=1000, volume_unit="L")
    ranges = ranges_for(installation)
    # cya 50 -> target 70 (ideal midpoint): +20 ppm CYA. Vary the measured TA.
    recs = compute_recommendations(
        current_of(stabilizer=50, tac=120, ph=7.5, salt=3000, chlorine=4.0), ranges, installation)
    cya_rec = next(r for r in recs if r["param"] == "cya")
    for opt in cya_rec["options"]:
        # -0.19 * (120/120) * (20/10) = -0.38, present on both granular and liquid.
        assert opt["side_effect"] == {
            "param": "ph", "delta": -0.38, "notes_key": "dosage_cya_lowers_ph_too",
        }
    # Doubling the TA halves the pH drop (inverse scaling).
    recs_high_ta = compute_recommendations(
        current_of(stabilizer=50, tac=240, ph=7.5, salt=3000, chlorine=4.0), ranges, installation)
    high_ta_opt = next(r for r in recs_high_ta if r["param"] == "cya")["options"][0]
    assert high_ta_opt["side_effect"]["delta"] == -0.19
    # Very low TA would extrapolate past -0.5 pH; the model clamps the magnitude.
    recs_low_ta = compute_recommendations(
        current_of(stabilizer=50, tac=40, ph=7.5, salt=3000, chlorine=4.0), ranges, installation)
    low_ta_opt = next(r for r in recs_low_ta if r["param"] == "cya")["options"][0]
    assert low_ta_opt["side_effect"]["delta"] == -0.5


def test_side_effect_present_without_volume():
    installation = make_installation(sanitizer="chlorine", volume=None)
    ranges = ranges_for(installation)
    current = current_of(ph=8.2, chlorine=2.0, tac=100)
    recs = compute_recommendations(current, ranges, installation)
    ph_rec = next(r for r in recs if r["param"] == "ph")
    exact_option = next(o for o in ph_rec["options"] if o["exact"])
    # No volume => no amount, but the stoichiometric TA side effect is still reported.
    assert exact_option["amount_ml"] is None
    assert exact_option["side_effect"]["param"] == "tac"
    assert exact_option["side_effect"]["delta"] == -40.0


def test_no_side_effect_for_plain_products():
    installation = make_installation(sanitizer="salt", volume=1000, volume_unit="L")
    ranges = ranges_for(installation)
    current = current_of(salt=2000, ph=7.4, stabilizer=70, chlorine=4.0)
    recs = compute_recommendations(current, ranges, installation)
    salt_rec = next(r for r in recs if r["param"] == "salt")
    assert salt_rec["options"][0]["side_effect"] is None


def test_missing_volume_returns_none_amounts_without_error():
    installation = make_installation(sanitizer="bromine", volume=None)
    ranges = ranges_for(installation)
    current = current_of(tac=50, ph=7.4, bromine=3.0)
    recs = compute_recommendations(current, ranges, installation)
    assert recs  # still generated
    tac_rec = next(r for r in recs if r["param"] == "tac")
    assert tac_rec["volume_known"] is False
    assert tac_rec["options"][0]["amount_grams"] is None


def test_watch_tier_param_still_triggers_recommendation():
    # TAC 190 is inside the acceptable band (60, 200) but outside the tighter
    # ideal band (80, 180) -- the dashboard's "Watch" badge already fires here,
    # so a recommendation must be generated too (previously silently skipped).
    installation = make_installation(sanitizer="bromine", volume=1000, volume_unit="L")
    ranges = ranges_for(installation)
    current = current_of(ph=7.4, bromine=3.0, tac=190, temp=26, hardness=300)
    recs = compute_recommendations(current, ranges, installation)
    tac_rec = next(r for r in recs if r["param"] == "tac")
    assert tac_rec["direction"] == "lower"


def test_in_range_param_excluded():
    installation = make_installation(sanitizer="bromine", volume=1000, volume_unit="L")
    ranges = ranges_for(installation)
    current = current_of(ph=7.4, bromine=3.0, tac=100, temp=26, hardness=300)
    recs = compute_recommendations(current, ranges, installation)
    assert recs == []


def test_salt_pool_chlorine_uses_swg_guidance_not_product():
    installation = make_installation(sanitizer="salt", volume=1000, volume_unit="L")
    ranges = ranges_for(installation)
    current = current_of(ph=7.4, salt=3000, stabilizer=70, chlorine=1.0)
    recs = compute_recommendations(current, ranges, installation)
    cl_rec = next(r for r in recs if r["param"] == "cl")
    assert cl_rec["direction"] == "raise"
    option = cl_rec["options"][0]
    assert option["product_id"] is None
    assert option["notes_key"] == "dosage_increase_swg_runtime"


def test_cya_raise_liquid_states_active_grams_not_ml():
    # Liquid CYA is the same active ingredient as granular, just pre-dissolved at a
    # brand-specific concentration -- so it should state the same active-mass dose in
    # grams (not a guessed mL volume), with its own caveat note.
    installation = make_installation(sanitizer="salt", volume=1000, volume_unit="L")
    ranges = ranges_for(installation)
    current = current_of(ph=7.4, salt=3000, stabilizer=40, chlorine=4.0)
    recs = compute_recommendations(current, ranges, installation)
    cya_rec = next(r for r in recs if r["param"] == "cya")
    granular = next(o for o in cya_rec["options"] if o["product_id"] == "cya_granular")
    liquid = next(o for o in cya_rec["options"] if o["product_id"] == "cya_liquid")
    assert granular["notes_key"] == "dosage_cya_granular_test_lag"
    assert liquid["notes_key"] == "dosage_cya_liquid_active_grams"
    assert liquid["amount_grams"] == granular["amount_grams"] == 29.1
    assert liquid["amount_ml"] is None


def test_high_salt_is_guidance_only_dilution():
    installation = make_installation(sanitizer="salt", volume=1000, volume_unit="L")
    ranges = ranges_for(installation)
    current = current_of(ph=7.4, salt=5000, stabilizer=70, chlorine=4.0)
    recs = compute_recommendations(current, ranges, installation)
    salt_rec = next(r for r in recs if r["param"] == "salt")
    assert salt_rec["direction"] == "lower"
    option = salt_rec["options"][0]
    assert option["product_id"] is None
    assert option["notes_key"] == "dosage_dilution_required"

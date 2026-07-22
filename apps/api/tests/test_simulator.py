import pytest

from simulator import simulate_dosage, simulate_heating_energy


def test_simulate_dosage_tac_raise_baking_soda():
    # Same stoichiometry as test_dosage.py's test_tac_raise_baking_soda, but driven by
    # freestyle inputs instead of a stored installation reading.
    result = simulate_dosage("tac", current_value=50, target_value=130, volume_L=1000, sanitizer="bromine")
    assert result["direction"] == "raise"
    assert result["options"][0]["amount_grams"] == 140.0
    assert result["options"][0]["exact"] is True


def test_simulate_dosage_salt_raise_is_stoichiometric():
    result = simulate_dosage("salt", current_value=2000, target_value=3050, volume_L=1000, sanitizer="salt")
    assert result["direction"] == "raise"
    assert result["options"][0]["amount_grams"] == 1050.0


def test_simulate_dosage_lower_direction():
    result = simulate_dosage("ph", current_value=8.2, target_value=7.4, volume_L=1000, sanitizer="chlorine")
    assert result["direction"] == "lower"
    exact_option = next(o for o in result["options"] if o["exact"])
    assert exact_option["product_id"] == "muriatic_acid"
    assert exact_option["amount_ml"] is not None


def test_simulate_dosage_soda_ash_reports_ta_side_effect():
    result = simulate_dosage("ph", current_value=6.5, target_value=7.4, volume_L=1000, sanitizer="chlorine")
    option = next(o for o in result["options"] if o["product_id"] == "soda_ash")
    # delta +0.9 = 4.5 chunks of 0.2; +5 ppm TA/chunk => +22.5 ppm.
    assert option["side_effect"] == {
        "param": "tac", "delta": 22.5, "notes_key": "dosage_soda_ash_raises_ta_too",
    }


def test_simulate_dosage_muriatic_reports_ta_side_effect():
    result = simulate_dosage("ph", current_value=8.2, target_value=7.4, volume_L=1000, sanitizer="chlorine")
    exact_option = next(o for o in result["options"] if o["exact"])
    # delta -0.8 = 4 chunks of 0.2; -10 ppm TA/chunk => -40.0 ppm.
    assert exact_option["side_effect"] == {
        "param": "tac", "delta": -40.0, "notes_key": "dosage_ph_lowers_ta_too",
    }


def test_simulate_dosage_baking_soda_ph_side_effect_uses_defaults():
    # The simulator has only the tac value; current_value IS the current TA, pH defaults to 7.5.
    result = simulate_dosage("tac", current_value=50, target_value=130, volume_L=1000, sanitizer="bromine")
    option = result["options"][0]
    # (8.3 - 7.5) * 80/(50+80) = 0.8 * 0.6154 = 0.49
    assert option["side_effect"] == {
        "param": "ph", "delta": 0.49, "notes_key": "dosage_baking_soda_raises_ph_too",
    }


def test_simulate_dosage_salt_pool_chlorine_uses_swg_guidance():
    result = simulate_dosage("cl", current_value=1.0, target_value=4.0, volume_L=1000, sanitizer="salt")
    assert result["direction"] == "raise"
    option = result["options"][0]
    assert option["product_id"] is None
    assert option["notes_key"] == "dosage_increase_swg_runtime"


def test_simulate_dosage_dilution_guidance_only():
    result = simulate_dosage("salt", current_value=5000, target_value=3050, volume_L=1000, sanitizer="salt")
    assert result["direction"] == "lower"
    option = result["options"][0]
    assert option["product_id"] is None
    assert option["notes_key"] == "dosage_dilution_required"


def test_simulate_dosage_same_value_raises():
    with pytest.raises(ValueError):
        simulate_dosage("ph", current_value=7.4, target_value=7.4, volume_L=1000, sanitizer="chlorine")


def test_simulate_dosage_unsupported_param_raises():
    with pytest.raises(ValueError):
        simulate_dosage("temp", current_value=20, target_value=28, volume_L=1000, sanitizer="chlorine")


def test_simulate_heating_energy_matches_hand_calc():
    # 10,000 L raised 5C at 90% efficiency ~= 64.6 kWh.
    result = simulate_heating_energy(volume_L=10000, current_temp_c=20, target_temp_c=25, efficiency=0.9)
    assert result["kwh"] == pytest.approx(64.6, abs=0.1)
    assert result["delta_temp_c"] == 5
    assert result["efficiency"] == 0.9


def test_simulate_heating_energy_negative_delta_for_cooling():
    result = simulate_heating_energy(volume_L=1000, current_temp_c=30, target_temp_c=28)
    assert result["kwh"] < 0
    assert result["delta_temp_c"] == -2

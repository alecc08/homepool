import copy
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

import database
from main import WATER_PARAMS, _merge_range_overrides, app
from models import Product

TODAY = date.today().isoformat()


@pytest.fixture
def water_params_snapshot():
    """Deep-copies WATER_PARAMS before the test and restores it after, so
    range-override tests can't leak mutations into other tests in the session
    (main — and WATER_PARAMS — is imported once and shared session-wide)."""
    original = copy.deepcopy(WATER_PARAMS)
    yield
    WATER_PARAMS.clear()
    WATER_PARAMS.update(copy.deepcopy(original))


def login(client: TestClient):
    r = client.post(
        "/auth/login",
        json={"email": "admin@example.com", "password": "admin123"},
    )
    assert r.status_code == 200


def test_health(client: TestClient):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_get_products_empty(client: TestClient):
    login(client)
    r = client.get("/products")
    assert r.status_code == 200
    assert r.json() == []


def test_get_actions_empty(client: TestClient):
    login(client)
    r = client.get("/actions")
    assert r.status_code == 200
    assert r.json() == []


def test_create_action_structured(client: TestClient):
    login(client)
    payload = {
        "date": TODAY,
        "action_type": "Add chlorine",
        "product_id": None,
        "qty": "60",
        "unit": "g",
        "notes": "",
    }
    r = client.post("/actions", json=payload)
    assert r.status_code == 200
    data = r.json()
    assert data["action_type"] == "Add chlorine"
    assert data["qty"] == "60"
    assert data["unit"] == "g"
    assert data["product_id"] is None
    assert "id" in data
    assert "created_at" in data


def test_list_actions_returns_structured(client: TestClient):
    login(client)
    client.post("/actions", json={"date": TODAY, "action_type": "Test", "notes": "note"})
    r = client.get("/actions")
    actions = r.json()
    assert len(actions) == 1
    assert actions[0]["action_type"] == "Test"
    assert actions[0]["notes"] == "note"


def test_delete_action(client: TestClient):
    login(client)
    r = client.post("/actions", json={"date": TODAY, "action_type": "To delete", "notes": ""})
    action_id = r.json()["id"]
    del_r = client.delete(f"/actions/{action_id}")
    assert del_r.status_code == 204
    assert client.get("/actions").json() == []


def test_delete_action_not_found(client: TestClient):
    login(client)
    r = client.delete("/actions/999")
    assert r.status_code == 404


# ── Installations / sanitizer ───────────────────────────────────────────────

def test_create_installation_salt_sanitizer(client: TestClient):
    login(client)
    r = client.post(
        "/installations",
        json={"name": "Salt pool", "type": "pool", "sanitizer": "salt"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["sanitizer"] == "salt"
    assert data["type"] == "pool"
    assert data["name"] == "Salt pool"


def test_patch_installation_sanitizer_to_salt(client: TestClient):
    login(client)
    r = client.post(
        "/installations",
        json={"name": "My pool", "type": "pool", "sanitizer": "chlorine"},
    )
    installation_id = r.json()["id"]
    patch_r = client.patch(
        f"/installations/{installation_id}",
        json={"sanitizer": "salt"},
    )
    assert patch_r.status_code == 200
    assert patch_r.json()["sanitizer"] == "salt"


def test_get_installation_params_pool_salt(client: TestClient):
    login(client)
    r = client.post(
        "/installations",
        json={"name": "Salt pool", "type": "pool", "sanitizer": "salt"},
    )
    installation_id = r.json()["id"]
    params_r = client.get(f"/installations/{installation_id}/params")
    assert params_r.status_code == 200
    params = params_r.json()
    assert params["salt"]["ideal"] == [2700, 3400]
    assert params["cya"]["ideal"] == [60, 80]
    assert params["cl"]["ideal"] == [3.0, 5.0]
    assert params["tac"]["ideal"] == [60, 80]
    assert params["hardness"]["ideal"] == [100, 500]
    assert "cc" in params


def test_get_installation_params_spa_salt(client: TestClient):
    login(client)
    r = client.post(
        "/installations",
        json={"name": "Salt spa", "type": "spa", "sanitizer": "salt"},
    )
    installation_id = r.json()["id"]
    params_r = client.get(f"/installations/{installation_id}/params")
    assert params_r.status_code == 200
    params = params_r.json()
    assert params["temp"]["ideal"] == [36, 40]
    assert params["salt"]["ideal"] == [2500, 3200]
    assert params["cya"]["ideal"] == [30, 50]
    assert params["tac"]["ideal"] == [60, 80]
    assert params["cl"]["ideal"] == [3.0, 5.0]
    assert params["hardness"]["ideal"] == [100, 500]


def test_get_installation_params_chlorine_includes_cc(client: TestClient):
    login(client)
    r = client.post(
        "/installations",
        json={"name": "Chlorine pool", "type": "pool", "sanitizer": "chlorine"},
    )
    installation_id = r.json()["id"]
    params_r = client.get(f"/installations/{installation_id}/params")
    assert "cc" in params_r.json()


def test_get_installation_params_bromine_excludes_cc(client: TestClient):
    login(client)
    r = client.post(
        "/installations",
        json={"name": "Bromine pool", "type": "pool", "sanitizer": "bromine"},
    )
    installation_id = r.json()["id"]
    params_r = client.get(f"/installations/{installation_id}/params")
    params = params_r.json()
    assert "cc" not in params
    assert "cya" not in params


def test_get_installation_params_unknown_sanitizer_returns_empty(client: TestClient):
    login(client)
    r = client.post(
        "/installations",
        json={"name": "Mystery", "type": "pool", "sanitizer": "unknown"},
    )
    installation_id = r.json()["id"]
    params_r = client.get(f"/installations/{installation_id}/params")
    assert params_r.status_code == 200
    assert params_r.json() == {}


# ── Per-installation range overrides ────────────────────────────────────────

def test_merge_range_overrides_applies_only_present_bands(water_params_snapshot):
    defaults = WATER_PARAMS[("pool", "salt")]
    merged = _merge_range_overrides(defaults, {"salt": {"ideal": [3600, 4400]}})
    assert merged["salt"]["ideal"] == (3600, 4400)
    assert merged["salt"]["acceptable"] == defaults["salt"]["acceptable"]
    # original untouched
    assert defaults["salt"]["ideal"] == (2700, 3400)


def test_merge_range_overrides_ignores_unknown_param(water_params_snapshot):
    defaults = WATER_PARAMS[("pool", "bromine")]
    merged = _merge_range_overrides(defaults, {"cl": {"ideal": [1.0, 3.0]}})
    assert "cl" not in merged


def test_merge_range_overrides_noop_without_overrides(water_params_snapshot):
    defaults = WATER_PARAMS[("pool", "salt")]
    assert _merge_range_overrides(defaults, None) == defaults
    assert _merge_range_overrides(defaults, {}) == defaults


def test_get_installation_params_reflects_overrides(client: TestClient):
    login(client)
    r = client.post("/installations", json={"name": "Salt pool", "type": "pool", "sanitizer": "salt"})
    installation_id = r.json()["id"]
    put_r = client.put(
        f"/installations/{installation_id}/params",
        json={"salt": {"ideal": [3600, 4400]}},
    )
    assert put_r.status_code == 200
    assert put_r.json()["salt"]["ideal"] == [3600, 4400]

    params_r = client.get(f"/installations/{installation_id}/params")
    assert params_r.json()["salt"]["ideal"] == [3600, 4400]
    assert params_r.json()["salt"]["acceptable"] == [2500, 4500]


def test_get_installation_params_full_shape(client: TestClient):
    login(client)
    r = client.post("/installations", json={"name": "Salt pool", "type": "pool", "sanitizer": "salt"})
    installation_id = r.json()["id"]
    client.put(f"/installations/{installation_id}/params", json={"salt": {"ideal": [3600, 4400]}})

    full_r = client.get(f"/installations/{installation_id}/params/full")
    assert full_r.status_code == 200
    full = full_r.json()
    assert full["salt"]["default"]["ideal"] == [2700, 3400]
    assert full["salt"]["override"] == {"ideal": [3600, 4400]}
    assert full["salt"]["effective"]["ideal"] == [3600, 4400]
    assert full["salt"]["effective"]["acceptable"] == [2500, 4500]
    assert full["ph"]["override"] is None


def test_put_installation_params_clears_with_empty_body(client: TestClient):
    login(client)
    r = client.post("/installations", json={"name": "Salt pool", "type": "pool", "sanitizer": "salt"})
    installation_id = r.json()["id"]
    client.put(f"/installations/{installation_id}/params", json={"salt": {"ideal": [3600, 4400]}})
    clear_r = client.put(f"/installations/{installation_id}/params", json={})
    assert clear_r.status_code == 200
    assert clear_r.json()["salt"]["ideal"] == [2700, 3400]


def test_put_installation_params_rejects_unknown_param(client: TestClient):
    login(client)
    r = client.post("/installations", json={"name": "Bromine pool", "type": "pool", "sanitizer": "bromine"})
    installation_id = r.json()["id"]
    put_r = client.put(f"/installations/{installation_id}/params", json={"cl": {"ideal": [1.0, 3.0]}})
    assert put_r.status_code == 400


def test_put_installation_params_rejects_min_gte_max(client: TestClient):
    login(client)
    r = client.post("/installations", json={"name": "Salt pool", "type": "pool", "sanitizer": "salt"})
    installation_id = r.json()["id"]
    put_r = client.put(f"/installations/{installation_id}/params", json={"salt": {"ideal": [4000, 3000]}})
    assert put_r.status_code == 400


def test_put_installation_params_rejects_ideal_outside_acceptable(client: TestClient):
    login(client)
    r = client.post("/installations", json={"name": "Salt pool", "type": "pool", "sanitizer": "salt"})
    installation_id = r.json()["id"]
    put_r = client.put(f"/installations/{installation_id}/params", json={"salt": {"ideal": [1000, 5000]}})
    assert put_r.status_code == 400


def test_put_installation_params_rejects_out_of_bounds(client: TestClient):
    login(client)
    r = client.post("/installations", json={"name": "My pool", "type": "pool", "sanitizer": "chlorine"})
    installation_id = r.json()["id"]
    put_r = client.put(f"/installations/{installation_id}/params", json={"ph": {"ideal": [-1, 20]}})
    assert put_r.status_code == 400


def test_put_installation_params_requires_ownership(client: TestClient):
    login(client)
    r = client.post("/installations", json={"name": "Salt pool", "type": "pool", "sanitizer": "salt"})
    installation_id = r.json()["id"]
    client.post("/auth/logout")
    r2 = client.post(
        "/auth/register",
        json={"first_name": "Other", "email": "other@example.com", "password": "OtherPass1"},
    )
    assert r2.status_code == 200
    put_r = client.put(f"/installations/{installation_id}/params", json={"salt": {"ideal": [3600, 4400]}})
    assert put_r.status_code == 404


def test_get_installation_params_full_requires_ownership(client: TestClient):
    login(client)
    r = client.post("/installations", json={"name": "Salt pool", "type": "pool", "sanitizer": "salt"})
    installation_id = r.json()["id"]
    client.post("/auth/logout")
    r2 = client.post(
        "/auth/register",
        json={"first_name": "Other", "email": "other@example.com", "password": "OtherPass1"},
    )
    assert r2.status_code == 200
    full_r = client.get(f"/installations/{installation_id}/params/full")
    assert full_r.status_code == 404


def test_put_installation_params_rejects_unknown_band(client: TestClient):
    login(client)
    r = client.post("/installations", json={"name": "Salt pool", "type": "pool", "sanitizer": "salt"})
    installation_id = r.json()["id"]
    put_r = client.put(f"/installations/{installation_id}/params", json={"salt": {"extreme": [3600, 4400]}})
    assert put_r.status_code == 400


def test_put_installation_params_rejects_wrong_length_band_value(client: TestClient):
    login(client)
    r = client.post("/installations", json={"name": "Salt pool", "type": "pool", "sanitizer": "salt"})
    installation_id = r.json()["id"]
    put_r = client.put(f"/installations/{installation_id}/params", json={"salt": {"ideal": [3600, 4000, 4400]}})
    assert put_r.status_code == 400


def test_create_installation_with_volume(client: TestClient):
    login(client)
    r = client.post(
        "/installations",
        json={"name": "My pool", "volume": 45000, "volume_unit": "L"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["volume"] == 45000
    assert data["volume_unit"] == "L"


def test_create_installation_without_volume_defaults_null(client: TestClient):
    login(client)
    r = client.post("/installations", json={"name": "My pool"})
    assert r.status_code == 200
    data = r.json()
    assert data["volume"] is None
    assert data["volume_unit"] == "L"


def test_patch_installation_volume(client: TestClient):
    login(client)
    r = client.post("/installations", json={"name": "My pool"})
    installation_id = r.json()["id"]
    patch_r = client.patch(
        f"/installations/{installation_id}",
        json={"volume": 60000, "volume_unit": "gal"},
    )
    assert patch_r.status_code == 200
    data = patch_r.json()
    assert data["volume"] == 60000
    assert data["volume_unit"] == "gal"


def test_create_installation_with_units(client: TestClient):
    login(client)
    r = client.post(
        "/installations",
        json={
            "name": "My pool",
            "temp_unit": "F",
            "salt_unit": "g/L",
            "conc_unit": "ppm",
            "hardness_unit": "°dH",
        },
    )
    assert r.status_code == 200
    data = r.json()
    assert data["temp_unit"] == "F"
    assert data["salt_unit"] == "g/L"
    assert data["conc_unit"] == "ppm"
    assert data["hardness_unit"] == "°dH"


def test_create_installation_without_units_defaults(client: TestClient):
    login(client)
    r = client.post("/installations", json={"name": "My pool"})
    assert r.status_code == 200
    data = r.json()
    assert data["temp_unit"] == "C"
    assert data["salt_unit"] == "ppm"
    assert data["conc_unit"] == "mg/L"
    assert data["hardness_unit"] == "ppm"


def test_patch_installation_units(client: TestClient):
    login(client)
    r = client.post("/installations", json={"name": "My pool"})
    installation_id = r.json()["id"]
    patch_r = client.patch(
        f"/installations/{installation_id}",
        json={"temp_unit": "F", "salt_unit": "g/L", "conc_unit": "ppm", "hardness_unit": "°f"},
    )
    assert patch_r.status_code == 200
    data = patch_r.json()
    assert data["temp_unit"] == "F"
    assert data["salt_unit"] == "g/L"
    assert data["conc_unit"] == "ppm"
    assert data["hardness_unit"] == "°f"


def test_delete_installation(client: TestClient):
    login(client)
    client.post("/installations", json={"name": "My pool"})
    r = client.post("/installations", json={"name": "Garden spa", "type": "spa"})
    installation_id = r.json()["id"]
    delete_r = client.delete(f"/installations/{installation_id}")
    assert delete_r.status_code == 204
    list_r = client.get("/installations")
    assert installation_id not in [i["id"] for i in list_r.json()]


def test_delete_installation_removes_its_actions(client: TestClient):
    login(client)
    client.post("/installations", json={"name": "My pool"})
    r = client.post("/installations", json={"name": "Garden spa", "type": "spa"})
    installation_id = r.json()["id"]
    action_r = client.post(
        "/actions",
        json={"date": TODAY, "action_type": "Measurement", "installation_id": installation_id},
    )
    action_id = action_r.json()["id"]
    client.delete(f"/installations/{installation_id}")
    actions_r = client.get("/actions")
    assert action_id not in [a["id"] for a in actions_r.json()]


def test_delete_last_installation_rejected(client: TestClient):
    login(client)
    r = client.post("/installations", json={"name": "My pool"})
    installation_id = r.json()["id"]
    delete_r = client.delete(f"/installations/{installation_id}")
    assert delete_r.status_code == 400


def test_delete_installation_not_found(client: TestClient):
    login(client)
    r = client.delete("/installations/999")
    assert r.status_code == 404


# ── Public API (Home Assistant, etc.) ───────────────────────────────────────

def get_api_key(client: TestClient) -> str:
    r = client.post("/me/api-key")
    assert r.status_code == 200
    return r.json()["key"]


def auth_headers(key: str) -> dict:
    return {"Authorization": f"Bearer {key}"}


def test_v1_installations_lists_owned_installations(client: TestClient):
    login(client)
    key = get_api_key(client)
    client.post("/installations", json={"name": "Backyard Pool", "type": "pool", "sanitizer": "salt"})
    client.post("/installations", json={"name": "Hot Tub", "type": "spa"})
    r = client.get("/v1/installations", headers=auth_headers(key))
    assert r.status_code == 200
    data = r.json()
    names = {i["name"]: i["type"] for i in data}
    assert names == {"Backyard Pool": "pool", "Hot Tub": "spa"}
    assert set(data[0].keys()) == {"id", "name", "type", "sanitizer"}
    sanitizers = {i["name"]: i["sanitizer"] for i in data}
    assert sanitizers["Backyard Pool"] == "salt"


def test_v1_installations_requires_api_key(client: TestClient):
    login(client)
    client.post("/installations", json={"name": "My pool"})
    r = client.get("/v1/installations")
    assert r.status_code == 401


def test_v1_current_includes_units(client: TestClient):
    login(client)
    key = get_api_key(client)
    inst_r = client.post(
        "/installations",
        json={"name": "My pool", "temp_unit": "F", "conc_unit": "ppm", "hardness_unit": "°f", "salt_unit": "g/L"},
    )
    installation_id = inst_r.json()["id"]
    client.post(
        "/actions",
        json={
            "date": TODAY,
            "action_type": "Measurement",
            "installation_id": installation_id,
            "notes": "pH 7.4 chlorine 3 TAC 80 hardness 200 salt 3200 stabilizer 40 combined 0.1 temperature 85",
        },
    )
    r = client.get(f"/v1/current?installation_id={installation_id}", headers=auth_headers(key))
    assert r.status_code == 200
    data = r.json()
    assert data["ph"]["unit"] is None
    assert data["chlorine"]["unit"] == "ppm"
    assert data["stabilizer"]["unit"] == "ppm"
    assert data["cc"]["unit"] == "ppm"
    assert data["tac"]["unit"] == "°f"
    assert data["hardness"]["unit"] == "°f"
    assert data["salt"]["unit"] == "g/L"
    assert data["temp"]["unit"] == "°F"


def test_v1_current_requires_api_key(client: TestClient):
    login(client)
    client.post("/installations", json={"name": "My pool"})
    r = client.get("/v1/current")
    assert r.status_code == 401


def test_v1_current_includes_status_and_ideal_range(client: TestClient):
    """ParamValueOut carries status/ideal_min/ideal_max/acceptable_min/
    acceptable_max (added for the Home Assistant card's status dots and
    gauge) — verifies ok/warn/danger classification and that the ranges
    mirror WATER_PARAMS' default pool+chlorine ph band."""
    login(client)
    key = get_api_key(client)
    inst_r = client.post("/installations", json={"name": "My pool", "sanitizer": "chlorine"})
    installation_id = inst_r.json()["id"]
    client.post(
        "/actions",
        json={
            "date": TODAY,
            "action_type": "Measurement",
            "installation_id": installation_id,
            "qty": "7.4",
            # chlorine 1.0-3.0 ideal / 0.5-4.0 acceptable, danger threshold below
            "notes": "chlorine: 6. TAC: 100.",
        },
    )
    r = client.get(f"/v1/current?installation_id={installation_id}", headers=auth_headers(key))
    assert r.status_code == 200
    data = r.json()
    assert data["ph"]["status"] == "ok"
    assert data["ph"]["ideal_min"] == pytest.approx(7.2)
    assert data["ph"]["ideal_max"] == pytest.approx(7.6)
    assert data["ph"]["acceptable_min"] == pytest.approx(6.8)
    assert data["ph"]["acceptable_max"] == pytest.approx(7.8)
    assert data["chlorine"]["status"] == "danger"
    assert data["chlorine"]["acceptable_min"] == pytest.approx(0.5)
    assert data["chlorine"]["acceptable_max"] == pytest.approx(4.0)


# ── /v1/todo ─────────────────────────────────────────────────────────────

def test_v1_todo_ph_days_until_due(client: TestClient):
    login(client)
    key = get_api_key(client)
    inst_r = client.post("/installations", json={"name": "My pool"})
    installation_id = inst_r.json()["id"]
    measured_date = (date.today() - timedelta(days=2)).isoformat()
    client.post(
        "/actions",
        json={
            "date": measured_date,
            "action_type": "Measurement",
            "installation_id": installation_id,
            "qty": "7.4",
        },
    )
    r = client.get(f"/v1/todo?installation_id={installation_id}", headers=auth_headers(key))
    assert r.status_code == 200
    data = r.json()
    assert data["ph_measurement"]["days_until_due"] == 5
    assert data["ph_measurement"]["last_date"] == measured_date


def test_v1_todo_ph_overdue_is_negative(client: TestClient):
    login(client)
    key = get_api_key(client)
    inst_r = client.post("/installations", json={"name": "My pool"})
    installation_id = inst_r.json()["id"]
    measured_date = (date.today() - timedelta(days=10)).isoformat()
    client.post(
        "/actions",
        json={
            "date": measured_date,
            "action_type": "Measurement",
            "installation_id": installation_id,
            "qty": "7.4",
        },
    )
    r = client.get(f"/v1/todo?installation_id={installation_id}", headers=auth_headers(key))
    assert r.status_code == 200
    assert r.json()["ph_measurement"]["days_until_due"] == -3


def test_v1_todo_never_measured_is_null(client: TestClient):
    login(client)
    key = get_api_key(client)
    inst_r = client.post("/installations", json={"name": "My pool"})
    installation_id = inst_r.json()["id"]
    r = client.get(f"/v1/todo?installation_id={installation_id}", headers=auth_headers(key))
    assert r.status_code == 200
    data = r.json()
    assert data["ph_measurement"]["days_until_due"] is None
    assert data["ph_measurement"]["last_date"] is None
    assert data["filter_maintenance"]["days_until_due"] is None
    assert data["filter_maintenance"]["last_date"] is None


def test_v1_todo_filter_maintenance_days_until_due(client: TestClient):
    login(client)
    key = get_api_key(client)
    inst_r = client.post("/installations", json={"name": "My pool"})
    installation_id = inst_r.json()["id"]
    done_date = (date.today() - timedelta(days=5)).isoformat()
    client.post(
        "/actions",
        json={
            "date": done_date,
            "action_type": "Cartridge cleaning",
            "installation_id": installation_id,
        },
    )
    r = client.get(f"/v1/todo?installation_id={installation_id}", headers=auth_headers(key))
    assert r.status_code == 200
    data = r.json()
    assert data["filter_maintenance"]["days_until_due"] == 9
    assert data["filter_maintenance"]["last_date"] == done_date


def test_v1_todo_requires_api_key(client: TestClient):
    login(client)
    client.post("/installations", json={"name": "My pool"})
    r = client.get("/v1/todo")
    assert r.status_code == 401


# ── /v1/measurements ─────────────────────────────────────────────────────

def test_v1_create_measurement_is_readable_back(client: TestClient):
    login(client)
    key = get_api_key(client)
    inst_r = client.post("/installations", json={"name": "My pool"})
    installation_id = inst_r.json()["id"]

    r = client.post(
        "/v1/measurements",
        headers=auth_headers(key),
        json={"installation_id": installation_id, "ph": 7.4, "chlorine": 3, "salt": 3200},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["action_type"] == "Measurement"
    assert body["qty"] == "7.4"

    current = client.get(f"/v1/current?installation_id={installation_id}", headers=auth_headers(key))
    data = current.json()
    assert data["ph"]["value"] == 7.4
    assert data["chlorine"]["value"] == 3
    assert data["salt"]["value"] == 3200


def test_v1_create_measurement_requires_at_least_one_value(client: TestClient):
    login(client)
    key = get_api_key(client)
    client.post("/installations", json={"name": "My pool"})
    r = client.post("/v1/measurements", headers=auth_headers(key), json={})
    assert r.status_code == 422


def test_v1_create_measurement_requires_api_key(client: TestClient):
    login(client)
    client.post("/installations", json={"name": "My pool"})
    r = client.post("/v1/measurements", json={"ph": 7.4})
    assert r.status_code == 401


# ── /v1/maintenance ──────────────────────────────────────────────────────

def test_v1_create_maintenance_is_readable_back(client: TestClient):
    login(client)
    key = get_api_key(client)
    inst_r = client.post("/installations", json={"name": "My pool"})
    installation_id = inst_r.json()["id"]

    r = client.post(
        "/v1/maintenance",
        headers=auth_headers(key),
        json={"installation_id": installation_id, "action_type": "Backwash"},
    )
    assert r.status_code == 200
    assert r.json()["action_type"] == "Backwash"

    todo = client.get(f"/v1/todo?installation_id={installation_id}", headers=auth_headers(key))
    assert todo.json()["filter_maintenance"]["days_until_due"] == 14


def test_v1_create_maintenance_rejects_unknown_action_type(client: TestClient):
    login(client)
    key = get_api_key(client)
    client.post("/installations", json={"name": "My pool"})
    r = client.post(
        "/v1/maintenance",
        headers=auth_headers(key),
        json={"action_type": "Add product"},
    )
    assert r.status_code == 422


def test_v1_create_maintenance_requires_api_key(client: TestClient):
    login(client)
    client.post("/installations", json={"name": "My pool"})
    r = client.post("/v1/maintenance", json={"action_type": "Backwash"})
    assert r.status_code == 401


# ── /v1/history ──────────────────────────────────────────────────────────

def test_v1_history_returns_all_kinds_newest_first(client: TestClient):
    login(client)
    key = get_api_key(client)
    inst_r = client.post("/installations", json={"name": "My pool"})
    installation_id = inst_r.json()["id"]
    day = lambda n: (date.today() - timedelta(days=n)).isoformat()  # noqa: E731
    client.post("/actions", json={
        "date": day(2), "action_type": "Measurement", "installation_id": installation_id,
        "qty": "7.4", "notes": "chlorine: 3. TAC: 80.",
    })
    client.post("/actions", json={
        "date": day(1), "action_type": "Backwash", "installation_id": installation_id, "notes": "rinsed",
    })
    client.post("/actions", json={
        "date": day(0), "action_type": "Add product", "installation_id": installation_id,
        "qty": "200", "unit": "g", "notes": "shock",
    })

    r = client.get(f"/v1/history?installation_id={installation_id}", headers=auth_headers(key))
    assert r.status_code == 200
    entries = r.json()
    assert [e["kind"] for e in entries] == ["treatment", "maintenance", "measurement"]

    treatment, maintenance, measurement = entries
    assert treatment["qty"] == "200"
    assert treatment["unit"] == "g"
    assert treatment["notes"] == "shock"
    assert maintenance["label"] == "Backwash"
    assert measurement["ph"] == 7.4
    assert measurement["chlorine"] == 3
    assert measurement["tac"] == 80


def test_v1_history_type_filter(client: TestClient):
    login(client)
    key = get_api_key(client)
    inst_r = client.post("/installations", json={"name": "My pool"})
    installation_id = inst_r.json()["id"]
    client.post("/actions", json={
        "date": TODAY, "action_type": "Measurement", "installation_id": installation_id, "qty": "7.4",
    })
    client.post("/actions", json={
        "date": TODAY, "action_type": "Backwash", "installation_id": installation_id,
    })

    r = client.get(
        f"/v1/history?installation_id={installation_id}&type=maintenance",
        headers=auth_headers(key),
    )
    assert r.status_code == 200
    entries = r.json()
    assert len(entries) == 1
    assert entries[0]["kind"] == "maintenance"
    assert entries[0]["action_type"] == "Backwash"


def test_v1_history_treatment_label_resolves_product_name(client: TestClient):
    login(client)
    key = get_api_key(client)
    inst_r = client.post("/installations", json={"name": "My pool"})
    installation_id = inst_r.json()["id"]

    # No product-creation endpoint exists; insert one straight into the test
    # DB via the same session the app is overridden to use.
    session = next(app.dependency_overrides[database.get_session]())
    product = Product(name="Chlore choc", type="seed", unit_default="g")
    session.add(product)
    session.commit()
    session.refresh(product)

    client.post("/actions", json={
        "date": TODAY, "action_type": "Add product", "installation_id": installation_id,
        "product_id": product.id, "qty": "200", "unit": "g",
    })

    r = client.get(f"/v1/history?installation_id={installation_id}", headers=auth_headers(key))
    assert r.status_code == 200
    entries = r.json()
    assert entries[0]["kind"] == "treatment"
    assert entries[0]["label"] == "Chlore choc"


def test_v1_history_date_range_and_limit(client: TestClient):
    login(client)
    key = get_api_key(client)
    inst_r = client.post("/installations", json={"name": "My pool"})
    installation_id = inst_r.json()["id"]
    for n in range(5):
        client.post("/actions", json={
            "date": (date.today() - timedelta(days=n)).isoformat(),
            "action_type": "Backwash", "installation_id": installation_id,
        })

    from_date = (date.today() - timedelta(days=3)).isoformat()
    to_date = (date.today() - timedelta(days=1)).isoformat()
    r = client.get(
        f"/v1/history?installation_id={installation_id}&from_date={from_date}&to_date={to_date}",
        headers=auth_headers(key),
    )
    assert r.status_code == 200
    dates = [e["date"] for e in r.json()]
    assert dates == [
        (date.today() - timedelta(days=1)).isoformat(),
        (date.today() - timedelta(days=2)).isoformat(),
        (date.today() - timedelta(days=3)).isoformat(),
    ]

    r_limited = client.get(
        f"/v1/history?installation_id={installation_id}&limit=2",
        headers=auth_headers(key),
    )
    assert len(r_limited.json()) == 2


def test_v1_history_requires_api_key(client: TestClient):
    login(client)
    client.post("/installations", json={"name": "My pool"})
    r = client.get("/v1/history")
    assert r.status_code == 401


def test_get_installation_recommendations_requires_auth(client: TestClient):
    r = client.get("/installations/1/recommendations")
    assert r.status_code == 401


def test_get_installation_recommendations_requires_ownership(client: TestClient):
    login(client)
    r = client.post("/installations", json={"name": "Salt pool", "type": "pool", "sanitizer": "salt"})
    installation_id = r.json()["id"]
    client.post("/auth/logout")
    r2 = client.post(
        "/auth/register",
        json={"first_name": "Other", "email": "other@example.com", "password": "OtherPass1"},
    )
    assert r2.status_code == 200
    rec_r = client.get(f"/installations/{installation_id}/recommendations")
    assert rec_r.status_code == 404


def test_get_installation_recommendations_shape(client: TestClient):
    login(client)
    r = client.post(
        "/installations",
        json={"name": "My pool", "type": "pool", "sanitizer": "bromine", "volume": 10000, "volume_unit": "L"},
    )
    installation_id = r.json()["id"]
    client.post(
        "/actions",
        json={
            "date": TODAY,
            "action_type": "Measurement",
            "installation_id": installation_id,
            "notes": "pH 7.4 bromine 3 TAC 50 hardness 300",
        },
    )
    rec_r = client.get(f"/installations/{installation_id}/recommendations")
    assert rec_r.status_code == 200
    data = rec_r.json()
    assert data["volume_known"] is True
    assert isinstance(data["recommendations"], list)
    tac_rec = next(r for r in data["recommendations"] if r["param"] == "tac")
    assert tac_rec["direction"] == "raise"
    assert tac_rec["options"][0]["amount_grams"] is not None


def test_get_installation_recommendations_without_volume(client: TestClient):
    login(client)
    r = client.post("/installations", json={"name": "My pool", "type": "pool", "sanitizer": "bromine"})
    installation_id = r.json()["id"]
    client.post(
        "/actions",
        json={
            "date": TODAY,
            "action_type": "Measurement",
            "installation_id": installation_id,
            "notes": "pH 7.4 bromine 3 TAC 50 hardness 300",
        },
    )
    rec_r = client.get(f"/installations/{installation_id}/recommendations")
    assert rec_r.status_code == 200
    data = rec_r.json()
    assert data["volume_known"] is False
    tac_rec = next(r for r in data["recommendations"] if r["param"] == "tac")
    assert tac_rec["options"][0]["amount_grams"] is None

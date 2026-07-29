import copy
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

import database
from main import (
    WATER_PARAMS,
    _backfill_first_admin,
    _merge_range_overrides,
    _seed_maintenance_tasks,
    app,
)
from models import Action, AppSetting, MaintenanceTask, Product, User

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


def test_create_installation_with_contact_info(client: TestClient):
    login(client)
    r = client.post(
        "/installations",
        json={
            "name": "Rental pool",
            "type": "pool",
            "sanitizer": "chlorine",
            "address": "123 Main St",
            "contact_name": "Jane Doe",
            "phone": "555-1234",
            "email": "jane@example.com",
            "notes": "Gate code 4321",
        },
    )
    assert r.status_code == 200
    installation_id = r.json()["id"]
    # Fields round-trip through a fresh GET.
    listing = client.get("/installations").json()
    created = next(i for i in listing if i["id"] == installation_id)
    assert created["address"] == "123 Main St"
    assert created["contact_name"] == "Jane Doe"
    assert created["phone"] == "555-1234"
    assert created["email"] == "jane@example.com"
    assert created["notes"] == "Gate code 4321"


def test_create_installation_contact_info_defaults_null(client: TestClient):
    login(client)
    r = client.post("/installations", json={"name": "Plain pool"})
    assert r.status_code == 200
    data = r.json()
    assert data["address"] is None
    assert data["contact_name"] is None
    assert data["phone"] is None
    assert data["email"] is None
    assert data["notes"] is None


def test_patch_installation_contact_info(client: TestClient):
    login(client)
    installation_id = client.post("/installations", json={"name": "My pool"}).json()["id"]
    patch_r = client.patch(
        f"/installations/{installation_id}",
        json={"address": "9 Ocean Ave", "phone": "555-9999"},
    )
    assert patch_r.status_code == 200
    data = patch_r.json()
    assert data["address"] == "9 Ocean Ave"
    assert data["phone"] == "555-9999"


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

def _task_by_key(todo_list, builtin_key):
    """Finds a task in a /v1/todo list (or /installations/.../maintenance list)
    by its builtin_key."""
    return next(t for t in todo_list if t["builtin_key"] == builtin_key)


def test_v1_todo_returns_default_task_list(client: TestClient):
    login(client)
    key = get_api_key(client)
    inst_r = client.post("/installations", json={"name": "My pool"})
    installation_id = inst_r.json()["id"]
    r = client.get(f"/v1/todo?installation_id={installation_id}", headers=auth_headers(key))
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    keys = {t["builtin_key"] for t in data}
    assert {"ph_measurement", "filter_maintenance", "water_change"} <= keys
    ph = _task_by_key(data, "ph_measurement")
    assert ph["interval_days"] == 7
    assert ph["enabled"] is True
    assert ph["key"] == "ph_measurement"


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
    ph = _task_by_key(r.json(), "ph_measurement")
    assert ph["days_until_due"] == 5
    assert ph["last_date"] == measured_date


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
    assert _task_by_key(r.json(), "ph_measurement")["days_until_due"] == -3


def test_v1_todo_never_measured_is_null(client: TestClient):
    login(client)
    key = get_api_key(client)
    inst_r = client.post("/installations", json={"name": "My pool"})
    installation_id = inst_r.json()["id"]
    r = client.get(f"/v1/todo?installation_id={installation_id}", headers=auth_headers(key))
    assert r.status_code == 200
    data = r.json()
    ph = _task_by_key(data, "ph_measurement")
    assert ph["days_until_due"] is None
    assert ph["last_date"] is None
    filt = _task_by_key(data, "filter_maintenance")
    assert filt["days_until_due"] is None
    assert filt["last_date"] is None


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
    filt = _task_by_key(r.json(), "filter_maintenance")
    assert filt["days_until_due"] == 9
    assert filt["last_date"] == done_date


def test_v1_todo_excludes_disabled_tasks(client: TestClient):
    login(client)
    key = get_api_key(client)
    inst_r = client.post("/installations", json={"name": "My pool"})
    installation_id = inst_r.json()["id"]
    tasks = client.get(f"/installations/{installation_id}/maintenance").json()
    water_change = _task_by_key(tasks, "water_change")
    client.patch(
        f"/installations/{installation_id}/maintenance/{water_change['id']}",
        json={"enabled": False},
    )
    r = client.get(f"/v1/todo?installation_id={installation_id}", headers=auth_headers(key))
    assert r.status_code == 200
    keys = {t["builtin_key"] for t in r.json()}
    assert "water_change" not in keys
    assert "ph_measurement" in keys


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


def test_v1_create_measurement_accepts_a_custom_date(client: TestClient):
    """A reading you took on Sunday and only got round to logging on Tuesday.
    Regression test: see test_v1_create_maintenance_accepts_a_custom_date."""
    login(client)
    key = get_api_key(client)
    installation_id = client.post("/installations", json={"name": "My pool"}).json()["id"]
    then = (date.today() - timedelta(days=2)).isoformat()
    r = client.post(
        "/v1/measurements",
        headers=auth_headers(key),
        json={"installation_id": installation_id, "ph": 7.4, "chlorine": 1.6, "date": then},
    )
    assert r.status_code == 200
    assert r.json()["date"] == then

    history = client.get(
        f"/v1/history?installation_id={installation_id}&type=measurement",
        headers=auth_headers(key),
    ).json()
    assert [(h["date"], h["ph"]) for h in history] == [(then, 7.4)]


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
    assert _task_by_key(todo.json(), "filter_maintenance")["days_until_due"] == 14


def test_v1_create_maintenance_accepts_a_custom_date(client: TestClient):
    """Backdating an entry you forgot to log. Regression test: `date` used to be
    annotated Optional[None] (a class attribute shadowing the `date` type), so
    every value was rejected with a 422."""
    login(client)
    key = get_api_key(client)
    installation_id = client.post("/installations", json={"name": "My pool"}).json()["id"]
    then = (date.today() - timedelta(days=3)).isoformat()
    r = client.post(
        "/v1/maintenance",
        headers=auth_headers(key),
        json={"installation_id": installation_id, "action_type": "Backwash", "date": then},
    )
    assert r.status_code == 200
    assert r.json()["date"] == then

    todo = client.get(f"/v1/todo?installation_id={installation_id}", headers=auth_headers(key))
    assert _task_by_key(todo.json(), "filter_maintenance")["last_date"] == then


def test_v1_create_maintenance_rejects_unknown_action_type(client: TestClient):
    login(client)
    key = get_api_key(client)
    client.post("/installations", json={"name": "My pool"})
    r = client.post(
        "/v1/maintenance",
        headers=auth_headers(key),
        json={"action_type": "Polish the ladder"},
    )
    assert r.status_code == 422


def test_v1_create_maintenance_rejects_measurement_action_type(client: TestClient):
    """Measurements carry values and go through /v1/measurements — the pH
    measurement task must not be loggable as a bare maintenance entry."""
    login(client)
    key = get_api_key(client)
    client.post("/installations", json={"name": "My pool"})
    r = client.post(
        "/v1/maintenance",
        headers=auth_headers(key),
        json={"action_type": "Measurement"},
    )
    assert r.status_code == 422


def test_v1_create_maintenance_accepts_a_custom_task_action_type(client: TestClient):
    """Action types come from the configured tasks, so a custom task is writable
    without the API knowing anything about it."""
    login(client)
    key = get_api_key(client)
    installation_id = client.post("/installations", json={"name": "My pool"}).json()["id"]
    client.post(
        f"/installations/{installation_id}/maintenance",
        json={"label": "Vacuum floor", "interval_days": 10},
    )
    r = client.post(
        "/v1/maintenance",
        headers=auth_headers(key),
        json={"installation_id": installation_id, "action_type": "Vacuum floor"},
    )
    assert r.status_code == 200


def test_v1_create_maintenance_rejects_a_disabled_tasks_action_type(client: TestClient):
    login(client)
    key = get_api_key(client)
    installation_id = client.post("/installations", json={"name": "My pool"}).json()["id"]
    tasks = client.get(f"/installations/{installation_id}/maintenance").json()
    water_change = _task_by_key(tasks, "water_change")
    client.patch(
        f"/installations/{installation_id}/maintenance/{water_change['id']}",
        json={"enabled": False},
    )
    r = client.post(
        "/v1/maintenance",
        headers=auth_headers(key),
        json={"installation_id": installation_id, "action_type": "Water change"},
    )
    assert r.status_code == 422


def test_v1_create_maintenance_requires_api_key(client: TestClient):
    login(client)
    client.post("/installations", json={"name": "My pool"})
    r = client.post("/v1/maintenance", json={"action_type": "Backwash"})
    assert r.status_code == 401


def test_v1_maintenance_complete_resets_due(client: TestClient):
    login(client)
    key = get_api_key(client)
    installation_id = client.post("/installations", json={"name": "My pool"}).json()["id"]
    tasks = client.get(f"/installations/{installation_id}/maintenance").json()
    filt = _task_by_key(tasks, "filter_maintenance")
    r = client.post(
        "/v1/maintenance/complete",
        headers=auth_headers(key),
        json={"installation_id": installation_id, "task_id": filt["id"]},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["days_until_due"] == filt["interval_days"]  # just done today
    assert body["last_date"] == date.today().isoformat()


def test_v1_maintenance_complete_backdates(client: TestClient):
    """The HA `log_maintenance` service records maintenance you did days ago and
    forgot to log, so the completion carries an explicit date and notes."""
    login(client)
    key = get_api_key(client)
    installation_id = client.post("/installations", json={"name": "My pool"}).json()["id"]
    tasks = client.get(f"/installations/{installation_id}/maintenance").json()
    filt = _task_by_key(tasks, "filter_maintenance")
    then = date.today() - timedelta(days=5)
    r = client.post(
        "/v1/maintenance/complete",
        headers=auth_headers(key),
        json={
            "installation_id": installation_id,
            "task_id": filt["id"],
            "date": then.isoformat(),
            "notes": "Backwashed until clear",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["last_date"] == then.isoformat()
    assert body["days_until_due"] == filt["interval_days"] - 5

    actions = client.get(f"/actions?installation_id={installation_id}").json()
    logged = next(a for a in actions if a["date"] == then.isoformat())
    assert logged["notes"] == "Backwashed until clear"


def test_v1_maintenance_complete_rejects_foreign_task(client: TestClient):
    login(client)
    key = get_api_key(client)
    installation_id = client.post("/installations", json={"name": "My pool"}).json()["id"]
    r = client.post(
        "/v1/maintenance/complete",
        headers=auth_headers(key),
        json={"installation_id": installation_id, "task_id": 99999},
    )
    assert r.status_code == 404


# ── /installations/{id}/maintenance (config) ─────────────────────────────

def test_maintenance_seeded_on_installation_create(client: TestClient):
    login(client)
    installation_id = client.post("/installations", json={"name": "My pool"}).json()["id"]
    tasks = client.get(f"/installations/{installation_id}/maintenance").json()
    keys = {t["builtin_key"] for t in tasks}
    # Every action type the old hardcoded entry-form picker offered now has a
    # built-in task, since the tasks are the only taxonomy (issue #51).
    assert {
        "ph_measurement",
        "filter_maintenance",
        "water_change",
        "ph_calibration",
        "product_addition",
    } <= keys


def test_maintenance_spa_defaults_differ_from_pool(client: TestClient):
    login(client)
    spa_id = client.post("/installations", json={"name": "My spa", "type": "spa"}).json()["id"]
    tasks = client.get(f"/installations/{spa_id}/maintenance").json()
    ph = _task_by_key(tasks, "ph_measurement")
    assert ph["interval_days"] == 3  # spa cadence, vs 7 for a pool
    # Purge is a spa-only built-in.
    assert _task_by_key(tasks, "purge")["action_types"] == ["Purge"]


def test_maintenance_on_demand_task_is_never_due(client: TestClient):
    """interval_days=0 marks an on-demand task: it can be logged, its last
    completion is tracked, but it never becomes due."""
    login(client)
    installation_id = client.post("/installations", json={"name": "My pool"}).json()["id"]
    tasks = client.get(f"/installations/{installation_id}/maintenance").json()
    product = _task_by_key(tasks, "product_addition")
    assert product["interval_days"] == 0
    assert product["days_until_due"] is None

    r = client.post(
        f"/installations/{installation_id}/maintenance/{product['id']}/complete"
    )
    assert r.status_code == 200
    body = r.json()
    assert body["last_date"] == date.today().isoformat()
    assert body["days_until_due"] is None


def test_maintenance_create_on_demand_custom_task(client: TestClient):
    login(client)
    installation_id = client.post("/installations", json={"name": "My pool"}).json()["id"]
    r = client.post(
        f"/installations/{installation_id}/maintenance",
        json={"label": "Skimmed", "interval_days": 0},
    )
    assert r.status_code == 200
    assert r.json()["interval_days"] == 0
    assert r.json()["days_until_due"] is None


def test_maintenance_rejects_negative_interval(client: TestClient):
    login(client)
    installation_id = client.post("/installations", json={"name": "My pool"}).json()["id"]
    r = client.post(
        f"/installations/{installation_id}/maintenance",
        json={"label": "Nope", "interval_days": -1},
    )
    assert r.status_code == 422


def test_maintenance_backfill_leaves_configured_installations_alone(client: TestClient):
    """The boot backfill only seeds installations with no tasks at all. It must
    never top up a configured one — every task is deletable now, so a missing
    default means the user removed it, and re-adding it would undo that."""
    login(client)
    installation_id = client.post("/installations", json={"name": "My pool"}).json()["id"]

    with Session(client.test_engine) as session:
        for task in session.exec(
            select(MaintenanceTask).where(MaintenanceTask.installation_id == installation_id)
        ).all():
            if task.builtin_key in ("product_addition", "ph_calibration"):
                session.delete(task)
            elif task.builtin_key == "water_change":
                task.enabled = False
                session.add(task)
        session.add(
            MaintenanceTask(
                installation_id=installation_id,
                builtin_key=None,
                label="Vacuum floor",
                action_types=["Vacuum floor"],
                interval_days=10,
                sort_order=99,
            )
        )
        session.commit()

        _seed_maintenance_tasks(session)
        _seed_maintenance_tasks(session)  # idempotent

        tasks = session.exec(
            select(MaintenanceTask).where(MaintenanceTask.installation_id == installation_id)
        ).all()

    builtin_keys = [t.builtin_key for t in tasks if t.builtin_key]
    assert sorted(builtin_keys) == [
        "filter_maintenance",
        "ph_measurement",
        "water_change",
    ]
    # Untouched: the user's own edits survive the backfill.
    assert next(t for t in tasks if t.builtin_key == "water_change").enabled is False
    assert len([t for t in tasks if t.builtin_key is None]) == 1


def test_maintenance_backfill_seeds_a_taskless_installation(client: TestClient):
    """Databases predating configurable maintenance have installations with no
    tasks at all; the boot backfill is what gives them a usable entry picker."""
    login(client)
    installation_id = client.post("/installations", json={"name": "My pool"}).json()["id"]

    with Session(client.test_engine) as session:
        for task in session.exec(
            select(MaintenanceTask).where(MaintenanceTask.installation_id == installation_id)
        ).all():
            session.delete(task)
        session.commit()

        _seed_maintenance_tasks(session)

        tasks = session.exec(
            select(MaintenanceTask).where(MaintenanceTask.installation_id == installation_id)
        ).all()

    assert sorted(t.builtin_key for t in tasks) == [
        "filter_maintenance",
        "ph_calibration",
        "ph_measurement",
        "product_addition",
        "water_change",
    ]


def test_maintenance_seeded_on_the_default_installation_from_register(empty_client: TestClient):
    """Registering creates a pool for you. It has to arrive with tasks like any
    other, or the new account's maintenance page is empty — and so is the
    maintenance half of the entry form — until the API is next restarted."""
    r = empty_client.post(
        "/auth/register",
        json={"first_name": "New", "email": "new@example.com", "password": "Password1"},
    )
    assert r.status_code == 200
    installation_id = empty_client.get("/installations").json()[0]["id"]
    tasks = empty_client.get(f"/installations/{installation_id}/maintenance").json()
    assert {t["builtin_key"] for t in tasks} == {
        "ph_measurement",
        "filter_maintenance",
        "water_change",
        "ph_calibration",
        "product_addition",
    }


def test_maintenance_create_custom_task(client: TestClient):
    login(client)
    installation_id = client.post("/installations", json={"name": "My pool"}).json()["id"]
    r = client.post(
        f"/installations/{installation_id}/maintenance",
        json={"label": "Vacuum floor", "interval_days": 10},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["builtin_key"] is None
    assert body["label"] == "Vacuum floor"
    assert body["action_types"] == ["Vacuum floor"]  # defaults to [label]
    assert body["key"] == f"custom_{body['id']}"


def test_maintenance_complete_custom_task(client: TestClient):
    login(client)
    installation_id = client.post("/installations", json={"name": "My pool"}).json()["id"]
    task = client.post(
        f"/installations/{installation_id}/maintenance",
        json={"label": "Vacuum floor", "interval_days": 10},
    ).json()
    r = client.post(
        f"/installations/{installation_id}/maintenance/{task['id']}/complete"
    )
    assert r.status_code == 200
    assert r.json()["last_date"] == date.today().isoformat()
    # The completion is a readable Action with the custom action_type.
    actions = client.get(f"/actions?installation_id={installation_id}").json()
    assert any(a["action_type"] == "Vacuum floor" for a in actions)


def test_maintenance_update_task(client: TestClient):
    login(client)
    installation_id = client.post("/installations", json={"name": "My pool"}).json()["id"]
    tasks = client.get(f"/installations/{installation_id}/maintenance").json()
    ph = _task_by_key(tasks, "ph_measurement")
    r = client.patch(
        f"/installations/{installation_id}/maintenance/{ph['id']}",
        json={"interval_days": 4, "enabled": False},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["interval_days"] == 4
    assert body["enabled"] is False


def test_maintenance_rename_clears_builtin_key(client: TestClient):
    """A seeded task's builtin_key is only a "this label is translatable" hint.
    Renaming makes the stored label authoritative, so the key is dropped and
    clients stop translating over the user's own wording."""
    login(client)
    installation_id = client.post("/installations", json={"name": "My pool"}).json()["id"]
    tasks = client.get(f"/installations/{installation_id}/maintenance").json()
    filt = _task_by_key(tasks, "filter_maintenance")
    r = client.patch(
        f"/installations/{installation_id}/maintenance/{filt['id']}",
        json={"label": "Backwash the sand filter"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["builtin_key"] is None
    assert body["label"] == "Backwash the sand filter"
    assert body["key"] == f"custom_{filt['id']}"


def test_maintenance_edit_without_rename_keeps_builtin_key(client: TestClient):
    login(client)
    installation_id = client.post("/installations", json={"name": "My pool"}).json()["id"]
    tasks = client.get(f"/installations/{installation_id}/maintenance").json()
    filt = _task_by_key(tasks, "filter_maintenance")
    r = client.patch(
        f"/installations/{installation_id}/maintenance/{filt['id']}",
        json={"label": filt["label"], "interval_days": 21, "icon": "mdi:broom"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["builtin_key"] == "filter_maintenance"
    assert body["interval_days"] == 21
    assert body["icon"] == "mdi:broom"


def test_maintenance_seeded_task_can_be_deleted(client: TestClient):
    """No task is special: a seeded default deletes like any other, and the boot
    backfill must not bring it back."""
    login(client)
    installation_id = client.post("/installations", json={"name": "My pool"}).json()["id"]
    tasks = client.get(f"/installations/{installation_id}/maintenance").json()
    ph = _task_by_key(tasks, "ph_measurement")
    r = client.delete(f"/installations/{installation_id}/maintenance/{ph['id']}")
    assert r.status_code == 204

    with Session(client.test_engine) as session:
        _seed_maintenance_tasks(session)

    remaining = client.get(f"/installations/{installation_id}/maintenance").json()
    assert all(t["builtin_key"] != "ph_measurement" for t in remaining)


def test_maintenance_custom_can_be_deleted(client: TestClient):
    login(client)
    installation_id = client.post("/installations", json={"name": "My pool"}).json()["id"]
    task = client.post(
        f"/installations/{installation_id}/maintenance",
        json={"label": "Vacuum floor", "interval_days": 10},
    ).json()
    r = client.delete(f"/installations/{installation_id}/maintenance/{task['id']}")
    assert r.status_code == 204
    remaining = client.get(f"/installations/{installation_id}/maintenance").json()
    assert all(t["id"] != task["id"] for t in remaining)


def test_maintenance_unknown_task_404s(client: TestClient):
    login(client)
    installation_id = client.post("/installations", json={"name": "My pool"}).json()["id"]
    r = client.patch(
        f"/installations/{installation_id}/maintenance/99999", json={"interval_days": 5}
    )
    assert r.status_code == 404


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


# ── Administration & registration ──────────────────────────────────────────


def register(client: TestClient, email: str, password: str = "Password1", name: str = "Alex"):
    return client.post(
        "/auth/register",
        json={"first_name": name, "email": email, "password": password},
    )


def test_first_registered_account_becomes_admin(empty_client: TestClient):
    r = register(empty_client, "first@example.com")
    assert r.status_code == 200
    assert r.json()["user"]["is_admin"] is True


def test_second_registered_account_is_not_admin(empty_client: TestClient):
    register(empty_client, "first@example.com")
    empty_client.post("/auth/logout")
    r = register(empty_client, "second@example.com")
    assert r.status_code == 200
    assert r.json()["user"]["is_admin"] is False


def test_registration_status_reports_first_run(empty_client: TestClient):
    r = empty_client.get("/auth/registration-status")
    assert r.json() == {"open": True, "first_run": True}
    register(empty_client, "first@example.com")
    r = empty_client.get("/auth/registration-status")
    assert r.json() == {"open": True, "first_run": False}


def test_registration_closed_rejects_new_accounts(client: TestClient):
    login(client)
    assert client.patch("/admin/settings", json={"allow_registration": False}).status_code == 200
    assert client.get("/auth/registration-status").json()["open"] is False
    r = register(client, "nope@example.com")
    assert r.status_code == 403


def test_registration_closed_still_allows_the_very_first_account(empty_client: TestClient):
    # A leftover "closed" setting (restored backup, deleted accounts) must never
    # lock everybody out of an instance that has no account at all.
    with Session(empty_client.test_engine) as session:
        session.add(AppSetting(key="allow_registration", value="false"))
        session.commit()
    assert empty_client.get("/auth/registration-status").json()["open"] is True
    r = register(empty_client, "first@example.com")
    assert r.status_code == 200
    assert r.json()["user"]["is_admin"] is True


def test_reopening_registration_allows_new_accounts(client: TestClient):
    login(client)
    client.patch("/admin/settings", json={"allow_registration": False})
    client.patch("/admin/settings", json={"allow_registration": True})
    assert client.get("/auth/registration-status").json()["open"] is True
    assert register(client, "yes@example.com").status_code == 200


def test_admin_routes_require_admin(client: TestClient):
    login(client)
    register(client, "plain@example.com")  # logs in as the new non-admin user
    assert client.get("/admin/users").status_code == 403
    assert client.get("/admin/settings").status_code == 403
    assert client.patch("/admin/settings", json={"allow_registration": False}).status_code == 403


def test_admin_routes_require_authentication(client: TestClient):
    assert client.get("/admin/users").status_code == 401


def test_admin_list_users_reports_installation_counts(client: TestClient):
    login(client)
    client.post("/installations", json={"name": "Pool", "type": "pool", "sanitizer": "chlorine"})
    r = client.get("/admin/users")
    assert r.status_code == 200
    admin_row = next(u for u in r.json() if u["email"] == "admin@example.com")
    assert admin_row["is_admin"] is True
    assert admin_row["installation_count"] == 1


def test_admin_can_promote_and_demote_another_user(client: TestClient):
    login(client)
    other_id = register(client, "other@example.com").json()["user"]["id"]
    login(client)
    r = client.patch(f"/admin/users/{other_id}", json={"is_admin": True})
    assert r.status_code == 200
    assert r.json()["is_admin"] is True
    r = client.patch(f"/admin/users/{other_id}", json={"is_admin": False})
    assert r.json()["is_admin"] is False


def test_last_admin_cannot_be_demoted(client: TestClient):
    login(client)
    me_id = client.get("/me").json()["user"]["id"]
    r = client.patch(f"/admin/users/{me_id}", json={"is_admin": False})
    assert r.status_code == 400


def test_last_admin_cannot_be_deleted(client: TestClient):
    login(client)
    me_id = client.get("/me").json()["user"]["id"]
    assert client.delete(f"/admin/users/{me_id}").status_code == 400


def test_admin_delete_user_removes_their_data(client: TestClient):
    login(client)
    other_id = register(client, "other@example.com").json()["user"]["id"]
    inst_id = client.post(
        "/installations", json={"name": "Their pool", "type": "pool", "sanitizer": "chlorine"}
    ).json()["id"]
    client.post(
        "/actions",
        json={"date": TODAY, "action_type": "Measurement", "installation_id": inst_id, "notes": "pH 7.4"},
    )
    login(client)
    assert client.delete(f"/admin/users/{other_id}").status_code == 204
    assert all(u["id"] != other_id for u in client.get("/admin/users").json())
    # Their installation went with them, so the admin can no longer reach it.
    assert client.get(f"/installations/{inst_id}/params").status_code == 404


def test_admin_delete_unknown_user_404s(client: TestClient):
    login(client)
    assert client.delete("/admin/users/9999").status_code == 404


def test_backfill_promotes_oldest_user_and_adopts_orphan_actions(empty_client: TestClient):
    # The upgrade path for instances created before is_admin existed: nobody is
    # flagged, so the oldest account is promoted — and only that one.
    with Session(empty_client.test_engine) as session:
        for email in ("oldest@example.com", "newer@example.com"):
            session.add(User(email=email, password_hash="x"))
        session.commit()
        session.add(Action(date=date.today(), action_type="Measurement", user_id=None))
        session.commit()

        _backfill_first_admin(session)

        users = session.exec(select(User).order_by(User.id)).all()
        assert [u.is_admin for u in users] == [True, False]
        orphan = session.exec(select(Action)).first()
        assert orphan.user_id == users[0].id


def test_backfill_leaves_an_existing_admin_alone(empty_client: TestClient):
    with Session(empty_client.test_engine) as session:
        session.add(User(email="oldest@example.com", password_hash="x"))
        session.add(User(email="chosen@example.com", password_hash="x", is_admin=True))
        session.commit()

        _backfill_first_admin(session)

        admins = session.exec(select(User).where(User.is_admin)).all()
        assert [u.email for u in admins] == ["chosen@example.com"]


# ── Sharing installations between accounts ─────────────────────────────────


def login_as(client: TestClient, email: str, password: str = "Password1"):
    r = client.post("/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200
    return r.json()["user"]


def share_setup(client: TestClient, role: str = "viewer"):
    """Admin owns an installation and shares it with other@example.com in `role`.
    Leaves the client logged in as the recipient. Returns (installation_id,
    share_id) so tests don't have to log back in as the owner just to look the
    share up — /auth/login is rate-limited to 5/minute."""
    login(client)
    installation_id = client.post(
        "/installations", json={"name": "Shared pool", "type": "pool", "sanitizer": "chlorine"}
    ).json()["id"]
    register(client, "other@example.com", name="Robin")
    login(client)
    r = client.post(
        f"/installations/{installation_id}/shares",
        json={"email": "other@example.com", "role": role},
    )
    assert r.status_code == 200, r.text
    share_id = r.json()["id"]
    login_as(client, "other@example.com")
    return installation_id, share_id


def test_share_appears_in_recipients_installation_list(client: TestClient):
    installation_id, share_id = share_setup(client, "viewer")
    listing = client.get("/installations").json()
    shared = next(i for i in listing if i["id"] == installation_id)
    assert shared["role"] == "viewer"
    assert shared["owner_name"] == "admin@example.com"
    # Their own default installation is still listed, and owned.
    own = [i for i in listing if i["id"] != installation_id]
    assert own and all(i["role"] == "owner" and i["owner_name"] is None for i in own)


def test_owner_sees_their_own_installation_as_owner(client: TestClient):
    login(client)
    installation_id = client.post("/installations", json={"name": "Mine"}).json()["id"]
    row = next(i for i in client.get("/installations").json() if i["id"] == installation_id)
    assert row["role"] == "owner"
    assert row["owner_name"] is None


def test_viewer_can_read_but_not_write(client: TestClient):
    installation_id, share_id = share_setup(client, "viewer")
    assert client.get(f"/installations/{installation_id}/params").status_code == 200
    assert client.get(f"/installations/{installation_id}/params/full").status_code == 200
    assert client.get(f"/installations/{installation_id}/recommendations").status_code == 200
    assert client.get(f"/installations/{installation_id}/maintenance").status_code == 200
    assert client.get(f"/actions?installation_id={installation_id}").status_code == 200

    r = client.post(
        "/actions",
        json={"date": TODAY, "action_type": "Measurement", "installation_id": installation_id},
    )
    assert r.status_code == 403


def test_viewer_cannot_complete_maintenance(client: TestClient):
    installation_id, share_id = share_setup(client, "viewer")
    task_id = client.get(f"/installations/{installation_id}/maintenance").json()[0]["id"]
    r = client.post(f"/installations/{installation_id}/maintenance/{task_id}/complete")
    assert r.status_code == 403


def test_editor_can_log_entries(client: TestClient):
    installation_id, share_id = share_setup(client, "editor")
    r = client.post(
        "/actions",
        json={
            "date": TODAY,
            "action_type": "Measurement",
            "installation_id": installation_id,
            "notes": "pH 7.4",
        },
    )
    assert r.status_code == 200
    task_id = client.get(f"/installations/{installation_id}/maintenance").json()[0]["id"]
    assert client.post(
        f"/installations/{installation_id}/maintenance/{task_id}/complete"
    ).status_code == 200


def test_editor_cannot_configure_the_installation(client: TestClient):
    installation_id, share_id = share_setup(client, "editor")
    assert client.patch(
        f"/installations/{installation_id}", json={"name": "Renamed"}
    ).status_code == 404
    assert client.put(
        f"/installations/{installation_id}/params", json={"ph": {"ideal": [7.0, 7.4]}}
    ).status_code == 404
    assert client.post(
        f"/installations/{installation_id}/maintenance", json={"label": "Custom"}
    ).status_code == 404
    assert client.delete(f"/installations/{installation_id}").status_code == 404


def test_editor_cannot_manage_shares(client: TestClient):
    installation_id, share_id = share_setup(client, "editor")
    assert client.get(f"/installations/{installation_id}/shares").status_code == 404
    assert client.post(
        f"/installations/{installation_id}/shares",
        json={"email": "admin@example.com", "role": "viewer"},
    ).status_code == 404


def test_owner_can_delete_an_action_logged_by_an_editor(client: TestClient):
    installation_id, share_id = share_setup(client, "editor")
    action_id = client.post(
        "/actions",
        json={"date": TODAY, "action_type": "Measurement", "installation_id": installation_id},
    ).json()["id"]
    login(client)
    assert client.delete(f"/actions/{action_id}").status_code == 204


def test_editor_can_edit_an_action_logged_by_the_owner(client: TestClient):
    login(client)
    installation_id = client.post("/installations", json={"name": "Shared pool"}).json()["id"]
    action_id = client.post(
        "/actions",
        json={"date": TODAY, "action_type": "Measurement", "installation_id": installation_id},
    ).json()["id"]
    register(client, "other@example.com")
    login(client)
    client.post(
        f"/installations/{installation_id}/shares",
        json={"email": "other@example.com", "role": "editor"},
    )
    login_as(client, "other@example.com")
    r = client.patch(
        f"/actions/{action_id}",
        json={"date": TODAY, "action_type": "Measurement", "notes": "edited"},
    )
    assert r.status_code == 200
    assert r.json()["notes"] == "edited"


def test_stranger_cannot_touch_an_unshared_installation(client: TestClient):
    login(client)
    installation_id = client.post("/installations", json={"name": "Private"}).json()["id"]
    register(client, "stranger@example.com")
    assert client.get(f"/installations/{installation_id}/params").status_code == 404
    assert client.get(f"/actions?installation_id={installation_id}").status_code == 404
    assert client.post(
        "/actions",
        json={"date": TODAY, "action_type": "Measurement", "installation_id": installation_id},
    ).status_code == 404


def test_share_with_unknown_email_404s(client: TestClient):
    login(client)
    installation_id = client.post("/installations", json={"name": "Pool"}).json()["id"]
    r = client.post(
        f"/installations/{installation_id}/shares",
        json={"email": "nobody@example.com", "role": "viewer"},
    )
    assert r.status_code == 404


def test_share_with_self_is_rejected(client: TestClient):
    login(client)
    installation_id = client.post("/installations", json={"name": "Pool"}).json()["id"]
    r = client.post(
        f"/installations/{installation_id}/shares",
        json={"email": "admin@example.com", "role": "viewer"},
    )
    assert r.status_code == 400


def test_duplicate_share_is_rejected(client: TestClient):
    installation_id, share_id = share_setup(client, "viewer")
    login(client)
    r = client.post(
        f"/installations/{installation_id}/shares",
        json={"email": "other@example.com", "role": "editor"},
    )
    assert r.status_code == 409


def test_share_rejects_unknown_role(client: TestClient):
    login(client)
    installation_id = client.post("/installations", json={"name": "Pool"}).json()["id"]
    register(client, "other@example.com")
    login(client)
    r = client.post(
        f"/installations/{installation_id}/shares",
        json={"email": "other@example.com", "role": "owner"},
    )
    assert r.status_code == 422


def test_owner_can_change_a_share_role(client: TestClient):
    installation_id, share_id = share_setup(client, "viewer")
    login(client)
    r = client.patch(
        f"/installations/{installation_id}/shares/{share_id}", json={"role": "editor"}
    )
    assert r.status_code == 200
    assert r.json()["role"] == "editor"
    login_as(client, "other@example.com")
    assert client.post(
        "/actions",
        json={"date": TODAY, "action_type": "Measurement", "installation_id": installation_id},
    ).status_code == 200


def test_owner_lists_shares_with_recipient_details(client: TestClient):
    installation_id, share_id = share_setup(client, "viewer")
    login(client)
    shares = client.get(f"/installations/{installation_id}/shares").json()
    assert len(shares) == 1
    assert shares[0]["email"] == "other@example.com"
    assert shares[0]["first_name"] == "Robin"
    assert shares[0]["role"] == "viewer"


def test_owner_revoking_a_share_removes_access(client: TestClient):
    installation_id, share_id = share_setup(client, "viewer")
    login(client)
    assert client.delete(
        f"/installations/{installation_id}/shares/{share_id}"
    ).status_code == 204
    login_as(client, "other@example.com")
    assert client.get(f"/installations/{installation_id}/params").status_code == 404
    assert all(i["id"] != installation_id for i in client.get("/installations").json())


def test_recipient_can_leave_a_shared_installation(client: TestClient):
    installation_id, _ = share_setup(client, "editor")
    assert client.delete(f"/installations/{installation_id}/shares/me").status_code == 204
    assert client.get(f"/installations/{installation_id}/params").status_code == 404
    # The owner keeps the installation.
    login(client)
    assert client.get(f"/installations/{installation_id}/params").status_code == 200


def test_leaving_an_installation_you_have_no_share_on_404s(client: TestClient):
    login(client)
    installation_id = client.post("/installations", json={"name": "Mine"}).json()["id"]
    assert client.delete(f"/installations/{installation_id}/shares/me").status_code == 404


def test_recipient_cannot_revoke_a_share_by_id(client: TestClient):
    # Only the owner may use the by-id route; a recipient has to leave instead.
    installation_id, share_id = share_setup(client, "editor")
    assert client.delete(
        f"/installations/{installation_id}/shares/{share_id}"
    ).status_code == 404
    assert client.get(f"/installations/{installation_id}/params").status_code == 200


def test_deleting_an_installation_removes_its_shares(client: TestClient):
    installation_id, share_id = share_setup(client, "viewer")
    login(client)
    # An owner must keep at least one installation, so give them a second one.
    client.post("/installations", json={"name": "Spare"})
    assert client.delete(f"/installations/{installation_id}").status_code == 204
    login_as(client, "other@example.com")
    assert all(i["id"] != installation_id for i in client.get("/installations").json())


def test_v1_installations_includes_shared_installations(client: TestClient):
    installation_id, share_id = share_setup(client, "viewer")
    key = client.post("/me/api-key").json()["key"]
    r = client.get("/v1/installations", headers={"Authorization": f"Bearer {key}"})
    assert r.status_code == 200
    assert installation_id in [i["id"] for i in r.json()]


def test_v1_write_routes_reject_a_viewer(client: TestClient):
    installation_id, share_id = share_setup(client, "viewer")
    key = client.post("/me/api-key").json()["key"]
    headers = {"Authorization": f"Bearer {key}"}
    assert client.post(
        "/v1/measurements",
        json={"installation_id": installation_id, "ph": 7.4},
        headers=headers,
    ).status_code == 403
    assert client.post(
        "/v1/maintenance",
        json={"installation_id": installation_id, "action_type": "Backwash"},
        headers=headers,
    ).status_code == 403


def test_v1_write_routes_accept_an_editor(client: TestClient):
    installation_id, share_id = share_setup(client, "editor")
    key = client.post("/me/api-key").json()["key"]
    headers = {"Authorization": f"Bearer {key}"}
    assert client.post(
        "/v1/measurements",
        json={"installation_id": installation_id, "ph": 7.4},
        headers=headers,
    ).status_code == 200
    r = client.get(
        f"/v1/current?installation_id={installation_id}", headers=headers
    )
    assert r.json()["ph"]["value"] == 7.4

import copy
from datetime import date

import pytest
from fastapi.testclient import TestClient

from main import WATER_PARAMS, _apply_range_overrides

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


# ── Range overrides (RANGE_<TYPE>_<SANITIZER>_<PARAM>_{IDEAL,ACCEPTABLE}_{MIN,MAX}) ──

def test_apply_range_overrides_full(monkeypatch, water_params_snapshot):
    monkeypatch.setenv("RANGE_POOL_SALT_SALT_IDEAL_MIN", "3600")
    monkeypatch.setenv("RANGE_POOL_SALT_SALT_IDEAL_MAX", "4400")
    monkeypatch.setenv("RANGE_POOL_SALT_SALT_ACCEPTABLE_MIN", "3000")
    monkeypatch.setenv("RANGE_POOL_SALT_SALT_ACCEPTABLE_MAX", "5000")
    _apply_range_overrides()
    ranges = WATER_PARAMS[("pool", "salt")]["salt"]
    assert ranges["ideal"] == (3600.0, 4400.0)
    assert ranges["acceptable"] == (3000.0, 5000.0)


def test_apply_range_overrides_partial_leaves_other_side_default(monkeypatch, water_params_snapshot):
    monkeypatch.setenv("RANGE_POOL_SALT_SALT_IDEAL_MIN", "3600")
    monkeypatch.setenv("RANGE_POOL_SALT_SALT_IDEAL_MAX", "4400")
    _apply_range_overrides()
    ranges = WATER_PARAMS[("pool", "salt")]["salt"]
    assert ranges["ideal"] == (3600.0, 4400.0)
    assert ranges["acceptable"] == (2500, 4500)


def test_apply_range_overrides_noop_without_env_vars(water_params_snapshot):
    before = copy.deepcopy(WATER_PARAMS)
    _apply_range_overrides()
    assert WATER_PARAMS == before


def test_apply_range_overrides_ignores_param_not_present_for_combo(monkeypatch, water_params_snapshot):
    # ("pool", "bromine") has no "cl" key — an override targeting it must be a no-op.
    monkeypatch.setenv("RANGE_POOL_BROMINE_CL_IDEAL_MIN", "1.0")
    monkeypatch.setenv("RANGE_POOL_BROMINE_CL_IDEAL_MAX", "3.0")
    before = copy.deepcopy(WATER_PARAMS[("pool", "bromine")])
    _apply_range_overrides()
    assert WATER_PARAMS[("pool", "bromine")] == before
    assert "cl" not in WATER_PARAMS[("pool", "bromine")]


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

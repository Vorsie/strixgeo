"""Tests for the codelists router — GET /codelists/g3dv3."""

from __future__ import annotations

from fastapi.testclient import TestClient

from groundmodel.api.main import app


def test_g3dv3_endpoint_returns_full_catalog() -> None:
    """Returns 117 units in age order, with the expected schema."""
    client = TestClient(app, base_url="http://127.0.0.1")
    response = client.get("/codelists/g3dv3")
    assert response.status_code == 200

    body = response.json()
    assert "units" in body
    units = body["units"]
    assert len(units) == 117


def test_g3dv3_endpoint_first_unit_is_antropogeen() -> None:
    """Age-order is preserved on the wire (youngest first)."""
    client = TestClient(app, base_url="http://127.0.0.1")
    response = client.get("/codelists/g3dv3")
    units = response.json()["units"]

    assert units[0]["name_nl"] == "Antropogeen"
    assert units[0]["age_rank"] == 0
    # Hex color round-trips lower-cased.
    assert units[0]["color_hex"] == "#ea152e"


def test_g3dv3_unit_payload_shape() -> None:
    """Each unit ships the expected seven fields and only those."""
    client = TestClient(app, base_url="http://127.0.0.1")
    response = client.get("/codelists/g3dv3")
    units = response.json()["units"]

    expected_keys = {
        "code",
        "abbreviation",
        "rank",
        "parent_abbreviation",
        "name_nl",
        "age_rank",
        "color_hex",
    }
    assert set(units[0].keys()) == expected_keys


def test_g3dv3_endpoint_contains_known_formations() -> None:
    """Spot-check key formations engineers will hit in the autocomplete."""
    client = TestClient(app, base_url="http://127.0.0.1")
    response = client.get("/codelists/g3dv3")
    units = response.json()["units"]

    names = {u["name_nl"] for u in units}
    for known in ["Antropogeen", "Boom", "Diest", "Kortrijk", "Bolderberg"]:
        assert known in names, f"{known!r} should be in the catalog"


def test_g3dv3_endpoint_includes_members() -> None:
    """Both formations and members ship in the response."""
    client = TestClient(app, base_url="http://127.0.0.1")
    response = client.get("/codelists/g3dv3")
    units = response.json()["units"]

    formations = [u for u in units if u["rank"] == "formation"]
    members = [u for u in units if u["rank"] == "member"]
    assert len(formations) > 0
    assert len(members) > 0
    # A member carries a non-null parent_abbreviation pointing at a
    # formation in the same catalog.
    member = next(u for u in units if u["rank"] == "member")
    assert member["parent_abbreviation"] is not None
    assert any(f["abbreviation"] == member["parent_abbreviation"] for f in formations)

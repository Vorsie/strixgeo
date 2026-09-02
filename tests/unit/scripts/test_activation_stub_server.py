"""Contract behaviours of the dev activation stub server.

``scripts/dev/activation_stub_server.py`` stands in for the real strixgeo.com
service so the desktop client can be exercised locally. These cases pin the four
behaviours the client depends on — the same rulings the mock TypeScript issuer
pins — driven through the real FastAPI app with an in-memory key set:

* a known key activates and binds the device;
* a SECOND device on a Solo key is refused (owner ruling 15) until a deactivate;
* deactivate frees the seat (the self-service transfer);
* a trial is issued once per device (owner ruling 16).

No network, no ledger file — ``create_app(keys=...)`` gives an isolated app.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from scripts.dev.activation_stub_server import create_app

_KEYS = {"K-SOLO": "solo", "K-STUDIO": "studio"}


def _client() -> TestClient:
    """A TestClient over an isolated, in-memory stub app."""
    return TestClient(create_app(keys=_KEYS))


def test_activate_binds_a_known_key_to_the_device() -> None:
    """A known Solo key activates; the licence echoes the device and tier."""
    client = _client()
    response = client.post(
        "/activate", json={"key": "K-SOLO", "deviceId": "device-A", "deviceLabel": "Laptop A"}
    )
    assert response.status_code == 200
    licence = response.json()["licence"]
    assert licence["tier"] == "solo"
    assert licence["isTrial"] is False
    assert licence["deviceId"] == "device-A"
    assert licence["graceDays"] == 30


def test_unknown_key_is_refused_404() -> None:
    """An unknown key is a 404 with the key_unknown code."""
    response = _client().post("/activate", json={"key": "NOPE", "deviceId": "device-A"})
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "key_unknown"


def test_second_device_on_a_solo_key_is_refused_then_transferable() -> None:
    """Ruling 15: a Solo key is one device; deactivate transfers the seat."""
    client = _client()
    client.post("/activate", json={"key": "K-SOLO", "deviceId": "device-A", "deviceLabel": "A"})

    second = client.post(
        "/activate", json={"key": "K-SOLO", "deviceId": "device-B", "deviceLabel": "B"}
    )
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "key_bound_elsewhere"

    freed = client.post("/deactivate", json={"deviceId": "device-A"})
    assert freed.status_code == 200
    assert freed.json()["released"] is True

    after = client.post(
        "/activate", json={"key": "K-SOLO", "deviceId": "device-B", "deviceLabel": "B"}
    )
    assert after.status_code == 200


def test_reactivating_the_same_device_is_an_idempotent_refresh() -> None:
    """Re-activating the same device on a Solo key is a refresh, not a new seat."""
    client = _client()
    client.post("/activate", json={"key": "K-SOLO", "deviceId": "device-A"})
    again = client.post("/activate", json={"key": "K-SOLO", "deviceId": "device-A"})
    assert again.status_code == 200


def test_a_studio_key_admits_more_than_one_device() -> None:
    """A multi-seat Studio key binds a second device without refusal."""
    client = _client()
    client.post("/activate", json={"key": "K-STUDIO", "deviceId": "device-A"})
    second = client.post("/activate", json={"key": "K-STUDIO", "deviceId": "device-B"})
    assert second.status_code == 200


def test_trial_is_issued_once_per_device() -> None:
    """Ruling 16: a trial is a real licence, one per device."""
    client = _client()
    first = client.post("/trial", json={"deviceId": "device-A", "deviceLabel": "A"})
    assert first.status_code == 200
    assert first.json()["licence"]["isTrial"] is True

    second = client.post("/trial", json={"deviceId": "device-A", "deviceLabel": "A"})
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "trial_already_used"


def test_v1_diagnostics_accepts_a_bundle_and_acknowledges_it() -> None:
    """The diagnostics endpoint accepts the JSON bundle and returns received + id."""
    body = {
        "bundleId": "b-1",
        "createdAt": 1756814400000,
        "appVersion": "1.0.0",
        "platform": "win32",
        "events": 2,
        "truncated": False,
        "ndjson": '{"kind":"main-uncaught"}\n{"kind":"api-error"}',
    }
    response = _client().post("/v1/diagnostics", json=body)
    assert response.status_code == 202
    payload = response.json()
    assert payload["received"] is True
    assert isinstance(payload["id"], str) and payload["id"]


def test_v1_diagnostics_refuses_a_non_json_body() -> None:
    """A body that is not JSON is a 4xx (bad_request), which the client drops."""
    response = _client().post(
        "/v1/diagnostics", content=b"not json", headers={"content-type": "application/json"}
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "bad_request"

"""Conformance suite for the deployed StrixGeo activation server (debt #3).

These cases drive the REAL PHP service over HTTPS and assert the rules written in
``docs/design/activation-api-contract.md``. They run ONLY when the environment
names a live server and a fresh key, so the offline unit suite
(``uv run pytest tests/unit``) never touches the network and stays green:

* ``STRIX_ACTIVATION_URL`` — the base URL, e.g.
  ``https://strixgeo.com/api/activation`` (a trailing slash is fine).
* ``STRIX_TEST_KEY`` — a **freshly minted** paid key (``php bin/mint.php
  --tier solo --seats 1 --expires 2027-01-01 …``). Fresh so its one seat is free
  at the start of the run; mint it far in the future so ``/refresh`` rolls the
  wire ``expiresAt`` forward (the grace-clock reset the contract §4 describes).
* ``STRIX_ADMIN_TOKEN`` — optional; the "every call leaves an events row" case
  skips without it, the rest still run. Must equal ``config.php``'s
  ``admin_token`` so ``GET /admin/events`` answers.

The tests are written to READ like the contract: each docstring paraphrases the
rule it pins, in the contract's own words, not the server's internals.
"""

from __future__ import annotations

import os
import re
import time
import uuid

import pytest

httpx = pytest.importorskip("httpx")

BASE_URL = (os.environ.get("STRIX_ACTIVATION_URL") or "").rstrip("/")
TEST_KEY = os.environ.get("STRIX_TEST_KEY") or ""
ADMIN_TOKEN = os.environ.get("STRIX_ADMIN_TOKEN") or ""

if not BASE_URL or not TEST_KEY:
    pytest.skip(
        "set STRIX_ACTIVATION_URL and STRIX_TEST_KEY to run the activation conformance suite",
        allow_module_level=True,
    )

#: Contract §3 — the licence's tier is exactly one of these; the client rejects any other.
WIRE_TIERS = {"solo", "pro", "studio"}

#: The minted-key format this build ships: STRIX- + four Crockford-base32 groups (no I/L/O/U).
KEY_FORMAT = re.compile(r"^STRIX-[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$")

#: Owner ruling 14 — the licence advertises a 30-day offline grace window.
EXPECTED_GRACE_DAYS = 30


def _client() -> httpx.Client:
    """Return an HTTP client aimed at the activation base URL."""
    return httpx.Client(base_url=BASE_URL, timeout=10.0)


def _run_id() -> str:
    """Return a short random tag so each run uses device ids nothing else holds."""
    return uuid.uuid4().hex[:12]


def _assert_licence_shape(licence: dict, *, device_id: str, is_trial: bool) -> None:
    """Assert a wire licence carries every §3 field with the right type and set.

    Parameters
    ----------
    licence : dict
        The object under the response's ``licence`` key.
    device_id : str
        The device id the request carried; the licence must echo it.
    is_trial : bool
        Whether this licence was issued by ``/trial``.
    """
    for field in (
        "key",
        "tier",
        "seatId",
        "isTrial",
        "issuedAt",
        "expiresAt",
        "graceDays",
        "deviceId",
        "deviceLabel",
    ):
        assert field in licence, f"licence is missing the §3 field {field!r}"

    assert licence["tier"] in WIRE_TIERS, "tier must be one of solo|pro|studio (§3)"
    assert isinstance(licence["isTrial"], bool)
    assert licence["isTrial"] is is_trial
    assert isinstance(licence["issuedAt"], int)
    assert isinstance(licence["expiresAt"], int)
    assert isinstance(licence["graceDays"], int)
    assert licence["graceDays"] == EXPECTED_GRACE_DAYS, "offline grace is 30 days (ruling 14)"
    assert licence["deviceId"] == device_id, "the licence echoes the request's deviceId (§3)"
    # expiresAt is the authoritative end and lies in the future of issuance.
    assert licence["expiresAt"] > licence["issuedAt"]


def test_activation_lifecycle_binds_refreshes_and_transfers_a_seat() -> None:
    """Walk the paid-key lifecycle the contract §4/§6 defines.

    A known key binds a device and returns its licence (§3); re-activating the
    SAME device is a refresh, not a second seat (§6); a SECOND device on a 1-seat
    key is refused ``key_bound_elsewhere`` (§5); ``/refresh`` re-issues a licence
    with a fresh ``expiresAt`` (§4); ``/deactivate`` frees the seat (§4), after
    which the second device activates — that release IS the transfer.
    """
    run = _run_id()
    device_a = f"conf-A-{run}"
    device_b = f"conf-B-{run}"

    with _client() as client:
        try:
            # 1. A known key binds device A and returns the §3 licence.
            first = client.post(
                "/activate",
                json={"key": TEST_KEY, "deviceId": device_a, "deviceLabel": "Conf A"},
            )
            assert first.status_code == 200, (
                "expected 200; if 409, STRIX_TEST_KEY's seat is already bound — mint a fresh key"
            )
            licence_a = first.json()["licence"]
            _assert_licence_shape(licence_a, device_id=device_a, is_trial=False)
            assert licence_a["key"] == TEST_KEY, "the licence echoes the activated key (§3)"
            assert KEY_FORMAT.match(TEST_KEY), "the key follows the STRIX-XXXX-… format"

            # 2. Re-activating the SAME device is an idempotent refresh (§6): same
            #    seat, not a new one.
            again = client.post(
                "/activate",
                json={"key": TEST_KEY, "deviceId": device_a, "deviceLabel": "Conf A"},
            )
            assert again.status_code == 200
            assert again.json()["licence"]["seatId"] == licence_a["seatId"], (
                "the same device keeps its seat, not a second one (§6)"
            )

            # 3. A SECOND device on a 1-seat (Solo) key is refused (§5).
            second = client.post(
                "/activate",
                json={"key": TEST_KEY, "deviceId": device_b, "deviceLabel": "Conf B"},
            )
            assert second.status_code == 409
            assert second.json()["error"]["code"] == "key_bound_elsewhere"

            # 4. /refresh re-issues the licence with a fresh expiresAt (§4). The
            #    short wait makes the rolling horizon advance, so the reset is
            #    observable; issuedAt always advances.
            time.sleep(1.2)
            refreshed = client.post("/refresh", json={"key": TEST_KEY, "deviceId": device_a})
            assert refreshed.status_code == 200
            licence_r = refreshed.json()["licence"]
            _assert_licence_shape(licence_r, device_id=device_a, is_trial=False)
            assert licence_r["issuedAt"] > licence_a["issuedAt"], "refresh re-issues (newer issued)"
            assert licence_r["expiresAt"] >= licence_a["expiresAt"], (
                "refresh returns a fresh (never earlier) expiresAt — the grace-clock reset (§4)"
            )

            # 5. /deactivate frees the seat (§4) …
            freed = client.post("/deactivate", json={"deviceId": device_a})
            assert freed.status_code == 200
            assert freed.json()["released"] is True

            # 6. … so the second device now activates — the transfer completed.
            transferred = client.post(
                "/activate",
                json={"key": TEST_KEY, "deviceId": device_b, "deviceLabel": "Conf B"},
            )
            assert transferred.status_code == 200
            _assert_licence_shape(transferred.json()["licence"], device_id=device_b, is_trial=False)
        finally:
            # Leave the key's seat free for the next run of this suite.
            client.post("/deactivate", json={"deviceId": device_a})
            client.post("/deactivate", json={"deviceId": device_b})


def test_deactivate_of_an_unknown_device_is_404() -> None:
    """A device the server never bound answers 404 (§4).

    The client treats a 404 as "already released elsewhere" and clears its local
    licence, so a device whose binding was dropped server-side still returns to
    the activation screen.
    """
    with _client() as client:
        response = client.post("/deactivate", json={"deviceId": f"conf-nobody-{_run_id()}"})
    assert response.status_code == 404


def test_trial_is_a_30_day_licence_issued_once_per_device() -> None:
    """A trial is a real, server-issued, time-limited licence, one per device (§4).

    The first ``/trial`` for a device returns an ``isTrial`` licence whose tier is
    ``solo`` (§3 forbids a ``trial`` tier on the wire) and whose end is ~30 days
    out (ruling 16); a second call for the same device is
    ``trial_already_used`` (§5).
    """
    device = f"conf-trial-{_run_id()}"
    with _client() as client:
        first = client.post("/trial", json={"deviceId": device, "deviceLabel": "Conf Trial"})
        assert first.status_code == 200
        licence = first.json()["licence"]
        _assert_licence_shape(licence, device_id=device, is_trial=True)
        assert KEY_FORMAT.match(licence["key"]), "trial key follows the STRIX-XXXX-… format"
        # ~30 days from issuance, within a generous day of tolerance.
        span_days = (licence["expiresAt"] - licence["issuedAt"]) / 86_400_000
        assert 29 <= span_days <= 31, "a trial runs ~30 days (ruling 16)"

        second = client.post("/trial", json={"deviceId": device, "deviceLabel": "Conf Trial"})
        assert second.status_code == 409
        assert second.json()["error"]["code"] == "trial_already_used"


def test_diagnostics_accepts_a_bundle_and_acknowledges_it() -> None:
    """A consent-gated diagnostics bundle is stored and acknowledged (§4).

    The endpoint returns a 2xx with ``received: true`` and a server-chosen ``id``
    the client logs for support correlation.
    """
    body = {
        "bundleId": f"conf-{_run_id()}",
        "createdAt": int(time.time() * 1000),
        "appVersion": "1.0.0",
        "platform": "win32",
        "events": 2,
        "truncated": False,
        "ndjson": '{"kind":"main-uncaught"}\n{"kind":"api-error"}',
    }
    with _client() as client:
        response = client.post("/v1/diagnostics", json=body)
    assert response.status_code // 100 == 2
    payload = response.json()
    assert payload["received"] is True
    assert isinstance(payload["id"], str) and payload["id"]


def test_diagnostics_over_the_512_kib_cap_is_413() -> None:
    """A bundle larger than 512 KiB is refused 413 (§4).

    The client treats a 4xx as permanent and drops the bundle rather than looping
    the oldest-first queue.
    """
    body = {
        "bundleId": f"conf-big-{_run_id()}",
        "createdAt": int(time.time() * 1000),
        "appVersion": "1.0.0",
        "platform": "win32",
        "events": 1,
        "truncated": False,
        "ndjson": "x" * (600 * 1024),  # comfortably over 512 KiB once JSON-encoded
    }
    with _client() as client:
        response = client.post("/v1/diagnostics", json=body)
    assert response.status_code == 413


def test_diagnostics_with_a_non_json_body_is_400() -> None:
    """A diagnostics body that is not JSON is a 400 bad_request (§4/§5)."""
    with _client() as client:
        response = client.post(
            "/v1/diagnostics",
            content=b"this is not json",
            headers={"content-type": "application/json"},
        )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "bad_request"


def test_every_call_including_a_refusal_leaves_an_events_row() -> None:
    """Every call — successes AND refusals — writes an ``activation_events`` row.

    This is the table the owner reads to see who is testing and when. A
    deactivate of an unknown device (a 404 refusal) must still appear as a
    ``refused`` event for that device, proving the refusal path logs too. Read
    back through the admin endpoint, which the ``admin_token`` guards.
    """
    if not ADMIN_TOKEN:
        pytest.skip("set STRIX_ADMIN_TOKEN to assert against GET /admin/events")

    device = f"conf-evt-{_run_id()}"
    with _client() as client:
        refusal = client.post("/deactivate", json={"deviceId": device})
        assert refusal.status_code == 404

        events = client.get("/admin/events", params={"token": ADMIN_TOKEN, "limit": 50})
        assert events.status_code == 200, "admin token should open GET /admin/events"

    rows = events.json()["events"]
    mine = [row for row in rows if row.get("deviceId") == device]
    assert mine, "the refusal left no activation_events row"
    assert any(row["kind"] == "refused" for row in mine), "the refusal was not logged as 'refused'"

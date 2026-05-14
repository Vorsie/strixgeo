"""Unit tests for the bundle's ``_to_json`` / ``_from_json`` helpers.

The bundle serializer enumerates every column on every ORM via
``__mapper__.column_attrs``, so the helpers have to handle every
column type that lands on disk. A missing case manifests as a
``PydanticSerializationError`` deep in the FastAPI response path —
hard to attribute back to the bundle without these direct tests.

Regression coverage for the ``bytes`` case: ``FormationSurfaceOrm.
source_contact_checksum`` is ``LargeBinary``; without the bytes-to-
hex round-trip, ``GET /bundle`` 500s with ``invalid utf-8 sequence``
the moment any model has a cached surface.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timezone
from uuid import UUID

from groundmodel.infrastructure.db.repositories.project_bundle import (
    _from_json,
    _to_json,
)


def test_bytes_serialise_to_hex_string() -> None:
    """Raw bytes (e.g. a SHA digest) round-trip through hex."""
    digest = bytes.fromhex("deadbeef00112233445566778899aabbccddeeff")
    encoded = _to_json(digest)
    assert isinstance(encoded, str)
    assert encoded == "deadbeef00112233445566778899aabbccddeeff"


def test_bytes_round_trip_via_hex() -> None:
    """Encode then decode reproduces the exact bytes."""
    digest = bytes(range(256))  # every byte value 0..255
    encoded = _to_json(digest)
    decoded = _from_json(encoded, bytes)
    assert decoded == digest


def test_bytearray_and_memoryview_also_serialise() -> None:
    """``LargeBinary`` may come back from the driver as bytearray /
    memoryview depending on the dialect — the encoder must handle
    both like raw bytes.
    """
    payload = b"\x00\xff\x10"
    assert _to_json(bytearray(payload)) == "00ff10"
    assert _to_json(memoryview(payload)) == "00ff10"


def test_uuid_serialises_to_string() -> None:
    """UUID → str round-trip (the existing happy path stays put)."""
    u = UUID("019e2704-3352-7929-bf49-981bb9a02b3c")
    encoded = _to_json(u)
    assert encoded == "019e2704-3352-7929-bf49-981bb9a02b3c"
    assert _from_json(encoded, UUID) == u


def test_datetime_and_date_round_trip() -> None:
    """Datetime / date encode as ISO 8601 strings."""
    dt = datetime(2026, 5, 14, 17, 18, 0, tzinfo=UTC)
    assert _from_json(_to_json(dt), datetime) == dt
    d = date(2026, 5, 14)
    assert _from_json(_to_json(d), date) == d


def test_scalars_pass_through_unchanged() -> None:
    """str / int / float / None / bool aren't transformed."""
    for v in ("hello", 42, 3.14, None, True, False):
        assert _to_json(v) == v


def test_list_of_uuids_converts_element_wise() -> None:
    """Lists recurse so an array of UUIDs becomes an array of strings."""
    ids = [
        UUID("00000000-0000-0000-0000-000000000001"),
        UUID("00000000-0000-0000-0000-000000000002"),
    ]
    assert _to_json(ids) == [
        "00000000-0000-0000-0000-000000000001",
        "00000000-0000-0000-0000-000000000002",
    ]

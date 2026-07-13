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

from datetime import UTC, date, datetime
from uuid import UUID

from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.infrastructure.db.repositories.project_bundle import (
    _apply_json_to_kwargs,
    _from_json,
    _normalise_restore_keys,
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


def test_seeded_formation_contact_ids_round_trip() -> None:
    """seeded_formation_contact_ids (ARRAY(UUID)) serialises and survives restore.

    The column is the same type as excluded_borehole_ids: ARRAY(PG_UUID).
    _to_json converts each UUID to a string; _from_json(value, list) passes
    the string list through unchanged so the DB layer receives it.
    PostgreSQL's asyncpg driver coerces string UUIDs back to the native UUID
    type on insert — this test verifies the _to_json / _from_json contract
    matches that expectation (same behaviour as excluded_borehole_ids which is
    already DB-round-trip tested in test_bundle_carries_cross_sections).
    """
    contact_ids = [
        UUID("11111111-1111-1111-1111-111111111111"),
        UUID("22222222-2222-2222-2222-222222222222"),
    ]
    serialised = _to_json(contact_ids)
    assert serialised == [
        "11111111-1111-1111-1111-111111111111",
        "22222222-2222-2222-2222-222222222222",
    ], "seeded_formation_contact_ids UUIDs must serialise to lowercase strings"

    # _from_json with python_type=list passes the list through unchanged.
    # The string list is what _apply_json_to_kwargs hands to the ORM constructor;
    # asyncpg then coerces the strings back to UUID on insert.
    restored = _from_json(serialised, list)
    assert restored == serialised, (
        "_from_json(list_of_strings, list) must pass through unchanged "
        "so the ORM constructor accepts it"
    )

    # Empty set is the common case (freshly-drawn, never-seeded section).
    assert _to_json([]) == []
    assert _from_json([], list) == []


# ---------------------------------------------------------------------------
# Read-side bundle-key aliases (_RESTORE_KEY_ALIASES) — renamed columns must
# keep restoring from bundles written BEFORE the rename. One test per
# aliased key: an old-key payload lands in the NEW ORM column.
# ---------------------------------------------------------------------------


def test_old_companion_lens_id_key_restores_into_companion_body_id() -> None:
    """A pre-#222 bundle key ``companion_lens_id`` maps onto ``companion_body_id``."""
    body_id = "33333333-3333-3333-3333-333333333333"
    kwargs = _apply_json_to_kwargs(CrossSectionOrm, {"companion_lens_id": body_id})
    assert kwargs == {"companion_body_id": UUID(body_id)}


def test_old_is_lens_companion_key_restores_into_is_body_companion() -> None:
    """A pre-#222 bundle key ``is_lens_companion`` maps onto ``is_body_companion``."""
    kwargs = _apply_json_to_kwargs(CrossSectionOrm, {"is_lens_companion": True})
    assert kwargs == {"is_body_companion": True}


def test_new_companion_keys_win_over_stale_old_keys() -> None:
    """When both spellings appear, the current key's value is kept."""
    new_id = "44444444-4444-4444-4444-444444444444"
    kwargs = _apply_json_to_kwargs(
        CrossSectionOrm,
        {
            "companion_lens_id": "33333333-3333-3333-3333-333333333333",
            "companion_body_id": new_id,
        },
    )
    assert kwargs == {"companion_body_id": UUID(new_id)}


def test_old_parent_geological_model_id_key_restores_into_parent_model_id() -> None:
    """A pre-NAME-09 bundle key ``parent_geological_model_id`` maps onto ``parent_model_id``."""
    parent_id = "55555555-5555-5555-5555-555555555555"
    kwargs = _apply_json_to_kwargs(GeologicalModelOrm, {"parent_geological_model_id": parent_id})
    assert kwargs == {"parent_model_id": UUID(parent_id)}


def test_old_edge_contact_keys_restore_into_layer_columns() -> None:
    """Pre-ARCH-08 bundle keys ``contact_a_id``/``contact_b_id`` map onto
    ``layer_a_id``/``layer_b_id``."""
    a_id = "66666666-6666-6666-6666-666666666666"
    b_id = "77777777-7777-7777-7777-777777777777"
    kwargs = _apply_json_to_kwargs(
        LithoContactCorrelationEdgeOrm, {"contact_a_id": a_id, "contact_b_id": b_id}
    )
    assert kwargs == {"layer_a_id": UUID(a_id), "layer_b_id": UUID(b_id)}


def test_old_edge_contact_side_keys_restore_into_layer_side_columns() -> None:
    """Pre-ARCH-08 bundle keys ``contact_a_side``/``contact_b_side`` map onto
    ``layer_a_side``/``layer_b_side``."""
    kwargs = _apply_json_to_kwargs(
        LithoContactCorrelationEdgeOrm, {"contact_a_side": "top", "contact_b_side": "base"}
    )
    assert kwargs == {"layer_a_side": "top", "layer_b_side": "base"}


def test_normalise_restore_keys_is_noop_without_alias_entry() -> None:
    """ORM classes without an alias entry pass their payload through untouched."""
    payload = {"id": "88888888-8888-8888-8888-888888888888", "unknown_key": 1}
    assert _normalise_restore_keys(ObservationOrm, payload) is payload

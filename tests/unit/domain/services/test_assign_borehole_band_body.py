"""Unit tests for assign_borehole_band_body — nearest geotech body picker.

Follows TDD: tests were written BEFORE the implementation.  Each comment
is phrased in the rule's own vocabulary (band / nearest / same-class /
tie-break), not in terms of implementation internals.

Rules under test
----------------
* Among CPT bands whose ``nad_class`` matches the borehole band being
  assigned, the band belonging to the spatially NEAREST CPT wins.
* CPT bands with a different ``nad_class`` are ignored entirely.
* If no same-class CPT band exists (or all have ``body_id=None``), return
  ``None`` (the borehole band is a conservative fallback with no CPT
  evidence of that packing class).
* On an exact distance tie, the CPT with the lexicographically smallest
  ``body_id`` string wins (deterministic for any dataset).
"""

from __future__ import annotations

from uuid import UUID

from groundmodel.domain.services.assign_borehole_band_body import (
    CptBandRef,
    assign_borehole_band_body,
)

# ---------------------------------------------------------------------------
# Stable UUIDs for deterministic test assertions
# ---------------------------------------------------------------------------

_BODY_A = UUID("00000000-0000-0000-0000-000000000001")
_BODY_B = UUID("00000000-0000-0000-0000-000000000002")
_BODY_C = UUID("00000000-0000-0000-0000-000000000003")


# ---------------------------------------------------------------------------
# AB-1  nearest same-class CPT wins
# ---------------------------------------------------------------------------


def test_nearest_same_class_wins() -> None:
    """Borehole at (200, 200): near CPT at (220, 200) beats far CPT at (400, 200)."""
    bands = [
        CptBandRef(cpt_x=220.0, cpt_y=200.0, nad_class=6, body_id=_BODY_A),
        CptBandRef(cpt_x=400.0, cpt_y=200.0, nad_class=6, body_id=_BODY_B),
    ]
    result = assign_borehole_band_body(6, 200.0, 200.0, bands)
    assert result == _BODY_A, f"Expected BODY_A (nearest), got {result}"


# ---------------------------------------------------------------------------
# AB-2  CPT bands with a different nad_class are ignored
# ---------------------------------------------------------------------------


def test_different_class_ignored() -> None:
    """The near CPT has nad_class=10; only the far CPT with nad_class=6 is valid."""
    bands = [
        CptBandRef(cpt_x=100.0, cpt_y=100.0, nad_class=10, body_id=_BODY_B),  # wrong class
        CptBandRef(cpt_x=500.0, cpt_y=100.0, nad_class=6, body_id=_BODY_A),  # right class, far
    ]
    # _BODY_B is closer but wrong class; only _BODY_A matches the query class.
    result = assign_borehole_band_body(6, 100.0, 100.0, bands)
    assert result == _BODY_A, f"Expected BODY_A (only same-class), got {result}"


# ---------------------------------------------------------------------------
# AB-3  empty band list → None
# ---------------------------------------------------------------------------


def test_empty_list_returns_none() -> None:
    """No CPT bands in the group → None (no CPT evidence for any class)."""
    result = assign_borehole_band_body(6, 100.0, 100.0, [])
    assert result is None


# ---------------------------------------------------------------------------
# AB-4  no same-class match → None (even if other classes present)
# ---------------------------------------------------------------------------


def test_no_matching_class_returns_none() -> None:
    """All CPT bands carry class 10 and 12; querying for class 6 → None."""
    bands = [
        CptBandRef(cpt_x=100.0, cpt_y=100.0, nad_class=10, body_id=_BODY_A),
        CptBandRef(cpt_x=200.0, cpt_y=100.0, nad_class=12, body_id=_BODY_B),
    ]
    result = assign_borehole_band_body(6, 100.0, 100.0, bands)
    assert result is None


# ---------------------------------------------------------------------------
# AB-5  exact distance tie → smaller body_id string wins (deterministic)
# ---------------------------------------------------------------------------


def test_exact_distance_tie_smaller_body_id_wins() -> None:
    """Two equidistant CPTs: lexicographically smaller body_id string is returned."""
    # Borehole at (200, 200); both CPTs are exactly 100 m away on opposite sides.
    bands = [
        CptBandRef(cpt_x=300.0, cpt_y=200.0, nad_class=6, body_id=_BODY_B),  # larger str
        CptBandRef(cpt_x=100.0, cpt_y=200.0, nad_class=6, body_id=_BODY_A),  # smaller str
    ]
    result = assign_borehole_band_body(6, 200.0, 200.0, bands)
    # str(_BODY_A) == "00000000-0000-0000-0000-000000000001"
    # str(_BODY_B) == "00000000-0000-0000-0000-000000000002"
    # _BODY_A < _BODY_B lexicographically → BODY_A wins the tie.
    assert result == _BODY_A, f"Expected BODY_A (smaller body_id on tie), got {result}"


# ---------------------------------------------------------------------------
# AB-6  same-class band with body_id=None is skipped
# ---------------------------------------------------------------------------


def test_none_body_id_skipped() -> None:
    """A same-class band whose body_id=None is skipped; the next valid one wins."""
    bands = [
        CptBandRef(cpt_x=100.0, cpt_y=100.0, nad_class=6, body_id=None),  # near, but unresolved
        CptBandRef(cpt_x=500.0, cpt_y=100.0, nad_class=6, body_id=_BODY_A),  # farther but valid
    ]
    result = assign_borehole_band_body(6, 100.0, 100.0, bands)
    assert result == _BODY_A, f"Expected BODY_A (only resolved match), got {result}"


# ---------------------------------------------------------------------------
# AB-7  all same-class bands have body_id=None → None
# ---------------------------------------------------------------------------


def test_all_same_class_none_body_id_returns_none() -> None:
    """If all same-class bands are unresolved (body_id=None), return None."""
    bands = [
        CptBandRef(cpt_x=100.0, cpt_y=100.0, nad_class=6, body_id=None),
        CptBandRef(cpt_x=200.0, cpt_y=100.0, nad_class=6, body_id=None),
    ]
    result = assign_borehole_band_body(6, 100.0, 100.0, bands)
    assert result is None


# ---------------------------------------------------------------------------
# AB-8  single matching band → that body_id is returned
# ---------------------------------------------------------------------------


def test_single_matching_band_returned() -> None:
    """Exactly one same-class band → its body_id is returned unconditionally."""
    bands = [
        CptBandRef(cpt_x=999.0, cpt_y=999.0, nad_class=6, body_id=_BODY_C),
    ]
    result = assign_borehole_band_body(6, 0.0, 0.0, bands)
    assert result == _BODY_C

"""Unit tests for assign_sample_to_band — pure midpoint-lookup helper.

Tests follow TDD: tests were written before the implementation.  Each test
comment is phrased in the rule's own vocabulary (sample / midpoint / band /
unresolved), not in terms of internal variable names.
"""

from __future__ import annotations

from groundmodel.domain.services.assign_sample_to_band import Band, assign_sample_to_band

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

_ZAND_BAND = Band(top=0.0, base=3.0, body_id="Bx", nad_class=6, source="cpt_interpolated")
_KLEI_BAND = Band(top=3.0, base=6.0, body_id="By", nad_class=21, source="body_min")
_TWO_BAND_LIST = [_ZAND_BAND, _KLEI_BAND]


# ---------------------------------------------------------------------------
# SA-1  midpoint falls clearly inside a band → that band is returned
# ---------------------------------------------------------------------------


def test_sample_midpoint_picks_its_band() -> None:
    """Sample [2.5, 2.85]: midpoint 2.675 lies in [0, 3] → returns Bx / NAD 6."""
    # mid = (2.5 + 2.85) / 2 = 2.675, clearly inside band [0, 3]
    result = assign_sample_to_band(2.5, 2.85, _TWO_BAND_LIST)
    assert result == ("Bx", 6, "cpt_interpolated")


# ---------------------------------------------------------------------------
# SA-2  sample straddles a band boundary — midpoint decides
# ---------------------------------------------------------------------------


def test_spanning_sample_uses_midpoint() -> None:
    """Sample [2.8, 3.4]: midpoint 3.1 lies in [3, 6] → returns By / NAD 21."""
    # mid = (2.8 + 3.4) / 2 = 3.1, lands in band [3, 6]
    result = assign_sample_to_band(2.8, 3.4, _TWO_BAND_LIST)
    assert result[:2] == ("By", 21)


def test_spanning_sample_source_is_from_band() -> None:
    """Spanning sample: the returned source tag must come from the matched band."""
    body_id, nad, source = assign_sample_to_band(2.8, 3.4, _TWO_BAND_LIST)
    assert source == "body_min"


# ---------------------------------------------------------------------------
# SA-3  midpoint lies outside all bands → unresolved
# ---------------------------------------------------------------------------


def test_sample_outside_all_bands_unresolved() -> None:
    """Sample [9.0, 9.5] with bands only up to 3 m → (None, None, 'unresolved')."""
    result = assign_sample_to_band(9.0, 9.5, [_ZAND_BAND])
    assert result == (None, None, "unresolved")


def test_sample_above_all_bands_unresolved() -> None:
    """Sample midpoint above the top of all bands → unresolved."""
    # Bands start at 5 m, sample at 0-1 m (mid=0.5) → unresolved.
    bands = [Band(5.0, 10.0, "Bz", 10, "cpt_interpolated")]
    result = assign_sample_to_band(0.0, 1.0, bands)
    assert result == (None, None, "unresolved")


# ---------------------------------------------------------------------------
# SA-4  empty band list → unresolved
# ---------------------------------------------------------------------------


def test_empty_band_list_unresolved() -> None:
    """No bands at all → (None, None, 'unresolved')."""
    result = assign_sample_to_band(1.0, 2.0, [])
    assert result == (None, None, "unresolved")


# ---------------------------------------------------------------------------
# SA-5  spot sample (top == base) — midpoint == top == base
# ---------------------------------------------------------------------------


def test_spot_sample_same_top_base() -> None:
    """Spot sample (top==base==2.0): midpoint 2.0 is in band [0,3] → Bx."""
    # DOV sometimes stores spot samples with top==base.
    result = assign_sample_to_band(2.0, 2.0, _TWO_BAND_LIST)
    assert result == ("Bx", 6, "cpt_interpolated")


# ---------------------------------------------------------------------------
# SA-6  single-band list — sample inside
# ---------------------------------------------------------------------------


def test_single_band_sample_inside() -> None:
    """Single band: sample midpoint inside → that band is returned."""
    bands = [Band(0.0, 8.0, "B1", 21, "absolute_min")]
    result = assign_sample_to_band(3.0, 5.0, bands)
    assert result == ("B1", 21, "absolute_min")


# ---------------------------------------------------------------------------
# SA-7  midpoint exactly on the band base edge — belongs to that band
# ---------------------------------------------------------------------------


def test_midpoint_at_band_base_edge() -> None:
    """Midpoint on a band's base edge: first (shallowest) matching band wins."""
    # Sample [1.0, 5.0]: mid=3.0, the exact base of band [0,3] and the top of
    # [3,6]. Both satisfy top <= mid <= base; iteration order makes the
    # shallower [0,3] the first match → it wins. This pins the documented,
    # deterministic tie-break rather than accepting either band.
    bands = [Band(0.0, 3.0, "Bx", 6, "cpt_interpolated"), Band(3.0, 6.0, "By", 21, "body_min")]
    body_id, nad, _src = assign_sample_to_band(1.0, 5.0, bands)
    assert body_id == "Bx"
    assert nad == 6


# ---------------------------------------------------------------------------
# SB-8  band with body_id=None (conservative fallback) — sample still gets
#        nad_class + source, but body_id is None
#        (SB-N here = Sample-to-Band unit suite; the integration suite uses SA-N)
# ---------------------------------------------------------------------------


def test_fallback_band_none_body_id_still_assigns_nad_class() -> None:
    """A matched band whose body_id=None: nad_class + source still assigned, body_id=None.

    Conservative fallback bands (body_min / absolute_min) have no geotech
    body to join; the sample still receives the packing class + provenance
    so it can be rendered in the inspector, but geotech_body_id on the
    sample row is None.
    """
    fallback = Band(top=0.0, base=5.0, body_id=None, nad_class=21, source="absolute_min")
    body_id, nad_class, source = assign_sample_to_band(1.0, 2.0, [fallback])
    assert body_id is None, f"Expected None body_id for fallback band, got {body_id!r}"
    assert nad_class == 21
    assert source == "absolute_min"

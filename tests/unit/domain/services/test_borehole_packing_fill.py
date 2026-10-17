"""Unit tests for ``fill_borehole_litho_body_extent`` (Task 3 — litho-confined fill).

TDD: these tests were written BEFORE the implementation.  They assert the
USER'S RULE ("clip CPT intervals to the litho-body extent; fill gaps
conservatively") in the user's vocabulary, not in terms of the
implementation's variable names.

Test matrix
-----------
PF-1  CPT intervals that cross the extent boundary are CLIPPED, not
      proportionally rescaled — an interval ending at 7.5 m is cut at 5.0 m.
PF-2  A depth gap between CPT-covered intervals is filled with one
      ``body_min`` band at the body's minimum NAD class.
PF-3  When no CPT intervals are provided (borehole-only body), the whole
      extent gets a single ``absolute_min`` band.
PF-4  No emitted band ever reaches outside ``[extent_top, extent_base]``.
PF-5  CPT intervals completely above or below the extent are dropped.
PF-6  A gap at the tail (after the last CPT interval) fills with ``body_min``.
PF-7  When ``body_min_class`` is ``None``, gaps fill with ``absolute_min``.
PF-8  Bands tile the full extent — no internal voids.
PF-9  ``body_min`` source carries ``body_min_class`` as NAD class.
PF-10 ``absolute_min`` source carries ``litho_abs_min_class`` as NAD class.
"""

from __future__ import annotations

from groundmodel.domain.services.borehole_packing_fill import (
    FillBand,
    fill_borehole_litho_body_extent,
)

# ---------------------------------------------------------------------------
# PF-1: clip at extent boundary — no rescale
# ---------------------------------------------------------------------------


def test_pf1_clip_not_rescale_crosscut():
    """Sand extent 0-5 m; CPT has loose(5) 0–3.5 m, med(6) 3.5–7.5 m, dense(7) 7.5+ m.

    The med band's base (7.5 m) lies beyond the extent (5.0 m) — it must be
    CLIPPED to 5.0 m.  The dense band (7.5–∞) is fully outside → dropped.
    """
    surfaces = [
        (0.0, 3.5, 5),  # loose — fully inside extent [0, 5]
        (3.5, 7.5, 6),  # med — crosses the 5 m boundary → clip base to 5
        (7.5, 10.0, 7),  # dense — fully outside → dropped
    ]
    bands = fill_borehole_litho_body_extent(
        extent_top=0.0,
        extent_base=5.0,
        cpt_packing_surfaces=surfaces,
        body_min_class=5,
        litho_abs_min_class=5,
    )
    result = [(round(b.top, 3), round(b.base, 3), b.nad_class) for b in bands]
    assert result == [(0.0, 3.5, 5), (3.5, 5.0, 6)], (
        "PF-1: dense band must be clipped at the extent boundary, not rescaled"
    )
    assert all(b.source == "cpt_interpolated" for b in bands), (
        "PF-1: all bands inside extent from CPT data must have source='cpt_interpolated'"
    )


# ---------------------------------------------------------------------------
# PF-2: gap in CPT coverage → body_min fill
# ---------------------------------------------------------------------------


def test_pf2_uncovered_tail_fills_body_min():
    """CPT surfaces only cover 0–2 m (med class 6); the tail 2–5 m has no CPT.

    The uncovered tail must be filled with a ``body_min`` band at class 6.
    """
    surfaces = [(0.0, 2.0, 6)]
    bands = fill_borehole_litho_body_extent(
        extent_top=0.0,
        extent_base=5.0,
        cpt_packing_surfaces=surfaces,
        body_min_class=6,
        litho_abs_min_class=5,
    )
    assert len(bands) == 2, "PF-2: should have one CPT band and one body_min tail"
    cpt_band, tail = bands
    assert (round(cpt_band.top, 3), round(cpt_band.base, 3), cpt_band.nad_class) == (0.0, 2.0, 6)
    assert cpt_band.source == "cpt_interpolated"
    assert (round(tail.top, 3), round(tail.base, 3), tail.nad_class) == (2.0, 5.0, 6)
    assert tail.source == "body_min", "PF-2: tail gap must be tagged body_min"


# ---------------------------------------------------------------------------
# PF-3: no CPT intervals → single absolute_min band
# ---------------------------------------------------------------------------


def test_pf3_no_cpt_uses_absolute_min():
    """Borehole-only body (no CPT intervals): whole extent → single ``absolute_min`` band."""
    bands = fill_borehole_litho_body_extent(
        extent_top=0.0,
        extent_base=5.0,
        cpt_packing_surfaces=[],
        body_min_class=None,
        litho_abs_min_class=5,
    )
    assert bands == [FillBand(top=0.0, base=5.0, nad_class=5, source="absolute_min")], (
        "PF-3: empty CPT surfaces + no body_min → single absolute_min band"
    )


# ---------------------------------------------------------------------------
# PF-4: no band exceeds [extent_top, extent_base]
# ---------------------------------------------------------------------------


def test_pf4_no_band_exceeds_extent():
    """CPT intervals partially outside the extent must not bleed outside [2, 4]."""
    surfaces = [
        (1.0, 3.0, 5),  # starts before extent_top=2 → clip top to 2
        (3.0, 7.0, 6),  # ends after extent_base=4 → clip base to 4
    ]
    bands = fill_borehole_litho_body_extent(
        extent_top=2.0,
        extent_base=4.0,
        cpt_packing_surfaces=surfaces,
        body_min_class=5,
        litho_abs_min_class=5,
    )
    assert all(b.top >= 2.0 - 1e-9 and b.base <= 4.0 + 1e-9 for b in bands), (
        "PF-4: no band may reach outside [extent_top, extent_base]"
    )


# ---------------------------------------------------------------------------
# PF-5: CPT intervals fully outside the extent are dropped
# ---------------------------------------------------------------------------


def test_pf5_fully_outside_intervals_dropped():
    """CPT intervals at [0,1] and [6,8] are fully outside [2,4] → dropped."""
    surfaces = [
        (0.0, 1.0, 5),  # below extent top → fully outside
        (2.0, 4.0, 6),  # inside
        (6.0, 8.0, 7),  # above extent base → fully outside
    ]
    bands = fill_borehole_litho_body_extent(
        extent_top=2.0,
        extent_base=4.0,
        cpt_packing_surfaces=surfaces,
        body_min_class=5,
        litho_abs_min_class=5,
    )
    assert len(bands) == 1
    assert bands[0].nad_class == 6 and bands[0].source == "cpt_interpolated", (
        "PF-5: only the interval inside [2,4] should survive"
    )


# ---------------------------------------------------------------------------
# PF-6: gap at the head (before first CPT interval) → body_min
# ---------------------------------------------------------------------------


def test_pf6_head_gap_fills_body_min():
    """CPT surface starts at 1.5 m; extent is 0–5 m → head gap 0–1.5 m → body_min."""
    surfaces = [(1.5, 5.0, 7)]
    bands = fill_borehole_litho_body_extent(
        extent_top=0.0,
        extent_base=5.0,
        cpt_packing_surfaces=surfaces,
        body_min_class=6,
        litho_abs_min_class=5,
    )
    assert len(bands) == 2
    head, cpt_band = bands
    assert head.source == "body_min" and round(head.top, 3) == 0.0 and round(head.base, 3) == 1.5
    assert cpt_band.source == "cpt_interpolated"


# ---------------------------------------------------------------------------
# PF-7: body_min_class is None → gaps fill with absolute_min
# ---------------------------------------------------------------------------


def test_pf7_none_body_min_gaps_use_absolute_min():
    """When body_min_class is None, gaps must fill with absolute_min, not crash."""
    surfaces = [(2.0, 3.0, 13)]  # covers only 2–3; extent is 0–5
    bands = fill_borehole_litho_body_extent(
        extent_top=0.0,
        extent_base=5.0,
        cpt_packing_surfaces=surfaces,
        body_min_class=None,
        litho_abs_min_class=13,
    )
    gap_bands = [b for b in bands if b.source != "cpt_interpolated"]
    assert all(b.nad_class == 13 and b.source == "absolute_min" for b in gap_bands), (
        "PF-7: gaps with body_min_class=None must use litho_abs_min_class and source='absolute_min'"
    )


# ---------------------------------------------------------------------------
# PF-8: bands tile the full extent (no voids)
# ---------------------------------------------------------------------------


def test_pf8_bands_tile_full_extent():
    """All cases must produce bands whose union covers [extent_top, extent_base] with no gap."""
    surfaces = [(1.0, 2.0, 5), (3.5, 4.5, 6)]
    bands = fill_borehole_litho_body_extent(
        extent_top=0.0,
        extent_base=5.0,
        cpt_packing_surfaces=surfaces,
        body_min_class=5,
        litho_abs_min_class=5,
    )
    sorted_bands = sorted(bands, key=lambda b: b.top)
    assert abs(sorted_bands[0].top - 0.0) < 1e-9, "PF-8: first band must start at extent_top"
    assert abs(sorted_bands[-1].base - 5.0) < 1e-9, "PF-8: last band must end at extent_base"
    for i in range(1, len(sorted_bands)):
        gap = sorted_bands[i].top - sorted_bands[i - 1].base
        assert gap < 1e-9, f"PF-8: internal gap {gap:.6f} m found between bands {i - 1} and {i}"


# ---------------------------------------------------------------------------
# PF-9: body_min source carries body_min_class as NAD class
# ---------------------------------------------------------------------------


def test_pf9_body_min_carries_body_min_class():
    """A ``body_min`` band uses ``body_min_class``, not ``litho_abs_min_class``."""
    surfaces = [(0.0, 2.0, 8)]  # covers only top 2 m; extent 0–5
    bands = fill_borehole_litho_body_extent(
        extent_top=0.0,
        extent_base=5.0,
        cpt_packing_surfaces=surfaces,
        body_min_class=6,  # ← body_min_class intentionally != abs_min (5)
        litho_abs_min_class=5,
    )
    tail = next(b for b in bands if b.source == "body_min")
    assert tail.nad_class == 6, (
        "PF-9: body_min band must carry body_min_class (6), not litho_abs_min_class (5)"
    )


# ---------------------------------------------------------------------------
# PF-10: absolute_min source carries litho_abs_min_class as NAD class
# ---------------------------------------------------------------------------


def test_pf10_absolute_min_carries_litho_abs_min_class():
    """A ``absolute_min`` band uses ``litho_abs_min_class``."""
    bands = fill_borehole_litho_body_extent(
        extent_top=0.0,
        extent_base=3.0,
        cpt_packing_surfaces=[],
        body_min_class=None,
        litho_abs_min_class=21,  # KLEI minimum
    )
    assert len(bands) == 1
    assert bands[0].nad_class == 21 and bands[0].source == "absolute_min", (
        "PF-10: absolute_min band must carry litho_abs_min_class (21)"
    )

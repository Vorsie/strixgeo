"""The build must receive how the 2-D engine classified each region.

``computeSectionFillActive`` decides, per region, whether a body bands across the
gap, laps one side, or is an enclosed lens — the 2/1/0 semantics the litho stage is
built on. It also records that a user correlation fixed the region's base, and that
a region was deliberately kept only above a tie. Before debt #256 none of that
crossed the payload boundary, so the builder re-derived it from geometry and got it
wrong (see ``_stack_at``: "we have no band/onlap/lens kind to ramp").

Phrased in the classification's own vocabulary rather than in field names: a band
must arrive as a band, an enclosed lens must not arrive looking like an onlap, an
absolute base must survive, and a region split at a tie must say so.
"""

from __future__ import annotations

from groundmodel.api.schemas.project.voxel_build_request import RegionInputSchema

_POLYGON = [(0.0, 5.0), (1.0, 5.0), (1.0, 0.0), (0.0, 0.0)]


def _region(**overrides: object) -> RegionInputSchema:
    """A minimal valid region, with the classification fields left to the caller."""
    payload: dict[str, object] = {
        "formation_id": "ZAND",
        "body_id": "z",
        "polygon": _POLYGON,
        "gap_index": 0,
    }
    payload.update(overrides)
    return RegionInputSchema(**payload)  # type: ignore[arg-type]


def test_a_body_that_bands_across_the_gap_arrives_as_a_band() -> None:
    """``kind='quad'`` survives the boundary — the builder can see it is tied both sides."""
    assert _region(kind="quad").to_domain().kind == "quad"


def test_a_body_present_on_one_column_only_arrives_as_a_pinch() -> None:
    """``kind='pinch'`` survives, so a one-sided body is distinguishable from a band."""
    assert _region(kind="pinch").to_domain().kind == "pinch"


def test_an_enclosed_lens_is_not_confused_with_an_onlap() -> None:
    """The overlay tier survives, so the two carve tiers stay distinguishable.

    Both arrive as ``kind='lens'``; only ``overlay_tier`` separates a minority body
    fully enclosed by its matrix from one lapping a single bracket tie-line.
    """
    enclosed = _region(kind="lens", overlay_tier="lens").to_domain()
    lapping = _region(kind="lens", overlay_tier="onlap").to_domain()

    assert enclosed.kind == lapping.kind == "lens"
    assert enclosed.overlay_tier == "lens"
    assert lapping.overlay_tier == "onlap"


def test_a_base_fixed_by_a_user_correlation_survives() -> None:
    """``tied_band_base`` survives, so the shallow-TD cap cannot chop it flat.

    Owner directive 2026-07-08: a user correlation is absolute. The builder can only
    honour that if it is told the elevation the correlation fixed.
    """
    assert _region(tied_band_base=-7.61).to_domain().tied_band_base == -7.61


def test_a_region_split_at_a_tie_says_so() -> None:
    """``tie_clipped`` survives, so the builder will not re-merge across that tie."""
    assert _region(tie_clipped=True).to_domain().tie_clipped is True


def test_a_region_without_a_classification_is_still_accepted() -> None:
    """Every field is optional, so a payload written before #256 still loads.

    Bundles and stored build generations carry the old four-field shape; refusing it
    would make an old project unbuildable.
    """
    plain = _region().to_domain()

    assert plain.kind is None
    assert plain.overlay_tier is None
    assert plain.tied_band_base is None
    assert plain.tie_clipped is False

"""The geotech builders never cut a packing band at a geological line.

Owner, 2026-08-26: *"just drop the wall everywhere, user wil have to manually do
it"*.

Five clays in his project were cut by the wall. GEO-05/040-S3's clay ran
0.05-1.48 m and was cut at 0.57 m into NAD 21 over NAD 21 — twin halves of one
band, a pure artefact of a geological surface passing through it. The Tertiary
case he DOES want divided (GEO-10/171-B9, the Kortrijk top at 18.00 m) becomes a
hand split; the split tool already exists.

So the geological model stops being structure for the packing bands and becomes
an ATTRIBUTION: a band is LABELLED with the geological unit it mostly lies in
(the A2 precedent in ``docs/domain-model.md`` — thickness-weighted majority,
which for one interval is the unit containing its midpoint), and it is never
divided, never refused, and never clamped by one.

The first test below is a STRUCTURAL pin, in the shape the section engine
already uses for a deleted law ("kernel exports no thickness rule"): the cut
must be gone from the code, not merely unreachable, because an un-called cutting
transform sitting in the domain layer is an invitation to re-wire it.
"""

from __future__ import annotations

import inspect
from uuid import UUID

import groundmodel.application.divide_boreholes as divide_boreholes_module
import groundmodel.application.subdivide_all_bodies as subdivide_module
import groundmodel.domain.services.litho_geo_bounding as litho_geo_bounding
from groundmodel.application.geotech_borehole_materialiser import (
    GeotechBoreholeMaterialiser,
    _GeoSurface,
)
from groundmodel.domain.services.litho_body_pick import BodyLayerPick
from groundmodel.domain.value_objects.tin_surface import TinSurface

# A geological surface at a constant elevation, as a two-triangle square that
# covers the columns the tests place picks on.
GEO_UPPER_ID = UUID("11111111-1111-1111-1111-111111111111")
GEO_LOWER_ID = UUID("22222222-2222-2222-2222-222222222222")


def _flat_surface(formation_id: UUID, elevation: float) -> _GeoSurface:
    """A horizontal TIN at ``elevation`` spanning the test footprint."""
    return _GeoSurface(
        formation_id=formation_id,
        tin=TinSurface(
            vertices=[
                (-100.0, -100.0, elevation),
                (100.0, -100.0, elevation),
                (100.0, 100.0, elevation),
                (-100.0, 100.0, elevation),
            ],
            triangles=[(0, 1, 2), (0, 2, 3)],
        ),
    )


def _pick(inv: str, body: str, top: float, base: float, surface: float = 0.0) -> BodyLayerPick:
    """One body-assigned litho pick, depths below ``surface``."""
    return BodyLayerPick(
        investigation_id=inv,
        x_m=0.0,
        y_m=0.0,
        surface_elev_m=surface,
        body_id=body,
        formation_id="F-CLAY",
        top_depth_m=top,
        base_depth_m=base,
    )


def _grouper() -> GeotechBoreholeMaterialiser:
    """The shared materialiser, built without a database session.

    ``_group_segments`` and ``_geo_formation_at_midpoint`` are pure — they touch
    only their arguments — so the repositories the constructor builds are never
    reached and a ``None`` session is safe here.
    """
    return GeotechBoreholeMaterialiser(__name__, None)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# The cut is gone from the code
# ---------------------------------------------------------------------------


def test_nc1_the_domain_offers_no_transform_that_cuts_picks_at_geology() -> None:
    """NC1 — ``litho_geo_bounding`` exports no geology-cutting transform.

    A transform that divides a litho pick at a geological surface is the wall
    itself. It must not survive as dead code that a later change can re-wire:
    the owner's rule is that the machine never makes this cut.
    """
    public = {name for name in vars(litho_geo_bounding) if not name.startswith("_")}
    assert "divide_picks_by_geology" not in public
    assert not [name for name in public if "divide" in name.lower()]


def test_nc2_neither_geotech_builder_divides_its_picks_by_geology() -> None:
    """NC2 — the two builders name no such transform either.

    ``SubdivideAllBodies`` and ``DivideBoreholes`` both ran the cut as their
    transform 2. Transform 1 (``mark_and_truncate_shallow_tests``) is kept — it
    only FLAGS a test too shallow to floor the model and cuts nothing (separate
    owner directive, 2026-06-25).
    """
    for module in (subdivide_module, divide_boreholes_module):
        source = inspect.getsource(module)
        assert "divide_picks_by_geology" not in source, module.__name__
        assert "mark_and_truncate_shallow_tests" in source, module.__name__


# ---------------------------------------------------------------------------
# What the geological model does instead: it labels
# ---------------------------------------------------------------------------


def test_nc3_a_clay_crossed_by_a_geological_surface_stays_one_segment() -> None:
    """NC3 — his GEO-05/040-S3 clay: one band in, one band out.

    The clay runs 0.05-1.48 m with a geological surface passing through it at
    0.57 m. Before the ruling this reached the classifier as two pieces, each
    classified alone, and both landed on NAD 21 — twin halves the engineer then
    had to merge by hand. It must reach the classifier whole.
    """
    picks = [_pick("S3", "BODY-CLAY", 0.05, 1.48)]
    surfaces = [_flat_surface(GEO_LOWER_ID, -0.57)]

    groups = _grouper()._group_segments(picks, surfaces)

    assert len(groups) == 1, "the clay was divided by the geological surface"
    (segments,) = groups.values()
    assert len(segments) == 1
    assert (segments[0].top_depth_m, segments[0].base_depth_m) == (0.05, 1.48)


def test_nc4_a_straddling_band_is_labelled_by_the_unit_it_mostly_lies_in() -> None:
    """NC4 — attribution by thickness-weighted majority, not by the band's top.

    The pick runs 0.00-6.00 m with the geological contact at 1.00 m: 1.00 m in
    the upper unit, 5.00 m in the lower. It is a lower-unit band that happens to
    poke up, and the label must say so.
    """
    picks = [_pick("S3", "BODY-CLAY", 0.0, 6.0)]
    surfaces = [_flat_surface(GEO_UPPER_ID, 0.0), _flat_surface(GEO_LOWER_ID, -1.0)]

    groups = _grouper()._group_segments(picks, surfaces)

    ((_body_id, geo_formation_id, _litho_formation_id),) = groups.keys()
    assert geo_formation_id == GEO_LOWER_ID


def test_nc5_a_body_keeps_one_identity_across_a_geological_surface() -> None:
    """NC5 — the body is no longer re-keyed per geological unit.

    The cut used to mint a derived ``uuid5`` body id per geological band, so one
    clay body became two. With no cut there is no re-keying: the resolver's own
    body id is what the geotech stage groups on.
    """
    picks = [
        _pick("A", "BODY-CLAY", 0.0, 6.0),
        _pick("B", "BODY-CLAY", 0.0, 6.0),
    ]
    surfaces = [_flat_surface(GEO_LOWER_ID, -3.0)]

    groups = _grouper()._group_segments(picks, surfaces)

    assert {key[0] for key in groups} == {"BODY-CLAY"}


def test_nc6_a_band_above_every_surface_is_labelled_the_open_shallow_band() -> None:
    """NC6 — ``None`` is a real answer: the ground above the first geological top."""
    picks = [_pick("S3", "BODY-SAND", 0.0, 2.0)]
    surfaces = [_flat_surface(GEO_LOWER_ID, -10.0)]

    groups = _grouper()._group_segments(picks, surfaces)

    ((_body_id, geo_formation_id, _litho_formation_id),) = groups.keys()
    assert geo_formation_id is None


def test_nc7_with_no_geological_model_every_pick_still_reaches_the_classifier() -> None:
    """NC7 — a litho model with no geological parent labels nothing and cuts nothing."""
    picks = [_pick("S3", "BODY-CLAY", 0.05, 1.48)]

    groups = _grouper()._group_segments(picks, [])

    assert list(groups) == [("BODY-CLAY", None, "F-CLAY")]
    ((segments),) = groups.values()
    assert (segments[0].top_depth_m, segments[0].base_depth_m) == (0.05, 1.48)

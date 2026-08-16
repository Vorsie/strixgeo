"""A geo-bounded slice with no donor inherits from its own litho layer.

A geological contact cuts a litho layer into several planning units, and each
is planned against its own ``(body, geological band)`` group.  A slice whose
group holds no column near enough to donate falls to the weakest class in the
body — which surfaced on the owner's B4 as a 0.43 m LOOSE stripe sitting
directly on top of the medium dense sand of the SAME litho layer, 9.07-9.50
above 9.50-11.49.

Owner, 2026-08-16, on the rule: *"sure build the obvious rule first"*.  The
layer is one soil unit and litho is authoritative, so the slice takes the
class its own layer already resolved rather than a guess drawn from the whole
body.  Nothing is invented: the class comes from the same layer, on the same
column.
"""

from uuid import UUID

from groundmodel.application.divide_boreholes import (
    PlannedBand,
    inherit_class_within_litho_layer,
)

SAND_LAYER = UUID("00000000-0000-0000-0000-0000000000a1")
CLAY_LAYER = UUID("00000000-0000-0000-0000-0000000000a2")
LITHO_FID = UUID("00000000-0000-0000-0000-0000000000f1")

# B4's sand layer, cut by a geological contact at 9.50.
BOREHOLE_LAYERS = [
    (SAND_LAYER, 9.07, 12.52),
    (CLAY_LAYER, 15.50, 17.00),
]


def _band(top: float, base: float, nad: int, source: str) -> PlannedBand:
    """One planned band on the borehole."""
    return PlannedBand(
        depth_top_m=top,
        depth_base_m=base,
        nad_class=nad,
        source=source,
        confidence="low" if source != "cpt_interpolated" else "high",
        body_id=None,
        source_litho_formation_id=LITHO_FID,
        source_geo_formation_id=None,
    )


def test_in1_a_donorless_slice_takes_its_own_layer_s_class() -> None:
    """The 0.43 m loose stripe becomes the medium dense of the band below it."""
    out = inherit_class_within_litho_layer(
        [
            _band(9.07, 9.50, 5, "body_min"),
            _band(9.50, 11.49, 6, "cpt_interpolated"),
            _band(11.49, 12.52, 7, "cpt_interpolated"),
        ],
        borehole_layers=BOREHOLE_LAYERS,
    )
    assert [b.nad_class for b in out] == [6, 6, 7]
    assert out[0].source == "layer_inherited"
    # Still not evidence, and still says so.
    assert out[0].confidence == "low"


def test_in2_the_nearest_resolved_band_in_the_layer_wins() -> None:
    """A slice at the layer's base takes the band beside it, not the topmost."""
    out = inherit_class_within_litho_layer(
        [
            _band(9.07, 10.00, 6, "cpt_interpolated"),
            _band(10.00, 11.00, 7, "cpt_interpolated"),
            _band(11.00, 12.52, 5, "absolute_min"),
        ],
        borehole_layers=BOREHOLE_LAYERS,
    )
    assert [b.nad_class for b in out] == [6, 7, 7]


def test_in3_a_layer_that_resolved_nothing_is_left_alone() -> None:
    """With no donor anywhere in the layer there is nothing to inherit."""
    out = inherit_class_within_litho_layer(
        [
            _band(9.07, 9.50, 5, "body_min"),
            _band(9.50, 12.52, 5, "absolute_min"),
        ],
        borehole_layers=BOREHOLE_LAYERS,
    )
    assert [b.source for b in out] == ["body_min", "absolute_min"]


def test_in4_a_resolved_band_is_never_overwritten() -> None:
    """Inheritance only ever fills a gap; it does not correct real evidence."""
    out = inherit_class_within_litho_layer(
        [
            _band(9.07, 9.50, 5, "cpt_interpolated"),
            _band(9.50, 12.52, 8, "cpt_interpolated"),
        ],
        borehole_layers=BOREHOLE_LAYERS,
    )
    assert [b.nad_class for b in out] == [5, 8]


def test_in5_a_layer_does_not_lend_to_a_different_layer() -> None:
    """The clay's donorless band stays clay-floored; the sand cannot answer."""
    out = inherit_class_within_litho_layer(
        [
            _band(9.07, 12.52, 6, "cpt_interpolated"),
            _band(15.50, 17.00, 22, "body_min"),
        ],
        borehole_layers=BOREHOLE_LAYERS,
    )
    assert [b.nad_class for b in out] == [6, 22]
    assert out[1].source == "body_min"


def test_in6_a_band_outside_every_layer_is_left_alone() -> None:
    """A band the layer table cannot place is not guessed at."""
    out = inherit_class_within_litho_layer(
        [_band(30.0, 31.0, 5, "body_min")],
        borehole_layers=BOREHOLE_LAYERS,
    )
    assert out[0].source == "body_min"

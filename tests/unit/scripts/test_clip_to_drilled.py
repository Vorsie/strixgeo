"""The drilled clip must not delete the log's own shallowest unit.

``_clip_to_drilled`` keeps the model intervals that sit inside an investigation's
drilled range, and discards deep-band material poking up past total depth — its
docstring is explicit that the ``_SUBSTRATE_MARGIN_M`` guard is for "a deep-band unit
poking a few centimetres up past the drilled BOTTOM".

Applied at the TOP it deletes real geology. A voxel-aligned mesh always overshoots the
log's top contact by up to half a voxel, so the shallowest unit is never "fully inside";
if it is thinner than the margin its overlap falls under it and the guard drops it. On
the owner's model that turned GEO-23/125-S5A's correct column into the last outstanding
drilled-gate failure: the top ZAND is labelled, meshed and hit by the ray-cast, and was
being deleted by the scorer.

Phrased in the log's own terms: material above the top contact is grid phase; material
below total depth is substrate. Only the second is the guard's business.
"""

from __future__ import annotations

from scripts.eval_strat_fidelity import _clip_to_drilled

# (formation, top, base) top -> bottom, as the authored column is carried.
AUTHORED = [
    ("ZAND", 11.380, 11.070),
    ("SILT", 11.070, 10.590),
    ("KLEI", 10.590, 10.140),
    ("SILT", 10.140, 7.910),
]


def _kept(model_stack: list[tuple[str, float, float]]) -> list[str]:
    """Formation ids surviving the clip, in model order."""
    return [f for f, _base, _top in _clip_to_drilled(AUTHORED, model_stack)]


def test_the_shallowest_unit_survives_its_mesh_overshooting_the_top() -> None:
    """The real case: a 0.25 m voxel straddling an 11.380 m top contact.

    The mesh spans 11.155..11.405 — 0.025 m above the log — so it is not "fully
    inside", and its 0.225 m overlap is under the 0.3 m margin. It is the log's own
    top unit and must be kept.
    """
    model = [
        ("ZAND", 11.155, 11.405),
        ("SILT", 10.655, 11.155),
        ("KLEI", 10.155, 10.655),
        ("SILT", 7.905, 10.155),
    ]

    assert _kept(model) == ["ZAND", "SILT", "KLEI", "SILT"]


def test_deep_material_poking_up_past_total_depth_is_still_discarded() -> None:
    """The guard's actual purpose is untouched: substrate stays out.

    A deep band reaching 0.2 m up past the drilled bottom is grid phase below the log,
    not a unit the log failed to mention.
    """
    model = [
        ("SILT", 8.110, 11.380),
        ("KLEI", 5.000, 8.110),
    ]

    assert _kept(model) == ["SILT"]


def test_an_interval_fully_inside_is_kept_however_thin() -> None:
    """Nothing about this changes — a thin unit inside drilled ground is real."""
    model = [
        ("ZAND", 11.300, 11.380),
        ("SILT", 7.910, 11.300),
    ]

    assert _kept(model) == ["ZAND", "SILT"]


def test_material_entirely_outside_the_drilled_range_is_dropped() -> None:
    """Above the top or below the base with no overlap: not drilled ground."""
    model = [
        ("KLEI", 12.000, 13.000),
        ("ZAND", 7.910, 11.380),
        ("VEEN", 4.000, 5.000),
    ]

    assert _kept(model) == ["ZAND"]

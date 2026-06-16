"""Task-5a tests — build per-lens carve inputs from the lens's real picks.

``build_lens_carve_inputs`` is the application/domain seam that turns a
:class:`~groundmodel.domain.services.strat_field.lens_types.LensPartition`
(which bodies are lenses, what their host is, how deeply nested) plus the model's
:class:`~groundmodel.domain.services.litho_body_pick.BodyLayerPick` set into one
:class:`~groundmodel.domain.services.strat_field.lens_carving.LensCarveInput`
per lens — the surfaces (``z_top`` / ``z_base``) + footprint over the SHARED
build grid that the Task-4 carver consumes.

The fixtures are REAL-DATA-SHAPED, not layer-cake: a thin SILT lens enclosed in a
KLEI host (KLEI / SILT / KLEI down one column under a single ``body_id`` — the
``test.strix`` over-merge signature), with the lens picked at three investigations
so its top/base surfaces can be genuinely interpolated.
"""

from __future__ import annotations

import numpy as np

from groundmodel.domain.services.litho_body_pick import BodyLayerPick
from groundmodel.domain.services.strat_field.body_assembly import build_shared_grid
from groundmodel.domain.services.strat_field.lens_geometry import build_lens_carve_inputs
from groundmodel.domain.services.strat_field.lens_types import Lens, LensPartition
from groundmodel.domain.services.strat_field.strat_types import Block

_GRID_SPACING_M = 5.0


def _domain() -> Block:
    """A 120 m square / 20 m tall block that brackets the fixture picks."""
    polygon = (
        (-10.0, -10.0),
        (110.0, -10.0),
        (110.0, 110.0),
        (-10.0, 110.0),
    )
    return Block(polygon=polygon, z_min=-12.0, z_max=12.0)


def _pick(
    inv: str,
    body: str,
    formation: str,
    *,
    x: float,
    y: float,
    surf: float = 10.0,
    top: float,
    base: float,
) -> BodyLayerPick:
    """Build one ``BodyLayerPick`` with explicit geometry."""
    return BodyLayerPick(
        investigation_id=inv,
        x_m=x,
        y_m=y,
        surface_elev_m=surf,
        body_id=body,
        formation_id=formation,
        top_depth_m=top,
        base_depth_m=base,
    )


def _enclosed_lens_picks() -> list[BodyLayerPick]:
    """KLEI / SILT / KLEI at three non-collinear investigations (one host body).

    The host KLEI is recorded both above and below the SILT under the SAME
    ``body_id`` (``klei_body``) — the over-merge enclosure.  The SILT
    (``silt_body``) is picked at all three investigations so its top/base
    surfaces are interpolable.
    """
    coords = [("A", 0.0, 0.0), ("B", 100.0, 0.0), ("C", 50.0, 90.0)]
    picks: list[BodyLayerPick] = []
    for inv, x, y in coords:
        # KLEI above the lens: 0 → 4 m depth (z 10 → 6).
        picks.append(_pick(inv, "klei_body", "KLEI", x=x, y=y, top=0.0, base=4.0))
        # SILT lens: 4 → 6 m depth (z 6 → 4).
        picks.append(_pick(inv, "silt_body", "SILT", x=x, y=y, top=4.0, base=6.0))
        # KLEI below the lens: 6 → 12 m depth (z 4 → -2), SAME body id.
        picks.append(_pick(inv, "klei_body", "KLEI", x=x, y=y, top=6.0, base=12.0))
    return picks


def _picks_by_body(picks: list[BodyLayerPick]) -> dict[str, list[BodyLayerPick]]:
    """Group picks by ``body_id`` (the shape the helper consumes)."""
    out: dict[str, list[BodyLayerPick]] = {}
    for p in picks:
        out.setdefault(p.body_id, []).append(p)
    return out


def test_enclosed_lens_carve_input_has_correct_ids_and_finite_surfaces() -> None:
    """A SILT lens in a KLEI host yields one carve input with finite z_base < z_top."""
    picks = _enclosed_lens_picks()
    partition = LensPartition(
        matrix_body_ids=frozenset({"klei_body"}),
        lenses=(Lens(body_id="silt_body", host_body_id="klei_body", nesting_depth=1),),
    )
    domain = _domain()

    inputs = build_lens_carve_inputs(partition, _picks_by_body(picks), domain, _GRID_SPACING_M)

    assert len(inputs) == 1
    ci = inputs[0]
    # host / lens identity + lithology.
    assert ci.host_body_id == "klei_body"
    assert ci.host_formation_id == "KLEI"
    assert ci.lens_body_id == "silt_body"
    assert ci.lens_formation_id == "SILT"
    assert ci.nesting_depth == 1

    # A non-empty footprint near the lens picks.
    assert ci.footprint.any()

    # Over the footprint the surfaces are finite and the lens is non-degenerate
    # (z_base strictly below z_top) so the carved prism has positive thickness.
    fp = ci.footprint
    assert np.isfinite(ci.z_top[fp]).all()
    assert np.isfinite(ci.z_base[fp]).all()
    assert (ci.z_base[fp] < ci.z_top[fp]).all()
    # The interpolated surfaces sit near the authored lens band (z_top 6, z_base
    # 4): the picks are all flat at those elevations, so the well-constrained
    # interior of the footprint reproduces them (the cubic kernel droops a little
    # at the hull edges, so we check the node nearest the picks' centroid, where
    # the fit is well constrained, not the whole-footprint mean).
    gx, gy, _ = build_shared_grid(domain, _GRID_SPACING_M)
    cx = np.mean([p.x_m for p in picks if p.body_id == "silt_body"])
    cy = np.mean([p.y_m for p in picks if p.body_id == "silt_body"])
    ci_x = int(np.argmin(np.abs(gx - cx)))
    ci_y = int(np.argmin(np.abs(gy - cy)))
    assert abs(ci.z_top[ci_x, ci_y] - 6.0) < 1.0
    assert abs(ci.z_base[ci_x, ci_y] - 4.0) < 1.0


def test_lens_in_lens_depth2_host_is_parent_emitted_id() -> None:
    """A depth-2 ZAND lens's host_body_id is the parent SILT lens's emitted id."""
    # KLEI / SILT / ZAND / SILT / KLEI: silt encloses zand (depth 2); klei
    # encloses silt (depth 1).  All three bodies share one id each across columns.
    coords = [("A", 0.0, 0.0), ("B", 100.0, 0.0), ("C", 50.0, 90.0)]
    picks: list[BodyLayerPick] = []
    for inv, x, y in coords:
        picks.append(_pick(inv, "klei_body", "KLEI", x=x, y=y, top=0.0, base=3.0))
        picks.append(_pick(inv, "silt_body", "SILT", x=x, y=y, top=3.0, base=4.5))
        picks.append(_pick(inv, "zand_body", "ZAND", x=x, y=y, top=4.5, base=6.0))
        picks.append(_pick(inv, "silt_body", "SILT", x=x, y=y, top=6.0, base=7.5))
        picks.append(_pick(inv, "klei_body", "KLEI", x=x, y=y, top=7.5, base=12.0))

    partition = LensPartition(
        matrix_body_ids=frozenset({"klei_body"}),
        lenses=(
            Lens(body_id="silt_body", host_body_id="klei_body", nesting_depth=1),
            Lens(body_id="zand_body", host_body_id="silt_body", nesting_depth=2),
        ),
    )
    inputs = build_lens_carve_inputs(partition, _picks_by_body(picks), _domain(), _GRID_SPACING_M)

    by_lens = {ci.lens_body_id: ci for ci in inputs}
    silt = by_lens["silt_body"]
    zand = by_lens["zand_body"]

    # The depth-1 SILT's host is the matrix body directly.
    assert silt.host_body_id == "klei_body"
    assert silt.nesting_depth == 1
    # The depth-2 ZAND's host is the SILT lens's EMITTED id, not its instance_key,
    # so the carver finds the parent lens prism in its working set.
    assert zand.host_body_id == silt.emitted_body_id
    assert zand.host_formation_id == "SILT"
    assert zand.nesting_depth == 2


def test_sparse_lens_falls_back_to_flat_plane() -> None:
    """A lens with < 3 picks gets a flat-plane surface at the mean z_top / z_base."""
    # The SILT lens is present at a SINGLE investigation (one pick) — too few to
    # interpolate a surface, so the helper falls back to a flat plane.
    picks = [
        _pick("A", "klei_body", "KLEI", x=0.0, y=0.0, top=0.0, base=4.0),
        _pick("A", "silt_body", "SILT", x=0.0, y=0.0, top=4.0, base=6.0),
        _pick("A", "klei_body", "KLEI", x=0.0, y=0.0, top=6.0, base=12.0),
        # Two more KLEI-only investigations frame the host so the model is real.
        _pick("B", "klei_body", "KLEI", x=100.0, y=0.0, top=0.0, base=12.0),
        _pick("C", "klei_body", "KLEI", x=50.0, y=90.0, top=0.0, base=12.0),
    ]
    partition = LensPartition(
        matrix_body_ids=frozenset({"klei_body"}),
        lenses=(Lens(body_id="silt_body", host_body_id="klei_body", nesting_depth=1),),
    )
    inputs = build_lens_carve_inputs(partition, _picks_by_body(picks), _domain(), _GRID_SPACING_M)

    assert len(inputs) == 1
    ci = inputs[0]
    fp = ci.footprint
    assert fp.any(), "sparse lens still gets a footprint near its pick"
    # Flat plane: every footprint node carries the same (mean) z_top / z_base.
    # The single pick has z_top = 10 - 4 = 6, z_base = 10 - 6 = 4.
    assert np.allclose(ci.z_top[fp], 6.0)
    assert np.allclose(ci.z_base[fp], 4.0)
    assert (ci.z_base[fp] < ci.z_top[fp]).all()


def test_empty_partition_yields_no_inputs() -> None:
    """A partition with no lenses returns an empty carve-input list."""
    picks = _enclosed_lens_picks()
    partition = LensPartition(matrix_body_ids=frozenset({"klei_body"}), lenses=())
    assert build_lens_carve_inputs(partition, _picks_by_body(picks), _domain(), 5.0) == []


def test_carve_inputs_align_to_the_shared_grid() -> None:
    """z_top / z_base / footprint are sized to the shared build grid (nx, ny)."""
    picks = _enclosed_lens_picks()
    partition = LensPartition(
        matrix_body_ids=frozenset({"klei_body"}),
        lenses=(Lens(body_id="silt_body", host_body_id="klei_body", nesting_depth=1),),
    )
    domain = _domain()
    gx, gy, _ = build_shared_grid(domain, _GRID_SPACING_M)
    nx, ny = len(gx), len(gy)

    ci = build_lens_carve_inputs(partition, _picks_by_body(picks), domain, _GRID_SPACING_M)[0]
    assert ci.z_top.shape == (nx, ny)
    assert ci.z_base.shape == (nx, ny)
    assert ci.footprint.shape == (nx, ny)

"""Unit tests for ``AssembleStratInputs`` — the pure picks → strat-inputs mapping.

``AssembleStratInputs.assemble`` is a synchronous, DB-free mapping over an
already-loaded ``BodyLayerPick`` list (the caller loads picks once and shares
them).  These tests pin the mapping contract WITHOUT a database:

* picks grouped per investigation, sorted top→bottom, become Stage-1 order
  columns + Stage-2 control columns sharing one synthetic ``contact_id`` per
  pick (so the order's ``contact_ids`` resolve the control observations);
* correlated layers (same ``body_id`` across investigations) collapse to ONE
  stratigraphic instance — N+1 horizons for N instances;
* the domain ``Block`` frames the alpha-hull footprint + a vertical span with a
  small margin above the highest surface / below the deepest base;
* a degenerate (collinear / too-few) pick set returns ``None`` so the caller
  flags every body.

The ``session`` argument is never touched by ``assemble`` / ``_build_domain``,
so a ``None`` session is passed (the logger base only needs ``__name__``).
"""

from __future__ import annotations

from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.assemble_strat_inputs import (
    AssembleStratInputs,
    _synthetic_contact_id,
)
from groundmodel.domain.services.litho_body_pick import BodyLayerPick


def _svc() -> AssembleStratInputs:
    """An ``AssembleStratInputs`` with a dummy session (unused by ``assemble``)."""
    return AssembleStratInputs(cast(AsyncSession, None))


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
    """Build a ``BodyLayerPick`` with explicit geometry."""
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


def _three_test_field() -> list[BodyLayerPick]:
    """Three non-collinear investigations, a two-unit stack (ZAND over KLEI).

    Each unit is correlated across all three investigations (shared body id),
    so the order collapses to two instances → three horizons.
    """
    picks: list[BodyLayerPick] = []
    coords = [("A", 0.0, 0.0), ("B", 100.0, 0.0), ("C", 50.0, 80.0)]
    for inv, x, y in coords:
        # ZAND 0→3 m (body "zand"), KLEI 3→8 m (body "klei").
        picks.append(_pick(inv, "zand", "f-zand", x=x, y=y, top=0.0, base=3.0))
        picks.append(_pick(inv, "klei", "f-klei", x=x, y=y, top=3.0, base=8.0))
    return picks


def test_synthetic_contact_id_is_stable_and_unique() -> None:
    """The synthetic contact id keys on investigation + body + rounded top."""
    p = _pick("A", "zand", "f-zand", x=0.0, y=0.0, top=2.5, base=5.0)
    assert _synthetic_contact_id(p) == "A|zand|2.5000"


def test_correlated_units_collapse_to_one_instance_each() -> None:
    """Two units correlated across 3 investigations → 2 instances → 3 horizons.

    The order's contact_ids must resolve the Stage-2 control observations, so
    the control point count is the number of INTERNAL contacts observed (one per
    investigation for the single internal horizon between ZAND and KLEI = 3).
    """
    assembly = _svc().assemble(_three_test_field())
    assert assembly is not None

    horizons = assembly.control.column.horizons
    # 2 stratigraphic instances → 3 horizons (surface, internal, floor).
    assert len(horizons) == 3

    # Only the internal horizon (rank 1) produces control points — one per
    # investigation (3).  Surface (rank 0) is DEM-constrained, floor has none.
    assert len(assembly.control.points) == 3
    assert {p.horizon_rank for p in assembly.control.points} == {1}


def test_domain_block_frames_footprint_and_vertical_span() -> None:
    """The domain block's polygon spans the test footprint; z-span clears data."""
    assembly = _svc().assemble(_three_test_field())
    assert assembly is not None

    block = assembly.domain
    xs = [vx for vx, _ in block.polygon]
    ys = [vy for _, vy in block.polygon]
    # Footprint bounding box covers the three investigations.
    assert min(xs) <= 0.0 and max(xs) >= 100.0
    assert min(ys) <= 0.0 and max(ys) >= 80.0

    # z_max above the highest surface (10) + margin; z_min below the deepest
    # base elevation (10 - 8 = 2) - margin.
    assert block.z_max >= 10.0 + 1.0 - 1e-9
    assert block.z_min <= 2.0 - 1.0 + 1e-9
    assert block.z_min < block.z_max


def test_unbuildable_domain_returns_none() -> None:
    """Two collinear investigations cannot frame a 3-D domain → ``None``."""
    picks = [
        _pick("A", "zand", "f-zand", x=0.0, y=0.0, top=0.0, base=3.0),
        _pick("B", "zand", "f-zand", x=100.0, y=0.0, top=0.0, base=3.0),
    ]
    assert _svc().assemble(picks) is None


def test_picks_sorted_top_to_bottom_within_investigation() -> None:
    """Out-of-order picks at one investigation still yield a top→bottom column.

    The order builder requires each column ordered top→bottom; the assembly
    sorts by ``top_depth_m`` before emitting, so a reversed input still gives a
    conformable order (no cycle) across the field.
    """
    picks: list[BodyLayerPick] = []
    coords = [("A", 0.0, 0.0), ("B", 100.0, 0.0), ("C", 50.0, 80.0)]
    for inv, x, y in coords:
        # Deliberately add KLEI (deeper) BEFORE ZAND (shallower).
        picks.append(_pick(inv, "klei", "f-klei", x=x, y=y, top=3.0, base=8.0))
        picks.append(_pick(inv, "zand", "f-zand", x=x, y=y, top=0.0, base=3.0))

    assembly = _svc().assemble(picks)
    assert assembly is not None
    # Conformable → the topo-sort produced 3 horizons (no NonConformableError).
    assert len(assembly.control.column.horizons) == 3


def _enclosed_lens_field() -> list[BodyLayerPick]:
    """Three investigations with a KLEI / SILT / KLEI enclosed-lens sandwich.

    The host KLEI is recorded BOTH above AND below the SILT under the SAME
    ``body_id`` (``klei_body``) — the ``test.strix`` over-merge signature.  A
    single global iso-order cannot place the SILT, so WITHOUT the matrix filter
    Stage 1's topo-sort sees ``klei_body → silt_body`` and ``silt_body →
    klei_body`` (a 2-cycle) and raises ``NonConformableError``.  WITH the matrix
    filter the SILT is classified as a lens and excluded, so the KLEI backbone
    orders cleanly.
    """
    coords = [("A", 0.0, 0.0), ("B", 100.0, 0.0), ("C", 50.0, 80.0)]
    picks: list[BodyLayerPick] = []
    for inv, x, y in coords:
        picks.append(_pick(inv, "klei_body", "f-klei", x=x, y=y, top=0.0, base=4.0))
        picks.append(_pick(inv, "silt_body", "f-silt", x=x, y=y, top=4.0, base=6.0))
        picks.append(_pick(inv, "klei_body", "f-klei", x=x, y=y, top=6.0, base=12.0))
    return picks


def test_enclosed_lens_assembles_without_cycle() -> None:
    """An enclosed-lens field that WOULD cycle now assembles (matrix-only order).

    Without the matrix filter the KLEI-above / KLEI-below over-merge is a 2-cycle
    and ``assemble`` would raise ``NonConformableError``.  Threading the lens
    classification's ``matrix_body_ids`` into the order breaks the cycle: the
    SILT is a lens, the KLEI backbone orders, and the partition surfaces the SILT
    lens for the carve step.
    """
    assembly = _svc().assemble(_enclosed_lens_field())
    assert assembly is not None
    # The matrix backbone (KLEI only) is one instance → two horizons (surface +
    # floor), no internal horizon, no cycle.
    horizons = assembly.control.column.horizons
    assert len(horizons) >= 1

    # The matrix filter dropped the SILT lens from the order entirely: its
    # lithology (``f-silt``) must NOT name either side of any matrix horizon (a
    # leak would mean the lens re-entered the single global iso-order — the cycle
    # the filter exists to break).  Only the host KLEI lithology frames the
    # matrix horizons.
    lithos_in_order = {h.above_formation for h in horizons} | {h.below_formation for h in horizons}
    assert "f-silt" not in lithos_in_order, (
        f"SILT lens lithology leaked into the matrix order horizons: {lithos_in_order}"
    )

    # The SILT lens is surfaced on the partition for the carve step.
    lens_bodies = {L.body_id for L in assembly.lens_partition.lenses}
    assert "silt_body" in lens_bodies
    assert "klei_body" in assembly.lens_partition.matrix_body_ids

    # And a carve input was built for the lens.
    assert any(ci.lens_body_id == "silt_body" for ci in assembly.lens_carve_inputs)

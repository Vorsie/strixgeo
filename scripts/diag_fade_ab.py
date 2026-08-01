"""READ-ONLY A/B: two hard-picked sections against a weight that fades over all of them.

``_stack_at`` (``domain/services/voxel_litho/label_voxels.py``) picks the TWO nearest
sections and blends them by distance, or extrudes the nearest one alone where the query
lies beyond them. Because exactly two are hard-selected, walking across the model
eventually swaps one of them for another AT FULL STRENGTH, and the ground jumps in a
single grid step. Measured on the owner's model (docs/debt.md #260): the worst move of a
shared body's roof across one 2 m step is 7.70 m at (88500.3, 164925.3), 5,530 of 74,775
adjacent column pairs change mode or section pair, and the beyond branch covers 12.9 % of
columns.

The fade replaces the selection with a weight. Every section gets ``w_i`` proportional to
``1 / d_i**p``, normalised, so a section's influence only grows and shrinks and nothing is
ever swapped. No section is ever dropped, so the discontinuity is not created in the first
place — which is why this is not a detect-then-smooth pass with a window width nobody
measured.

This run asks two things of it: whether it does remove the wall, which is not assumed here
however sound the argument for it sounds, and what it costs if it does.

* the drilled gate — the columns the model must reproduce, since they are logged ground;
* contact-depth error against those logs, which is also the honour check: honour is
  applied on top of the blend, so if the fade had softened a logged contact the errors
  would move and the gate would degrade;
* the label grid cell by cell, including whether a cell that changed body changed the
  MATERIAL or only which body id carries it;
* THE POINT OF THE EXERCISE, the step distribution, measured exactly as
  ``dump_between_beyond_wall`` measures it — a body against ITSELF by id across
  4-neighbour column pairs, never rank against rank, because the branches emit different
  NUMBERS of hairline slivers and lining stacks up by position invents metres nothing in
  the ground moved. If the fade does not shrink these, it has failed, and this run says so
  in those words;
* the smearing cost, which is the honest worry: with every section contributing, one 600 m
  away still carries weight. Two independent readings of it — how far each arm's blended
  column drifts from the NEAREST section's own drawn column, bucketed by distance to that
  section, and how much weight mass the builder's own ``_fade_weights`` hands to sections
  past the nearest two.

Both arms run in one process on the stored generation's own payload, grid, vertical
spacing, honour radius and aliases, so nothing but the rule differs. The persisted
generation's body and triangle counts are printed up front: an arm must match them or the
run is void, and the BEFORE arm should, since the stored build IS today's behaviour.

Nothing is written. Guarded to the dev DB like the other voxel diagnostics.

Usage
-----
    uv run python scripts/diag_fade_ab.py
    uv run python scripts/diag_fade_ab.py --fade-power 3
    uv run python scripts/diag_fade_ab.py --smoke     # exercises the code, reports nothing
"""

from __future__ import annotations

import argparse
import asyncio
import inspect
import math
import sys
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import numpy as np  # noqa: E402
from sqlalchemy import select  # noqa: E402

from groundmodel.application.build_voxel_litho_model import (  # noqa: E402
    _apply_aliases_to_columns,
    _investigation_columns_from_picks,
)
from groundmodel.domain.services.model_domain import ModelDomain  # noqa: E402
from groundmodel.domain.services.voxel_litho.build_domain_from_sections import (  # noqa: E402
    build_domain_from_sections,
)
from groundmodel.domain.services.voxel_litho.extract_body_solids import (  # noqa: E402
    extract_body_solids,
)
from groundmodel.domain.services.voxel_litho.label_voxels import (  # noqa: E402
    _fade_weights,
    _project_to_section_fence,
    _section_stack_at,
    _stack_at,
    label_voxels,
)
from groundmodel.domain.services.voxel_litho.merge_bodies_across_sections import (  # noqa: E402
    apply_body_aliases,
    plan_body_aliases,
)
from groundmodel.domain.services.voxel_litho.paired_stations import (  # noqa: E402
    paired_station_losers,
)
from groundmodel.domain.services.voxel_litho.true_column_positions import (  # noqa: E402
    apply_true_column_positions,
)
from groundmodel.domain.services.voxel_litho.voxel_types import (  # noqa: E402
    SectionPartitionInput,
)
from groundmodel.infrastructure.db.models.litho_body_solid_orm import (  # noqa: E402
    LithoBodySolidOrm,
)
from groundmodel.infrastructure.db.models.litho_build_generation_orm import (  # noqa: E402
    LithoBuildGenerationOrm,
)
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (  # noqa: E402
    LithoLayerRepository,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402
from scripts.diag_build_generations import _sections_from_payload  # noqa: E402
from scripts.diag_reach_ab import _contact_errors  # noqa: E402
from scripts.dump_between_beyond_wall import (  # noqa: E402
    MIN_STEP_M,
    _tops_by_body,
    _worst_shared_jump,
)
from scripts.eval_strat_fidelity import (  # noqa: E402
    _authored_columns,
    _classify_column_in_drilled_interval,
    _compute_model_stack,
    _confirm_db_target,
)

DEFAULT_FADE_POWER: float = 2.0
"""Exponent of the inverse-distance weight, ``w_i ~ 1 / d_i**p``.

This is a SHAPE, not a length. It sets how sharply influence concentrates on the near
sections but introduces no distance at which anything switches on or off, which is the
whole reason the fade can be built without inventing a constant. Two is the default
because it is the exponent under which the weight of a section falls off as fast as the
area it would have to explain grows.
"""

SMOKE_STRIDE: int = 8
"""Grid subsampling used by ``--smoke``, in columns.

Only there to exercise every code path in about a minute. A subsampled walk measures steps
between columns eight cells apart, which is a different quantity from the one #260
measured, so a smoke run reports nothing anyone may quote.
"""

DECILES: int = 10
"""How many distance-to-nearest-section buckets the drift table uses.

Buckets are cut by RANK, not by metres, so the table describes the model's own spread of
distances rather than a threshold this script picked.
"""


def _fade_kwargs(func: Callable[..., Any], power: float) -> dict[str, Any] | None:
    """Keyword arguments that turn the fade on for one callable, or ``None``.

    The implementation is being written in parallel with this harness, so the flag is
    discovered rather than assumed. ``fade_power`` rides along only when the callable
    accepts it — a fixed exponent is a legitimate implementation choice and must not make
    this script fail.

    Parameters
    ----------
    func : callable
        ``label_voxels`` or ``_stack_at``.
    power : float
        The exponent to request when the callable takes one.

    Returns
    -------
    dict or None
        The keyword arguments, or ``None`` when ``func`` has no ``fade_sections``
        parameter at all.
    """
    params = inspect.signature(func).parameters
    if "fade_sections" not in params:
        return None
    kwargs: dict[str, Any] = {"fade_sections": True}
    if "fade_power" in params:
        kwargs["fade_power"] = power
    return kwargs


def _require_fade(power: float) -> tuple[dict[str, Any], dict[str, Any]]:
    """Resolve the fade flag on both entry points, or abort saying which is missing.

    Running one arm twice would produce a clean, symmetric, entirely meaningless report,
    so the absence of the flag is a hard stop rather than a fallback.

    Parameters
    ----------
    power : float
        The exponent to request.

    Returns
    -------
    tuple of dict
        ``(label_voxels kwargs, _stack_at kwargs)``.

    Raises
    ------
    SystemExit
        When either entry point does not accept ``fade_sections``.
    """
    label = _fade_kwargs(label_voxels, power)
    stack = _fade_kwargs(_stack_at, power)
    missing = [name for name, got in (("label_voxels", label), ("_stack_at", stack)) if got is None]
    if missing:
        raise SystemExit(
            "ABORT: no fade implementation to compare against — "
            f"{' and '.join(missing)} in "
            "src/groundmodel/domain/services/voxel_litho/label_voxels.py "
            "do(es) not accept a 'fade_sections' argument.\n"
            "       Both entry points need it: label_voxels for the grid arms and "
            "_stack_at for the step walk.\n"
            "       Without it this run would compare today's behaviour against itself "
            "and report a clean nothing."
        )
    assert label is not None and stack is not None  # narrowed by the check above
    return label, stack


def _percentiles(values: np.ndarray) -> tuple[float, float, float, float]:
    """The p50 / p90 / p99 / max of a sample, or zeros when it is empty."""
    if values.size == 0:
        return 0.0, 0.0, 0.0, 0.0
    return (
        float(np.percentile(values, 50)),
        float(np.percentile(values, 90)),
        float(np.percentile(values, 99)),
        float(values.max()),
    )


def _informed_distances(sections: list[SectionPartitionInput], x: float, y: float) -> list[float]:
    """Distances to the sections that actually have a stack at ``(x, y)``.

    The fade does not weight every section — it drops the ones whose projected foot lands
    where the partition says nothing, exactly as the two-nearest path defers to the
    section that does know. Weighting all fourteen instead would describe a rule the
    builder does not run, so the same filter is applied here, calling the same projection
    and the same stack reader in the same order.

    Parameters
    ----------
    sections : list of SectionPartitionInput
        The seated sections.
    x, y : float
        The map-plane query point.

    Returns
    -------
    list of float
        Perpendicular distance to each informed section, in the sections' input order —
        the order the builder hands to :func:`_fade_weights`.
    """
    distances: list[float] = []
    for section in sections:
        gap, frac, dist, _fx, _fy = _project_to_section_fence(section, x, y)
        if _section_stack_at(section, gap, frac):
            distances.append(float(dist))
    return distances


def _geometry_pass(
    sections: list[SectionPartitionInput],
    domain: ModelDomain,
    gx: np.ndarray,
    gy: np.ndarray,
    footprint_tol: float,
    stride: int,
    power: float,
) -> dict[str, Any]:
    """Everything about a column that does not depend on which blend rule is in force.

    The distance to each section, the nearest section's OWN drawn column, and the weight
    mass the fade rule would hand to sections past the nearest two are all properties of
    where the sections lie. Computing them once keeps the two arms comparing the same
    geometry rather than two recomputations of it, and halves the projection work.

    Parameters
    ----------
    sections : list of SectionPartitionInput
        The seated sections, exactly as handed to ``label_voxels``.
    domain : ModelDomain
        The model footprint.
    gx, gy : numpy.ndarray
        The grid axes.
    footprint_tol : float
        Inclusion radius for the footprint test — the cell half-diagonal, as
        ``label_voxels`` uses.
    stride : int
        Column subsampling; 1 walks every column.
    power : float
        The fall-off exponent handed to the builder's own ``_fade_weights``.

    Returns
    -------
    dict
        ``own_tops`` (grid index to the nearest section's own body-to-roof map),
        ``d1`` (grid index to distance to that section), and ``far_mass``,
        ``participation`` and ``informed`` as arrays over the walked columns.
    """
    own_tops: dict[tuple[int, int], dict[str, float]] = {}
    d1_at: dict[tuple[int, int], float] = {}
    far_mass: list[float] = []
    participation: list[float] = []
    informed: list[int] = []
    for ix in range(0, len(gx), stride):
        x = float(gx[ix])
        for iy in range(0, len(gy), stride):
            y = float(gy[iy])
            if not domain.contains(x, y, tol=footprint_tol):
                continue
            projs = [(i, s, *_project_to_section_fence(s, x, y)) for i, s in enumerate(sections)]
            projs.sort(key=lambda p: p[4])
            _i1, s1, gap1, frac1, d1, _px, _py = projs[0]
            d1_at[(ix, iy)] = float(d1)
            own = _section_stack_at(s1, gap1, frac1)
            if own:
                own_tops[(ix, iy)] = _tops_by_body(tuple(own))
            # The builder's OWN weight function on the builder's own informed set, so the
            # far-field numbers are measured rather than modelled from the formula.
            distances = _informed_distances(sections, x, y)
            informed.append(len(distances))
            if len(distances) < 2:
                far_mass.append(0.0)
                participation.append(float(len(distances)))
                continue
            weights = np.array(_fade_weights(distances, power), dtype=float)
            nearest_two = np.sort(weights)[-2:].sum()
            far_mass.append(float(max(0.0, 1.0 - nearest_two)))
            participation.append(float(1.0 / np.square(weights).sum()))
    return {
        "own_tops": own_tops,
        "d1": d1_at,
        "far_mass": np.array(far_mass, dtype=float),
        "participation": np.array(participation, dtype=float),
        "informed": np.array(informed, dtype=float),
    }


def _walk_blend(
    sections: list[SectionPartitionInput],
    domain: ModelDomain,
    gx: np.ndarray,
    gy: np.ndarray,
    footprint_tol: float,
    stride: int,
    geometry: dict[str, Any],
    stack_kwargs: dict[str, Any],
) -> dict[str, Any]:
    """Walk the blend field itself and measure how far a shared body's roof steps.

    This calls ``_stack_at`` directly, at the production settings, so what is measured is
    the field the labeller reads — before honour overrides it and before the grid quantises
    it to the vertical spacing. That is the field #260 measured, so the numbers here are
    the ones comparable to its 7.70 m.

    A body is compared against ITSELF by id, and a pair's step is the worst move among the
    bodies both columns carry. Rank matching is deliberately not offered: the two branches
    emit different numbers of hairline slivers, so equal ranks are routinely different
    material, and the 12.15 m once attributed to #260 was that artefact.

    Parameters
    ----------
    sections : list of SectionPartitionInput
        The seated sections.
    domain : ModelDomain
        The model footprint.
    gx, gy : numpy.ndarray
        The grid axes.
    footprint_tol : float
        The footprint inclusion radius.
    stride : int
        Column subsampling.
    geometry : dict
        The output of :func:`_geometry_pass`.
    stack_kwargs : dict
        Extra keyword arguments for ``_stack_at`` — empty for the two-nearest arm, the
        fade flag for the other.

    Returns
    -------
    dict
        ``steps`` (per-pair worst shared-body move), ``drift`` (grid index to how far this
        arm's column sits from the nearest section's own column), ``pairs``, ``unshared``,
        ``columns``, ``worst_at`` and ``seconds``. ``drift`` is keyed rather than flat
        because the two arms need not produce a stack at the same columns — the fade can
        fill a column the two-nearest rule left empty — and the drift table is only
        meaningful where both arms answered.
    """
    started = time.perf_counter()
    tops_at: dict[tuple[int, int], dict[str, float]] = {}
    for ix in range(0, len(gx), stride):
        x = float(gx[ix])
        for iy in range(0, len(gy), stride):
            y = float(gy[iy])
            if not domain.contains(x, y, tol=footprint_tol):
                continue
            stack = _stack_at(sections, x, y, None, True, **stack_kwargs)
            if not stack:
                continue
            tops_at[(ix, iy)] = _tops_by_body(tuple(stack))

    steps: list[float] = []
    unshared = 0
    worst = 0.0
    worst_at: tuple[float, float] | None = None
    for (ix, iy), tops_a in tops_at.items():
        for jx, jy in ((ix + stride, iy), (ix, iy + stride)):
            tops_b = tops_at.get((jx, jy))
            if tops_b is None:
                continue
            shared = _worst_shared_jump(tops_a, tops_b)
            if shared is None:
                unshared += 1
                continue
            dz = shared[2]
            steps.append(dz)
            if dz > worst:
                worst = dz
                worst_at = (float(gx[ix]), float(gy[iy]))

    # How far the blend has moved away from the section it stands nearest to. Close to a
    # section this should be small under any rule; if the fade smears, it is here that the
    # smearing shows, because that is where the drawn answer is known.
    drift: dict[tuple[int, int], float] = {}
    own_tops = geometry["own_tops"]
    for key, tops in tops_at.items():
        own = own_tops.get(key)
        if own is None:
            continue
        shared = _worst_shared_jump(own, tops)
        if shared is None:
            continue
        drift[key] = shared[2]

    return {
        "steps": np.array(steps, dtype=float),
        "drift": drift,
        "pairs": len(steps) + unshared,
        "unshared": unshared,
        "columns": len(tops_at),
        "worst_at": worst_at,
        "seconds": time.perf_counter() - started,
    }


def _label_roof_steps(labels: np.ndarray, gz: np.ndarray) -> np.ndarray:
    """Per-pair worst shared-body roof step, measured on the LABELLED grid.

    The blend walk cannot see honour, which overrides the blend at a logged column, nor the
    vertical quantisation. Both belong to the ground the owner actually looks at, so the
    same measurement is repeated here on the labels themselves. Two consequences to read it
    with: an honoured column takes its log's own stack and so steps away from its
    neighbours BY DESIGN, which puts a floor under this distribution that is nothing to do
    with the blend; and every roof is rounded to the vertical spacing, so steps below that
    spacing are not resolved.

    A body's roof in a column is the shallowest cell carrying it. Bodies are matched by
    label index, which both arms share because ``label_voxels`` assigns indices from the
    sorted section body ids before any labelling happens.

    Every body's roof is found in ONE sweep of the elevation axis rather than by re-scanning
    the whole grid once per body. The obvious per-body version costs a full comparison over
    every cell for each of the couple of hundred bodies, which on the owner's model was
    minutes; this is a few seconds, and computes the same thing.

    Parameters
    ----------
    labels : numpy.ndarray
        The ``(nx, ny, nz)`` label grid; ``-1`` is void.
    gz : numpy.ndarray
        The elevation axis, ascending.

    Returns
    -------
    numpy.ndarray
        One worst-shared-body step per 4-neighbour column pair that shares a body.
    """
    nx, ny, nz = labels.shape
    n_bodies = int(labels.max()) + 1
    if n_bodies <= 0:
        return np.zeros(0, dtype=float)

    # ``gz`` ascends, so sweeping k upward and overwriting leaves each (column, body) cell
    # holding the HIGHEST cell that body reached there, which is its roof. One sweep of the
    # elevation axis does every body at once. The table is one int32 per column per body;
    # on this model that is well under a gigabyte, but it does scale with the body count.
    flat = labels.reshape(-1, nz)
    roof_k = np.full((flat.shape[0], n_bodies), -1, dtype=np.int32)
    rows = np.arange(flat.shape[0])
    for k in range(nz):
        layer = flat[:, k]
        carried = layer >= 0
        roof_k[rows[carried], layer[carried]] = k
    by_column = roof_k.reshape(nx, ny, n_bodies)

    worst_x = np.full((nx - 1, ny), np.nan)
    worst_y = np.full((nx, ny - 1), np.nan)
    for body in range(n_bodies):
        kk = by_column[:, :, body]
        carried = kk >= 0
        if not bool(carried.any()):
            continue
        roof = np.where(carried, gz[kk], np.nan)
        # fmax keeps the running worst and ignores a NaN from a column not carrying the
        # body, so a pair only ever scores on bodies BOTH of its columns carry.
        worst_x = np.fmax(worst_x, np.abs(roof[1:, :] - roof[:-1, :]))
        worst_y = np.fmax(worst_y, np.abs(roof[:, 1:] - roof[:, :-1]))
    both = np.concatenate([worst_x.ravel(), worst_y.ravel()])
    return np.asarray(both[np.isfinite(both)], dtype=float)


def _describe_gate(name: str, res: dict[str, Any]) -> None:
    """Print one arm's drilled gate, contact errors and mesh size."""
    errs = sorted(res["errors"])
    print(f"\n  --- {name} ---  [label+extract {res['seconds']:.1f}s]")
    print(f"    exact / subsequence / wrong : {res['exact']} / {res['sub']} / {res['wrong']}")
    print(f"    paired (unscoreable)        : {res['paired']}")
    print(f"    uncovered                   : {res['uncovered']}")
    print(f"    bodies / triangles          : {res['bodies']} / {res['tris']:,}")
    if errs:
        print(
            f"    contact err  median={np.median(errs):.3f}  "
            f"p90={np.percentile(errs, 90):.3f}  max={errs[-1]:.3f}  (n={len(errs)})"
        )


def _describe_steps(name: str, steps: np.ndarray, worst_at: tuple[float, float] | None) -> None:
    """Print one arm's step distribution."""
    p50, p90, p99, worst = _percentiles(steps)
    over = int((steps >= MIN_STEP_M).sum())
    print(f"    {name:22s}: worst {worst:6.2f} m", end="")
    if worst_at is not None:
        print(f" at ({worst_at[0]:.1f}, {worst_at[1]:.1f})", end="")
    print(
        f"\n    {'':22s}  >= {MIN_STEP_M} m: {over:,} of {steps.size:,} pairs"
        f"  ({100.0 * over / max(steps.size, 1):.2f} %)"
        f"\n    {'':22s}  p50 {p50:.3f}  p90 {p90:.3f}  p99 {p99:.3f}"
    )


async def main() -> None:
    """Run the two-nearest blend and the faded blend on identical inputs, and report."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--fade-power",
        type=float,
        default=DEFAULT_FADE_POWER,
        help="exponent p in w ~ 1/d**p, passed only if the implementation takes one",
    )
    ap.add_argument(
        "--smoke",
        action="store_true",
        help=f"subsample the walk by {SMOKE_STRIDE} and skip meshing — exercises the code, "
        "reports nothing quotable",
    )
    args = ap.parse_args()

    print("\n=== FADE A/B — two hard-picked sections vs a weight over all of them ===\n")
    if args.smoke:
        print(
            "  !!! SMOKE RUN !!! the walk is subsampled and no mesh is built.\n"
            "  Every number below is void. Re-run without --smoke to measure anything.\n"
        )
    _confirm_db_target()

    label_kwargs, stack_kwargs = _require_fade(args.fade_power)
    print(f"  fade flag found: label_voxels{tuple(label_kwargs)} / _stack_at{tuple(stack_kwargs)}")

    async with AsyncSessionFactory() as session:
        gen = (
            (
                await session.execute(
                    select(LithoBuildGenerationOrm).order_by(
                        LithoBuildGenerationOrm.created_at.desc()
                    )
                )
            )
            .scalars()
            .first()
        )
        if gen is None:
            raise SystemExit("ABORT: no stored build generation — click Build once.")
        picks = await LithoLayerRepository(session).load_body_picks(gen.model_id)
        solids = (
            (
                await session.execute(
                    select(LithoBodySolidOrm).where(LithoBodySolidOrm.generation_id == gen.id)
                )
            )
            .scalars()
            .all()
        )
        persisted_bodies = len(solids)
        persisted_tris = sum(len(x.triangles or []) for x in solids)

    # The aliases the build planned, applied to the payload the build stored. The fade
    # changes nothing about the partitions, so both arms necessarily share one plan; the
    # plan is recomputed anyway and compared, because an arm running on a different body
    # identity map would compare two different models and call the difference a rule.
    raw_sections = _sections_from_payload(gen.payload)
    aliases = dict(gen.body_aliases or {})
    replanned = plan_body_aliases(raw_sections)
    if replanned != aliases:
        print(
            f"  NOTE: re-planning the aliases gives {len(replanned)} entries against the stored "
            f"{len(aliases)}; the stored plan is used, because that is what the persisted build "
            "ran on."
        )
    as_drawn = apply_body_aliases(raw_sections, aliases)
    inv_columns = _apply_aliases_to_columns(_investigation_columns_from_picks(picks), aliases)
    sections, _moved, _shift = apply_true_column_positions(as_drawn, inv_columns)
    columns = _authored_columns(picks)

    h = float(gen.horizontal_spacing_m)
    v = float(gen.vertical_spacing_m)
    honor = float(gen.honor_radius_m)
    gx_gen = np.arange(gen.grid_origin_x, gen.grid_origin_x + gen.grid_nx * h, h)[: gen.grid_nx]
    gy_gen = np.arange(gen.grid_origin_y, gen.grid_origin_y + gen.grid_ny * h, h)[: gen.grid_ny]
    paired = paired_station_losers(inv_columns, gx_gen, gy_gen, honor)

    print(f"\n  generation {gen.id}")
    print(f"  grid {h} m / {v} m | honour {honor} m | {len(sections)} sections")
    print(
        f"  persisted: {persisted_bodies} bodies, {persisted_tris:,} triangles"
        "  <- an arm must MATCH this or the run is void"
    )

    # The domain is framed from the sections AS DRAWN unioned with the drilled positions,
    # which is what the production build does; the SEATED sections go to the query. Framing
    # it from the seated sections loses the projected feet and silently narrows the grid.
    domain = build_domain_from_sections(
        as_drawn,
        investigation_positions=tuple(
            (c.investigation_id, c.world_x, c.world_y) for c in inv_columns
        ),
    )

    # The axes the later step walk uses, rebuilt the way ``label_voxels`` builds them.
    # Checked against the generation HERE rather than after the arms, so a payload that no
    # longer frames the recorded grid fails in a second instead of after both builds.
    stride = SMOKE_STRIDE if args.smoke else 1
    ring = np.asarray(domain.polygon, dtype=float)
    gx = np.arange(float(ring[:, 0].min()), float(ring[:, 0].max()) + h / 2.0, h)
    gy = np.arange(float(ring[:, 1].min()), float(ring[:, 1].max()) + h / 2.0, h)
    if (len(gx), len(gy)) != (gen.grid_nx, gen.grid_ny):
        raise SystemExit(
            f"ABORT: the rebuilt walk grid is {len(gx)}x{len(gy)} but the generation records "
            f"{gen.grid_nx}x{gen.grid_ny} — this is a different model."
        )
    footprint_tol = 0.5 * h * math.sqrt(2.0)

    arms: tuple[tuple[str, dict[str, Any]], ...] = (
        ("BEFORE  two-nearest", {}),
        ("AFTER   fade", label_kwargs),
    )

    results: dict[str, dict[str, Any]] = {}
    grids: dict[str, np.ndarray] = {}
    body_ids: dict[str, tuple[str, ...]] = {}
    formation_of: dict[str, dict[str, str]] = {}
    gz_axis: np.ndarray | None = None
    for name, extra in arms:
        print(f"\n  labelling {name} ...", flush=True)
        t0 = time.perf_counter()
        grid = label_voxels(
            domain,
            h,
            sections,
            vertical_spacing_m=v,
            investigation_columns=inv_columns,
            honor_radius_m=honor,
            **extra,
        )
        meshes = (
            []
            if args.smoke
            else [m for m in extract_body_solids(grid) if m.vertices and m.triangles]
        )
        active = [(m.body_id, m.formation_id, m.vertices, m.triangles) for m in meshes]

        res: dict[str, Any] = {
            "exact": 0,
            "sub": 0,
            "wrong": 0,
            "paired": 0,
            "uncovered": 0,
            "errors": [],
            "bodies": len(meshes),
            "tris": sum(len(m.triangles) for m in meshes),
            "seconds": time.perf_counter() - t0,
        }
        for inv_id, x, y, authored in columns:
            stack = _compute_model_stack(x, y, active)
            if not stack:
                res["uncovered"] += 1
                continue
            if inv_id in paired:
                res["paired"] += 1
                continue
            verdict = _classify_column_in_drilled_interval(authored, stack)
            res[
                "exact" if verdict == "exact" else "sub" if verdict == "subsequence" else "wrong"
            ] += 1
            res["errors"].extend(_contact_errors(authored, stack))
        results[name] = res
        grids[name] = np.asarray(grid.labels)
        body_ids[name] = tuple(grid.body_id_by_index)
        formation_of[name] = dict(grid.formation_by_body)
        gz_axis = np.asarray(grid.gz, dtype=float)
        _describe_gate(name, res)

    before_name, after_name = arms[0][0], arms[1][0]
    before, after = results[before_name], results[after_name]
    gb, ga = grids[before_name], grids[after_name]

    if not args.smoke:
        if (before["bodies"], before["tris"]) != (persisted_bodies, persisted_tris):
            print(
                f"\n  !!! VOID: the BEFORE arm produced {before['bodies']} bodies / "
                f"{before['tris']:,} triangles but the persisted generation has "
                f"{persisted_bodies} / {persisted_tris:,}. The harness is not reproducing "
                "today's build, so nothing below is a measurement of the fade."
            )
        else:
            print(
                "\n  BEFORE reproduces the persisted generation exactly "
                f"({persisted_bodies} bodies, {persisted_tris:,} triangles)."
            )

    print("\n  === DELTA (after - before) ===")
    for key, label in (
        ("exact", "exact"),
        ("sub", "subsequence"),
        ("wrong", "wrong"),
        ("uncovered", "uncovered"),
        ("paired", "paired"),
    ):
        print(
            f"    {label:22s}: {before[key]:3d} -> {after[key]:3d}"
            f"   ({after[key] - before[key]:+d})"
        )
    print(f"    {'bodies':22s}: {before['bodies']} -> {after['bodies']}")
    print(
        f"    {'triangles':22s}: {before['tris']:,} -> {after['tris']:,}   "
        f"({100.0 * (after['tris'] - before['tris']) / max(before['tris'], 1):+.1f} %)"
    )
    print(f"    {'wall clock':22s}: {before['seconds']:.1f}s -> {after['seconds']:.1f}s")
    eb, ea = sorted(before["errors"]), sorted(after["errors"])
    if eb and ea:
        print(f"    {'contact err median':22s}: {np.median(eb):.3f} -> {np.median(ea):.3f} m")
        print(
            f"    {'contact err p90':22s}: {np.percentile(eb, 90):.3f} -> "
            f"{np.percentile(ea, 90):.3f} m"
        )
        print(f"    {'contact err max':22s}: {eb[-1]:.3f} -> {ea[-1]:.3f} m")
        print(
            "    the logs are honoured on top of the blend, so a contact error that moves "
            "here\n    is the fade reaching INTO honoured ground — that is the honour check."
        )

    # --- the label grid, cell by cell --------------------------------------
    if gb.shape != ga.shape:
        print("\n  grids differ in shape — not comparable cell by cell")
    elif body_ids[before_name] != body_ids[after_name]:
        print(
            "\n  the two arms indexed bodies differently — label integers do not mean the "
            "same thing in\n  both grids, so the cell-by-cell comparison is skipped rather "
            "than reported wrongly."
        )
    else:
        cell = h * h * v
        void_b, void_a = gb < 0, ga < 0
        filled = int(np.count_nonzero(void_b & ~void_a))
        emptied = int(np.count_nonzero(~void_b & void_a))
        moved_mask = ~void_b & ~void_a & (gb != ga)
        moved = int(np.count_nonzero(moved_mask))
        # Which formation each label index carries, as a small integer, so "changed body"
        # can be split from "changed material" without materialising a second full grid.
        # A body with no formation recorded gets a code of its own rather than sharing one
        # blank code with every other such body, so an unknown is never counted as agreeing
        # with another unknown about the material.
        names = body_ids[before_name]
        forms = formation_of[before_name] | formation_of[after_name]
        codes: dict[str, int] = {}
        form_code = np.array(
            [codes.setdefault(forms.get(bid) or f"__unknown__:{bid}", len(codes)) for bid in names],
            dtype=np.int32,
        )
        flat = np.flatnonzero(moved_mask.ravel())
        lith = int(np.count_nonzero(form_code[gb.ravel()[flat]] != form_code[ga.ravel()[flat]]))
        print("\n  === GROUND THAT CHANGED HANDS ===")
        print(f"    void -> filled        : {filled:,} cells  ({filled * cell:,.0f} m3)")
        print(f"    filled -> void        : {emptied:,} cells  ({emptied * cell:,.0f} m3)")
        print(f"    changed body          : {moved:,} cells  ({moved * cell:,.0f} m3)")
        print(
            f"      of which the LITHOLOGY changed: {lith:,} cells  ({lith * cell:,.0f} m3)"
            f"  ({100.0 * lith / max(moved, 1):.1f} % of the moved ground)"
        )
        print(
            f"      the rest, {moved - lith:,} cells, is the same material under a different "
            "body id."
        )
        labelled = int(np.count_nonzero(~void_b))
        print(f"    as a share of labelled: {100.0 * moved / max(labelled, 1):.2f} %")

    # --- THE POINT: the step distribution ----------------------------------
    print("\n  === THE STEP DISTRIBUTION (the blend field, as #260 measured it) ===", flush=True)
    geometry = _geometry_pass(sections, domain, gx, gy, footprint_tol, stride, args.fade_power)
    walks: dict[str, dict[str, Any]] = {}
    for name, extra in (
        (before_name, {}),
        (after_name, stack_kwargs),
    ):
        walk = _walk_blend(sections, domain, gx, gy, footprint_tol, stride, geometry, extra)
        walks[name] = walk
        print(
            f"\n    {name}: {walk['columns']:,} columns, {walk['pairs']:,} adjacent pairs, "
            f"{walk['unshared']:,} sharing no body  [{walk['seconds']:.1f}s]"
        )
        _describe_steps(name, walk["steps"], walk["worst_at"])

    sb, sa = walks[before_name]["steps"], walks[after_name]["steps"]
    bp50, bp90, bp99, bworst = _percentiles(sb)
    ap50, ap90, ap99, aworst = _percentiles(sa)
    b_over = int((sb >= MIN_STEP_M).sum())
    a_over = int((sa >= MIN_STEP_M).sum())
    print("\n    --- step delta ---")
    print(f"    {'worst step':22s}: {bworst:.2f} -> {aworst:.2f} m   ({aworst - bworst:+.2f})")
    print(
        f"    {f'steps >= {MIN_STEP_M} m':22s}: {b_over:,} -> {a_over:,}   ({a_over - b_over:+,})"
    )
    print(f"    {'p50':22s}: {bp50:.3f} -> {ap50:.3f} m")
    print(f"    {'p90':22s}: {bp90:.3f} -> {ap90:.3f} m")
    print(f"    {'p99':22s}: {bp99:.3f} -> {ap99:.3f} m")
    if aworst >= bworst or a_over >= b_over:
        print(
            "\n    THE FADE DID NOT SHRINK THE STEPS. It was built to remove the section swap "
            "that\n    creates them, and on this model it has not: the worst step and the "
            "count of steps\n    at or over half a metre did not both fall. Whatever else it "
            "does, it has failed at\n    the thing it was for."
        )
    else:
        print(
            f"\n    The fade shrinks the wall: the worst step falls "
            f"{100.0 * (bworst - aworst) / max(bworst, 1e-9):.0f} % and "
            f"{b_over - a_over:,} fewer pairs step half a metre or more."
        )
    if ap50 < bp50 * 0.5:
        print(
            "    Read the p50 with it: it more than halved, so the fade is not only removing "
            "the\n    wall, it is flattening the everyday relief between sections too. That is "
            "smearing,\n    not smoothing."
        )

    print("\n  === THE SAME STEPS ON THE LABELLED GRID (honour and quantisation included) ===")
    print(
        f"    Roofs are rounded to the {v} m vertical spacing, and an honoured column takes "
        "its\n    log's own stack, so this distribution has a floor the blend cannot lower."
    )
    if gz_axis is not None and gb.shape == ga.shape:
        for name, grid_labels in ((before_name, gb), (after_name, ga)):
            grid_steps = _label_roof_steps(grid_labels, gz_axis)
            _describe_steps(name, grid_steps, None)

    # --- the smearing cost -------------------------------------------------
    print("\n  === THE SMEARING COST ===")
    print(
        "    How far the blended column has moved from the NEAREST section's OWN drawn "
        "column,\n    by decile of distance to that section. Close in, the drawn answer is "
        "known and the\n    blend should agree with it; a fade that lets a far section speak "
        "will disagree there."
    )
    drift_b = walks[before_name]["drift"]
    drift_a = walks[after_name]["drift"]
    # Only the columns BOTH arms answered at, so each row compares like with like. A column
    # one arm filled and the other did not is a different finding, reported as a count.
    common = sorted(drift_b.keys() & drift_a.keys())
    only_before = len(drift_b.keys() - drift_a.keys())
    only_after = len(drift_a.keys() - drift_b.keys())
    if common:
        d1 = np.array([geometry["d1"][key] for key in common], dtype=float)
        db_all = np.array([drift_b[key] for key in common], dtype=float)
        da_all = np.array([drift_a[key] for key in common], dtype=float)
        edges = np.percentile(d1, np.linspace(0, 100, DECILES + 1))
        print(
            f"\n    {'distance to nearest':>22s} {'n':>8}   "
            f"{'BEFORE p50':>10} {'p90':>7}   {'AFTER p50':>10} {'p90':>7}"
        )
        for k in range(DECILES):
            lo, hi = edges[k], edges[k + 1]
            sel = (d1 >= lo) & (d1 <= hi if k == DECILES - 1 else d1 < hi)
            if not bool(sel.any()):
                continue
            db, da = db_all[sel], da_all[sel]
            print(
                f"    {f'{lo:7.1f} - {hi:7.1f} m':>22s} {int(sel.sum()):>8,}   "
                f"{np.percentile(db, 50):>10.3f} {np.percentile(db, 90):>7.3f}   "
                f"{np.percentile(da, 50):>10.3f} {np.percentile(da, 90):>7.3f}"
            )
        print(
            f"\n    over every column both arms answered at ({len(common):,}): "
            f"drift p50 {np.percentile(db_all, 50):.3f} -> {np.percentile(da_all, 50):.3f} m, "
            f"p90 {np.percentile(db_all, 90):.3f} -> {np.percentile(da_all, 90):.3f} m"
        )
        if only_before or only_after:
            print(
                f"    columns only one arm answered at: {only_before:,} BEFORE-only, "
                f"{only_after:,} AFTER-only — left out of the table above."
            )
    else:
        print("    (no column had both a blended stack and a nearest-section stack)")

    far = geometry["far_mass"]
    part = geometry["participation"]
    informed = geometry["informed"]
    if far.size:
        print(
            f"\n    Weight handed to sections PAST the nearest two, under w ~ 1/d**"
            f"{args.fade_power:g}: median {np.median(far) * 100:.1f} %, "
            f"p90 {np.percentile(far, 90) * 100:.1f} %, max {far.max() * 100:.1f} %."
        )
        print(
            f"    Effective number of sections speaking at a column (1 / sum w^2): "
            f"median {np.median(part):.2f}, p90 {np.percentile(part, 90):.2f}, "
            f"max {part.max():.2f}."
        )
        print(
            f"    Sections with anything to say at a column: median {np.median(informed):.0f}, "
            f"max {informed.max():.0f} of {len(sections)} — the rest project onto ground their "
            "own\n    partition never filled, and the fade drops them rather than weighting "
            "silence."
        )
        print(
            "    These three come from the builder's own _fade_weights on the builder's own "
            "informed\n    set, so they measure the shipped rule, not the formula as written "
            "down."
        )
    print()


if __name__ == "__main__":
    asyncio.run(main())

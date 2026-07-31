"""READ-ONLY A/B: the same ground built from the v1 partition and from the v2 partition.

The 2-D partition engine ships in two versions. A fresh install gets v1; the owner's
machine has v2 enabled through a device-local preference, so everything validated by
dogfeeding is v2 output while everything a new customer would see is v1 output. Nothing
measures what that difference costs in the 3-D model, which is what this harness is for.

Each arm is a voxel build POSTed payload captured from one engine (written by the
partition-payload emitter, not by this script). Both arms are built here in one process
through the production pipeline, and everything that is not the partition is taken from
the stored build generation — grid spacing, vertical spacing, honour radius and the
cross-section body-alias map. So the only difference between the two models is which
engine drew the sections.

What it reports, per arm and as a delta:

* the drilled gate — the logged columns the model must reproduce, since they are the
  only measured ground in the project;
* contact-depth error against those logs, where a body that overstays shows up before
  the ordering verdict changes;
* the label grid itself, cell by cell — how much ground changed hands, in which
  direction, and whether newly filled ground closed a hole INSIDE the old model or is
  the model reaching further. Those two are not the same finding and must not be
  reported as one number.

Nothing is written. Guarded to the dev DB like the other voxel diagnostics.

Usage
-----
    uv run python scripts/diag_engine_fidelity_ab.py
    uv run python scripts/diag_engine_fidelity_ab.py --v1 a.json --v2 b.json
    uv run python scripts/diag_engine_fidelity_ab.py --generation <uuid>
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from collections import Counter
from pathlib import Path
from uuid import UUID

_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import numpy as np  # noqa: E402
from sqlalchemy import select  # noqa: E402

from groundmodel.application.build_voxel_litho_model import (  # noqa: E402
    _apply_aliases_to_columns,
    _investigation_columns_from_picks,
)
from groundmodel.domain.services.voxel_litho.build_domain_from_sections import (  # noqa: E402
    build_domain_from_sections,
)
from groundmodel.domain.services.voxel_litho.extract_body_solids import (  # noqa: E402
    extract_body_solids,
)
from groundmodel.domain.services.voxel_litho.label_voxels import label_voxels  # noqa: E402
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
    LabelGrid,
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

# The contact-error measure is the one diag_reach_ab.py already defines; importing it
# keeps a single definition rather than a second copy that can drift.
from scripts.diag_reach_ab import _contact_errors  # noqa: E402
from scripts.eval_strat_fidelity import (  # noqa: E402
    _authored_columns,
    _classify_column_in_drilled_interval,
    _compute_model_stack,
    _confirm_db_target,
)

_DEFAULT_V1 = _REPO_ROOT / "scripts" / "throwaway_engine_payload_v1.json"
_DEFAULT_V2 = _REPO_ROOT / "scripts" / "throwaway_engine_payload_v2.json"

# Two grid coordinates count as the same node when they differ by less than this
# fraction of a cell. The axes are numpy ``arange`` output from the same spacing, so a
# genuine offset is a whole number of cells and anything else is a different grid.
_AXIS_TOL = 1e-6


def _missing_payload_message(paths: list[Path]) -> str:
    """Explain which payload files are absent and how to produce them.

    Parameters
    ----------
    paths : list of pathlib.Path
        The payload files that could not be found.

    Returns
    -------
    str
        A message naming each missing file and pointing at the emitter.
    """
    listing = "\n".join(f"      {p}" for p in paths)
    return (
        "ABORT: the engine payload(s) this harness compares do not exist yet:\n"
        f"{listing}\n\n"
        "    They are written by the payload emitter, which runs each engine over the\n"
        "    real sections and writes the voxel POST body that engine would have sent.\n"
        "    Run it first, from the desktop/ directory:\n\n"
        "        $env:ENGINE_AB='1'; npx vitest run "
        "src/renderer/src/utils/enginePayloadAB.diag.test.ts\n\n"
        "    Then re-run this harness. Pass --v1/--v2 if the emitter wrote them\n"
        "    somewhere other than the default paths."
    )


def _load_payload_sections(path: Path) -> list[SectionPartitionInput]:
    """Read one arm's captured voxel payload into the frozen domain sections.

    Accepts either the shape the frontend POSTs (an object with a ``sections`` key,
    with or without the grid-spacing fields) or a bare list of sections. The spacing
    fields are deliberately ignored: this harness takes every build setting from the
    stored generation so that nothing but the partition differs between the arms.

    Parameters
    ----------
    path : pathlib.Path
        The captured payload file.

    Returns
    -------
    list of SectionPartitionInput
        The sections exactly as the emitter captured them, before aliasing.

    Raises
    ------
    SystemExit
        When the file is not JSON, carries no recognisable ``sections`` array, or a
        section or region is missing a field the builder requires.
    """
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as err:
        raise SystemExit(f"ABORT: {path} is not valid JSON — {err}") from err

    if isinstance(raw, dict):
        sections = raw.get("sections")
    elif isinstance(raw, list):
        sections = raw
    else:
        sections = None
    if not isinstance(sections, list):
        raise SystemExit(
            f"ABORT: {path} carries no 'sections' array — expected the voxel build "
            "payload the frontend POSTs, or a bare list of sections."
        )
    if not sections:
        raise SystemExit(f"ABORT: {path} carries zero sections — nothing to build.")

    try:
        return _sections_from_payload({"sections": sections})
    except (KeyError, TypeError, IndexError) as err:
        raise SystemExit(
            f"ABORT: {path} is not a voxel build payload — {type(err).__name__}: {err}. "
            "Every section needs start_x/start_y/end_x/end_y, columns "
            "(investigation_id, along_m, world_x, world_y) and regions "
            "(formation_id, body_id, polygon, gap_index)."
        ) from err


def _describe_payload(
    label: str, path: Path, sections: list[SectionPartitionInput], aliases: dict[str, str]
) -> None:
    """Print what one arm's payload contains, and flag the two ways it can be blind.

    A payload that carries no ``kind`` on any region cannot be compared: the builder
    then cannot tell a band from an onlap from a lens and pinches all three alike, so
    the arm measures the emitter's omission rather than the engine. A payload whose
    body ids are largely outside the stored alias map is describing a different body
    identity than the generation was built with, which moves ground for a reason that
    has nothing to do with the engine.

    Parameters
    ----------
    label : str
        Short arm name used in the report.
    path : pathlib.Path
        Where the payload was read from.
    sections : list of SectionPartitionInput
        The parsed sections.
    aliases : dict of str to str
        The stored generation's body-alias map, used only to report coverage.
    """
    regions = [r for s in sections for r in s.regions]
    columns = sum(len(s.columns) for s in sections)
    kinds = Counter(r.kind or "(none)" for r in regions)
    tiers = sum(1 for r in regions if r.overlay_tier is not None)
    body_ids = {r.body_id for r in regions if r.body_id is not None}
    outside = {b for b in body_ids if b not in aliases} if aliases else set()

    print(f"    {label}  {path}")
    print(
        f"        {len(sections)} sections, {columns} columns, {len(regions)} regions  "
        f"({' / '.join(f'{k} {n}' for k, n in sorted(kinds.items()))})"
    )
    print(
        f"        overlay_tier set on {tiers} region(s); "
        f"{len(body_ids)} distinct body id(s), {len(outside)} outside the stored alias map"
    )
    if kinds.get("(none)", 0) == len(regions):
        print(
            "        WARNING: no region carries 'kind' — this payload is blind to the\n"
            "                 2/1/0 classification (debt #256). The builder will pinch\n"
            "                 bands, onlaps and lenses alike, so this arm measures the\n"
            "                 emitter, not the engine."
        )
    if aliases and len(outside) > len(body_ids) // 2:
        print(
            "        WARNING: most body ids are unknown to the stored generation's alias\n"
            "                 map — this payload was built from a different body identity\n"
            "                 than the persisted model. The delta will not be the engine."
        )


def _build_arm(
    label: str,
    sections_received: list[SectionPartitionInput],
    picks: list,
    gen: LithoBuildGenerationOrm,
    paired: set[str],
    columns: list,
) -> tuple[dict, LabelGrid]:
    """Build one arm through the production pipeline and score it against the logs.

    Parameters
    ----------
    label : str
        Short arm name, used only for the progress line.
    sections_received : list of SectionPartitionInput
        The arm's payload as captured, before aliasing.
    picks : list
        The model's accepted body-assigned picks (``load_body_picks``).
    gen : LithoBuildGenerationOrm
        The stored generation supplying spacing and honour radius.
    paired : set of str
        Investigations whose honoured cell belongs to their station partner, and which
        therefore cannot be scored against their own log (#258).
    columns : list
        The authored columns from ``_authored_columns(picks)``.

    Returns
    -------
    tuple of (dict, LabelGrid)
        The arm's tallies and the labelled grid it produced.
    """
    h = float(gen.horizontal_spacing_m)
    v = float(gen.vertical_spacing_m)
    honor = float(gen.honor_radius_m)

    # Plan this arm's aliases from THIS arm's payload, which is what production does
    # (`build_voxel_litho_model.py:528`: `aliases = plan_body_aliases(sections)`).
    #
    # Handing both arms the stored map instead is not a neutral control. The stored map
    # was planned from the v2 payload, and aliasing is not renaming — `_blend_stacks`
    # matches the two nearest sections' stacks BY body_id, so a foreign map moves ground.
    # Measured on the v1 payload, changing nothing else: 83 bodies / 564,864 triangles
    # under the stored map versus 76 / 549,234 under the map production would plan for
    # it. That is 7 bodies and 2.8 % of the mesh attributable to the control alone, and
    # it inverted the sign of the body-count delta the harness reported.
    aliases = plan_body_aliases(sections_received)
    merged = sum(1 for src, dst in aliases.items() if src != dst)
    print(f"    {label}: planned {len(aliases)} body ids, {merged} merged away")
    as_drawn = apply_body_aliases(sections_received, aliases)
    inv_columns = _apply_aliases_to_columns(_investigation_columns_from_picks(picks), aliases)
    seated, _moved, _shift = apply_true_column_positions(as_drawn, inv_columns)

    print(f"    building {label} ...", flush=True)
    t0 = time.perf_counter()
    # The domain is framed from the sections AS DRAWN, not from the seated ones — that
    # is what the production build does, and using the seated sections here silently
    # produced a model that reproduced no real build (caught 2026-08-01 when the
    # persisted rebuild disagreed with both arms). The seated sections go to the
    # labeller, which ranks the blend in true map space.
    domain = build_domain_from_sections(
        as_drawn,
        investigation_positions=tuple(
            (c.investigation_id, c.world_x, c.world_y) for c in inv_columns
        ),
    )
    grid = label_voxels(
        domain,
        h,
        seated,
        vertical_spacing_m=v,
        investigation_columns=inv_columns,
        honor_radius_m=honor,
    )
    meshes = [m for m in extract_body_solids(grid) if m.vertices and m.triangles]
    active = [(m.body_id, m.formation_id, m.vertices, m.triangles) for m in meshes]

    res: dict = {
        "exact": 0,
        "sub": 0,
        "wrong": 0,
        "paired": 0,
        "uncovered": 0,
        "errors": [],
        "bodies": len(meshes),
        "tris": sum(len(m.triangles) for m in meshes),
        "seconds": time.perf_counter() - t0,
        "shape": (len(grid.gx), len(grid.gy), len(grid.gz)),
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
        res["exact" if verdict == "exact" else "sub" if verdict == "subsequence" else "wrong"] += 1
        res["errors"].extend(_contact_errors(authored, stack))
    return res, grid


def _describe(name: str, res: dict, persisted_bodies: int, persisted_tris: int) -> None:
    """Print one arm's tallies, contact-error distribution and anchor verdict.

    Parameters
    ----------
    name : str
        The arm's name.
    res : dict
        The arm's tallies from :func:`_build_arm`.
    persisted_bodies, persisted_tris : int
        The stored generation's own counts, so the reader can see at a glance whether
        this arm reproduces a model the app actually made.
    """
    errs = sorted(res["errors"])
    nx, ny, nz = res["shape"]
    print(f"\n  --- {name} ---  [{res['seconds']:.1f}s]")
    print(f"    exact / subsequence / wrong : {res['exact']} / {res['sub']} / {res['wrong']}")
    print(f"    paired (unscoreable)        : {res['paired']}")
    print(f"    uncovered                   : {res['uncovered']}")
    print(f"    bodies / triangles          : {res['bodies']} / {res['tris']:,}")
    print(f"    grid                        : {nx}x{ny}x{nz}")
    if errs:
        print(
            f"    contact err  median={np.median(errs):.3f}  "
            f"p90={np.percentile(errs, 90):.3f}  max={errs[-1]:.3f}  (n={len(errs)})"
        )
    matches = res["bodies"] == persisted_bodies and res["tris"] == persisted_tris
    print(
        "    MATCHES the persisted generation — this arm is the model the app built."
        if matches
        else "    differs from the persisted generation "
        f"({persisted_bodies} bodies / {persisted_tris:,} tris)."
    )


def _canonical_maps(grids: list[LabelGrid]) -> tuple[dict[str, int], dict[str, int]]:
    """Build one body vocabulary and one formation vocabulary across both arms.

    A label integer means nothing across builds: ``body_id_by_index`` is rebuilt per
    build from whichever ids that build saw, so the same body can be 7 in one arm and
    31 in the other. Comparing the raw arrays would report ground as changed hands
    when only the index changed.

    Parameters
    ----------
    grids : list of LabelGrid
        The arms' labelled grids.

    Returns
    -------
    tuple of (dict, dict)
        Body id to canonical index, and formation id to canonical index.
    """
    body_ids = sorted({b for g in grids for b in g.body_id_by_index})
    formations = sorted({f for g in grids for f in g.formation_by_body.values()})
    return (
        {b: i for i, b in enumerate(body_ids)},
        {f: i for i, f in enumerate(formations)},
    )


def _canonical_labels(
    grid: LabelGrid,
    body_slot: dict[str, int],
    formation_slot: dict[str, int],
) -> tuple[np.ndarray, np.ndarray]:
    """Re-express one grid's labels in the shared body and formation vocabularies.

    Parameters
    ----------
    grid : LabelGrid
        The labelled grid.
    body_slot : dict of str to int
        Body id to canonical index, from :func:`_canonical_maps`.
    formation_slot : dict of str to int
        Formation id to canonical index, from :func:`_canonical_maps`.

    Returns
    -------
    tuple of numpy.ndarray
        Two ``(nx, ny, nz)`` int arrays — canonical body index and canonical formation
        index — both ``-1`` where the grid is void.
    """
    # The lookup carries one trailing -1 so a void label (-1) indexes it by numpy's own
    # negative-index rule and stays void, with no mask needed.
    body_lut = np.array(
        [body_slot[b] for b in grid.body_id_by_index] + [-1],
        dtype=np.int32,
    )
    formation_lut = np.array(
        [formation_slot[grid.formation_by_body[b]] for b in grid.body_id_by_index] + [-1],
        dtype=np.int32,
    )
    labels = np.asarray(grid.labels)
    return body_lut[labels], formation_lut[labels]


def _axis_window(a: np.ndarray, b: np.ndarray, step: float) -> tuple[slice, slice] | None:
    """Index windows over two regular axes covering the coordinates they share.

    Both axes come from ``numpy.arange`` with the same step, so they line up whenever
    their origins differ by a whole number of cells. When they do not, the two arms
    were gridded differently and no cell in one corresponds to a cell in the other.

    Parameters
    ----------
    a, b : numpy.ndarray
        Ascending coordinate axes with the same spacing.
    step : float
        The axis spacing in metres.

    Returns
    -------
    tuple of slice or None
        The window into ``a`` and the matching window into ``b``, or ``None`` when the
        axes are offset by a fraction of a cell or do not overlap at all.
    """
    if a.size == 0 or b.size == 0:
        return None
    shift = (float(b[0]) - float(a[0])) / step
    if abs(shift - round(shift)) > _AXIS_TOL:
        return None
    offset = int(round(shift))
    lo = max(0, offset)
    hi = min(int(a.size), offset + int(b.size))
    if hi <= lo:
        return None
    return slice(lo, hi), slice(lo - offset, hi - offset)


def _report_grid_delta(
    base_name: str,
    new_name: str,
    base_grid: LabelGrid,
    new_grid: LabelGrid,
    h: float,
    v: float,
) -> None:
    """Compare the two label grids cell by cell and print where the ground moved.

    Parameters
    ----------
    base_name, new_name : str
        The arms' names; the delta reads as ``new`` relative to ``base``.
    base_grid, new_grid : LabelGrid
        The labelled grids to compare.
    h, v : float
        Horizontal and vertical cell size in metres, for the volume figures.
    """
    windows = [
        _axis_window(base_grid.gx, new_grid.gx, h),
        _axis_window(base_grid.gy, new_grid.gy, h),
        _axis_window(base_grid.gz, new_grid.gz, v),
    ]
    if any(w is None for w in windows):
        print(
            "\n  === GROUND THAT CHANGED HANDS ===\n"
            "    The two arms were gridded onto axes that do not share their nodes, so "
            "no\n    cell in one corresponds to a cell in the other — not comparable "
            "cell by cell."
        )
        return

    (bx, nx_), (by, ny_), (bz, nz_) = windows  # type: ignore[misc]
    body_slot, formation_slot = _canonical_maps([base_grid, new_grid])
    base_body_full, base_form_full = _canonical_labels(base_grid, body_slot, formation_slot)
    new_body_full, new_form_full = _canonical_labels(new_grid, body_slot, formation_slot)

    base_body = base_body_full[bx, by, bz]
    new_body = new_body_full[nx_, ny_, nz_]
    base_form = base_form_full[bx, by, bz]
    new_form = new_form_full[nx_, ny_, nz_]

    cell = h * h * v
    void_b, void_n = base_body < 0, new_body < 0
    filled = int(np.count_nonzero(void_b & ~void_n))
    emptied = int(np.count_nonzero(~void_b & void_n))
    both = ~void_b & ~void_n
    moved = int(np.count_nonzero(both & (base_body != new_body)))
    relithified = int(np.count_nonzero(both & (base_form != new_form)))

    wnx, wny, wnz = base_body.shape
    print("\n  === GROUND THAT CHANGED HANDS ===")
    print(f"    compared window       : {wnx}x{wny}x{wnz} cells")
    outside_b = int(np.count_nonzero(base_body_full >= 0)) - int(np.count_nonzero(~void_b))
    outside_n = int(np.count_nonzero(new_body_full >= 0)) - int(np.count_nonzero(~void_n))
    if outside_b or outside_n:
        print(
            f"    labelled OUTSIDE it   : {outside_b:,} cells in {base_name}, "
            f"{outside_n:,} in {new_name}  (grids do not fully overlap)"
        )
    print(f"    void -> filled        : {filled:,} cells  ({filled * cell:,.0f} m3)")
    print(f"    filled -> void        : {emptied:,} cells  ({emptied * cell:,.0f} m3)")
    print(f"    changed body          : {moved:,} cells  ({moved * cell:,.0f} m3)")
    print(
        f"      of which lithology  : {relithified:,} cells  ({relithified * cell:,.0f} m3)"
        "   <- the rest is the same material under another body id"
    )
    labelled = int(np.count_nonzero(~void_b))
    print(f"    as a share of labelled: {100.0 * moved / max(labelled, 1):.2f} %")

    # A cell that was void BETWEEN the topmost and bottommost labelled cell of its own
    # column was a hole INSIDE the old model. One outside that span is the model
    # reaching further, which is a different finding entirely and must not be reported
    # as a hole. The span is measured over the OLD grid's full height, not just the
    # compared window, so a window that clips the old model cannot turn a hole into
    # growth.
    newly = void_b & ~void_n
    base_labelled_full = base_body_full >= 0
    window_elev = np.asarray(base_grid.gz)[bz]
    interior = grew = fresh_column = 0
    for ix, iy in np.argwhere(newly.any(axis=2)):
        got = np.flatnonzero(newly[ix, iy])
        zs = np.flatnonzero(base_labelled_full[bx.start + int(ix), by.start + int(iy)])
        if zs.size == 0:
            fresh_column += int(got.size)
            continue
        lo_elev = float(base_grid.gz[zs.min()])
        hi_elev = float(base_grid.gz[zs.max()])
        elevs = window_elev[got]
        inside = int(np.count_nonzero((elevs >= lo_elev) & (elevs <= hi_elev)))
        interior += inside
        grew += int(got.size) - inside
    print("\n  === WHERE THE NEWLY FILLED GROUND IS ===")
    for caption, cells in (
        (f"holes INSIDE {base_name}", interior),
        ("the model reaching further", grew),
        ("columns that had no model", fresh_column),
    ):
        print(f"    {caption:26s}: {cells:,} cells  ({cells * cell:,.0f} m3)")


async def main() -> None:
    """Build both payloads on identical settings and print the fidelity delta."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--v1", type=Path, default=_DEFAULT_V1, help="payload captured from engine v1")
    ap.add_argument("--v2", type=Path, default=_DEFAULT_V2, help="payload captured from engine v2")
    ap.add_argument("--model-id", type=UUID, default=None, help="restrict to one litho model")
    ap.add_argument(
        "--generation",
        type=UUID,
        default=None,
        help="use this build generation's settings instead of the newest one",
    )
    args = ap.parse_args()

    print("\n=== ENGINE FIDELITY A/B — partition v1 vs partition v2 (READ-ONLY) ===\n")

    # Checked before the database is touched, so a run started before the emitter has
    # finished fails immediately and says what to do.
    missing = [p for p in (args.v1, args.v2) if not p.is_file()]
    if missing:
        raise SystemExit(_missing_payload_message(missing))

    _confirm_db_target()

    async with AsyncSessionFactory() as session:
        stmt = select(LithoBuildGenerationOrm).order_by(LithoBuildGenerationOrm.created_at.desc())
        if args.model_id:
            stmt = stmt.where(LithoBuildGenerationOrm.model_id == args.model_id)
        if args.generation:
            stmt = stmt.where(LithoBuildGenerationOrm.id == args.generation)
        gen = (await session.execute(stmt)).scalars().first()
        if gen is None:
            raise SystemExit(
                "ABORT: no stored build generation matches — click Build once, or drop "
                "--generation / --model-id."
            )
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

    aliases = dict(gen.body_aliases or {})
    merged = sum(1 for src, dst in aliases.items() if src != dst)
    h = float(gen.horizontal_spacing_m)
    v = float(gen.vertical_spacing_m)
    honor = float(gen.honor_radius_m)

    inv_columns = _apply_aliases_to_columns(_investigation_columns_from_picks(picks), aliases)
    gx = np.arange(gen.grid_origin_x, gen.grid_origin_x + gen.grid_nx * h, h)[: gen.grid_nx]
    gy = np.arange(gen.grid_origin_y, gen.grid_origin_y + gen.grid_ny * h, h)[: gen.grid_ny]
    paired = paired_station_losers(inv_columns, gx, gy, honor)
    columns = _authored_columns(picks)

    print(
        f"\n  generation {gen.id}  built {gen.created_at:%Y-%m-%d %H:%M} by {gen.builder_version}"
    )
    print(f"  model {gen.model_id}")
    print(
        f"  grid {h} m / {v} m | honour {honor} m | {len(aliases)} body id(s) in the "
        f"alias map, {merged} merging"
    )
    print(f"  persisted: {persisted_bodies} bodies, {persisted_tris:,} triangles")
    print(
        "      <- an arm fed the partition this generation was built from MUST reproduce\n"
        "         both numbers. If neither arm does, this harness is scoring a model the\n"
        "         app never made and the run is VOID — fix the harness, do not report it."
    )

    print("\n  --- payloads ---")
    payloads: dict[str, list[SectionPartitionInput]] = {}
    for label, path in (("v1", args.v1), ("v2", args.v2)):
        sections = _load_payload_sections(path)
        payloads[label] = sections
        _describe_payload(label, path, sections, aliases)

    print("\n  --- building both arms on the generation's own settings ---")
    results: dict[str, dict] = {}
    grids: dict[str, LabelGrid] = {}
    for label in ("v1", "v2"):
        res, grid = _build_arm(label, payloads[label], picks, gen, paired, columns)
        results[label] = res
        grids[label] = grid
        _describe(f"{label}  partition", res, persisted_bodies, persisted_tris)

    before, after = results["v1"], results["v2"]

    print("\n  === DELTA (v2 - v1) ===")
    for key, label in (
        ("exact", "exact"),
        ("sub", "subsequence"),
        ("wrong", "wrong"),
        ("paired", "paired"),
        ("uncovered", "uncovered"),
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

    _report_grid_delta("v1", "v2", grids["v1"], grids["v2"], h, v)
    print()


if __name__ == "__main__":
    asyncio.run(main())

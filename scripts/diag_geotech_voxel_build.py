"""READ-ONLY: build the GEOTECH 3-D voxel model once and dump it for a viewer.

The geotech stage has never been built. ``litho_build_generation`` holds zero
rows for the geotechnical model, so the second geometry path the stage carries —
``computeSectionFill`` over the GEOTECH columns and GEOTECH edges, run by
"Build model" — has never produced anything anybody has looked at. The section
canvas shows something else entirely: the LITHO partition put through
``refineLithoPartition``. This script runs the build path exactly once, on the
payload the app would POST, and writes the result out so it can be seen.

Nothing is written to the database and no production code is touched. The
pipeline is mirrored from :class:`BuildVoxelLithoModel` step for step, in its
order, because any deviation would describe a model the app would not produce:

1. ``plan_body_aliases`` on the payload, applied to BOTH the section regions and
   the honored investigation columns;
2. the domain framed from the sections AS DRAWN plus the drilled map positions;
3. the SEATED sections (columns moved onto their true map positions) passed to
   ``label_voxels``;
4. grid spacing, vertical spacing and honour radius taken from the stored litho
   build generation — the project's view-state prefs are shared by both stages,
   so a geotech build on this project reads the same three numbers.

The two invariants the geotech gate asserts
(``tests/integration/api/test_geotech_voxel_watertight.py``) are checked here on
the produced meshes rather than on a synthetic four-investigation scene: every
solid is a closed 2-manifold with consistent winding, and no two DIFFERENT
bodies interpenetrate over a rastered sweep of the footprint.

Input: ``scripts/throwaway_geotech_voxel_payload.json`` — emitted by
``GEOTECH_3D=1 npx vitest run src/renderer/src/utils/geotechVoxelPayload.diag.test.ts``
from ``desktop/``.

Output: ``blend_viewer/geotech3d.json`` — per-body meshes with their NAD class,
formation names and colour, plus the section fences for context.

Run: ``uv run python scripts/diag_geotech_voxel_build.py``
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import numpy as np  # noqa: E402
from sqlalchemy import select, text  # noqa: E402

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
from groundmodel.domain.services.voxel_litho.true_column_positions import (  # noqa: E402
    apply_true_column_positions,
)
from groundmodel.infrastructure.db.models.litho_build_generation_orm import (  # noqa: E402
    LithoBuildGenerationOrm,
)
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (  # noqa: E402
    LithoLayerRepository,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402
from scripts.diag_build_generations import _sections_from_payload  # noqa: E402
from scripts.eval_strat_fidelity import _confirm_db_target  # noqa: E402
from tests.unit.domain.services.voxel_litho.strat_invariants import (  # noqa: E402
    assert_closed_manifold,
    assert_no_overlap_sampled,
)

PAYLOAD = _REPO_ROOT / "scripts" / "throwaway_geotech_voxel_payload.json"
OUT = _REPO_ROOT / "blend_viewer" / "geotech3d.json"


def _mesh_bbox(mesh: Any) -> tuple[float, float, float, float]:
    """Map-plane bounding box of a mesh.

    Parameters
    ----------
    mesh : LithoBodyMesh
        A body mesh with ``(x, y, z)`` vertices.

    Returns
    -------
    tuple of float
        ``(x_min, x_max, y_min, y_max)`` in metres.
    """
    xs = [v[0] for v in mesh.vertices]
    ys = [v[1] for v in mesh.vertices]
    return min(xs), max(xs), min(ys), max(ys)


def _overlap_sweep(meshes: list[Any], nx: int, ny: int) -> tuple[int, int]:
    """Raster the footprint and assert no two DIFFERENT bodies interpenetrate.

    Same check as ``assert_no_overlap_rastered``, but each sample only ray-casts
    the meshes whose map-plane bounding box contains it. With ~300 local bodies
    a full cross-product sweep casts every ray through every triangle in the
    model, which is minutes of pure-Python work per raster row; the box filter
    removes the meshes that cannot possibly be hit and changes no verdict.

    Parameters
    ----------
    meshes : list of LithoBodyMesh
        The built solids.
    nx, ny : int
        Raster resolution across the combined footprint.

    Returns
    -------
    tuple of int
        ``(samples_tested, samples_inside_some_body)``.

    Raises
    ------
    AssertionError
        Via ``assert_no_overlap_sampled``, naming the sample and the two bodies.
    """
    boxes = [_mesh_bbox(m) for m in meshes]
    x_min = min(b[0] for b in boxes)
    x_max = max(b[1] for b in boxes)
    y_min = min(b[2] for b in boxes)
    y_max = max(b[3] for b in boxes)
    tested = 0
    hit = 0
    for i in range(nx):
        for j in range(ny):
            # Cell centres, never grid nodes: a sample landing exactly on a shared
            # vertical seam can read a contact as an overlap.
            x = x_min + (i + 0.5) / nx * (x_max - x_min)
            y = y_min + (j + 0.5) / ny * (y_max - y_min)
            local = [m for m, b in zip(meshes, boxes) if b[0] <= x <= b[1] and b[2] <= y <= b[3]]
            tested += 1
            if local:
                hit += 1
                assert_no_overlap_sampled(local, [(x, y)])
    return tested, hit


def _interior_voids(labels: np.ndarray) -> tuple[int, int, int]:
    """Count unlabelled cells that sit INSIDE the model's own vertical extent.

    A void above the topmost or below the bottommost labelled cell of its column is
    the model simply not reaching there, which is a different thing from a hole. Only
    the cells bracketed by labelled ground in their own column are holes, and they are
    what makes a model read as fragmentary rather than solid.

    Parameters
    ----------
    labels : numpy.ndarray
        The label grid, ``-1`` for void.

    Returns
    -------
    tuple of int
        ``(interior_void_cells, columns_with_model, columns_with_a_hole)``.
    """
    void = labels < 0
    has_model = (~void).any(axis=2)
    interior = 0
    holed = 0
    for ix, iy in np.argwhere(has_model):
        zs = np.flatnonzero(~void[ix, iy])
        gap = int(void[ix, iy, zs.min() : zs.max() + 1].sum())
        interior += gap
        if gap:
            holed += 1
    return interior, int(has_model.sum()), holed


def _label_payload(
    sections_received: list[Any],
    investigation_columns: tuple[Any, ...],
    h: float,
    v: float,
    honor: float,
) -> tuple[Any, list[Any], dict[str, Any]]:
    """Run :class:`BuildVoxelLithoModel`'s labelling pipeline over one payload.

    Mirrors the production order exactly: plan the body aliases on the payload
    and apply them to BOTH the regions and the honored columns, frame the domain
    from the sections AS DRAWN plus the drilled map positions, then label with
    the SEATED sections. Deviating from that order silently produces a model no
    real build would.

    Parameters
    ----------
    sections_received : list of SectionPartitionInput
        The payload's sections, untransformed.
    investigation_columns : tuple of InvestigationColumn
        The model's honored observed columns, from ``load_body_picks``.
    h, v : float
        Horizontal (X/Y) and vertical (Z) voxel edge lengths, metres.
    honor : float
        Honoured-column radius, metres.

    Returns
    -------
    tuple
        ``(grid, sections_as_drawn, notes)`` — the labelled grid, the aliased
        but un-seated sections (what the footprint was framed from), and a dict
        of the counts worth printing.
    """
    aliases = plan_body_aliases(sections_received)
    merged = sum(1 for src, dst in aliases.items() if src != dst)
    sections = apply_body_aliases(sections_received, aliases) if merged else sections_received
    columns = (
        _apply_aliases_to_columns(investigation_columns, aliases)
        if merged
        else investigation_columns
    )
    as_drawn = sections
    seated, moved, shift = apply_true_column_positions(sections, columns)
    domain = build_domain_from_sections(
        as_drawn,
        investigation_positions=tuple((c.investigation_id, c.world_x, c.world_y) for c in columns),
    )
    grid = label_voxels(
        domain,
        h,
        seated,
        vertical_spacing_m=v,
        investigation_columns=columns,
        honor_radius_m=honor,
    )
    notes = {
        "aliases": len(aliases),
        "merged": merged,
        "moved": moved,
        "shift": shift,
        "hull": len(domain.polygon),
        "honored": len(columns),
    }
    return grid, as_drawn, notes


async def main() -> None:
    """Build the geotech voxel model from the emitted payload and dump it."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--payload", default=str(PAYLOAD), help="Voxel payload JSON to build.")
    ap.add_argument("--out", default=str(OUT), help="Where to write the viewer dump.")
    ap.add_argument(
        "--raster",
        type=int,
        default=14,
        help="Overlap-sweep raster resolution per axis (14 -> 196 samples).",
    )
    ap.add_argument(
        "--no-compare-litho",
        action="store_true",
        help="Skip re-labelling the stored litho generation for the side-by-side.",
    )
    args = ap.parse_args()

    print("\n=== GEOTECH 3-D BUILD (READ-ONLY, nothing persisted) ===\n")
    _confirm_db_target()

    payload = json.loads(Path(args.payload).read_text(encoding="utf-8"))
    print(
        f"  payload {args.payload}\n"
        f"    {len(payload['sections'])} sections, "
        f"{sum(len(s['regions']) for s in payload['sections'])} regions, "
        f"{sum(len(s['columns']) for s in payload['sections'])} columns"
    )

    async with AsyncSessionFactory() as session:
        # --- the stored generation supplies the grid the litho model was built on -
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
            raise SystemExit("ABORT: no stored build generation — nothing to take the grid from.")
        litho_model_id = str(gen.model_id)
        h = float(gen.horizontal_spacing_m)
        v = float(gen.vertical_spacing_m)
        honor = float(gen.honor_radius_m)

        # The payload's own spacings must agree with the generation's, or the emitter
        # and this builder describe different grids and no number below is comparable.
        if (
            abs(float(payload.get("horizontal_spacing_m", h)) - h) > 1e-9
            or abs(float(payload.get("vertical_spacing_m", v)) - v) > 1e-9
        ):
            raise SystemExit(
                f"ABORT: payload grid {payload.get('horizontal_spacing_m')} / "
                f"{payload.get('vertical_spacing_m')} m disagrees with the stored "
                f"generation's {h} / {v} m."
            )

        geotech = (
            await session.execute(
                text(
                    "SELECT id::text, name, app_project_id::text FROM geological_model "
                    "WHERE kind = 'geotechnical' AND parent_model_id = :m"
                ),
                {"m": litho_model_id},
            )
        ).all()
        if len(geotech) != 1:
            raise SystemExit(
                f"ABORT: expected exactly one geotechnical child of litho model "
                f"{litho_model_id}, found {len(geotech)}."
            )
        geotech_id, geotech_name, project_id = geotech[0]
        print(
            f"  litho model   {litho_model_id} (generation {gen.id})\n"
            f"  geotech model {geotech_id} ({geotech_name})\n"
            f"  grid {h} m / {v} m | honour {honor} m"
        )

        # --- what the build honors: the geotech model's own resolved picks --------
        picks = await LithoLayerRepository(session).load_body_picks(geotech_id)
        investigation_columns = _investigation_columns_from_picks(picks)
        print(
            f"  honoring {len(investigation_columns)} investigation column(s) "
            f"from {len(picks)} geotech pick(s)"
        )
        # The litho arm of the side-by-side. Loaded here so the session can close
        # before the (long, CPU-bound) labelling starts.
        litho_columns = (
            ()
            if args.no_compare_litho
            else _investigation_columns_from_picks(
                await LithoLayerRepository(session).load_body_picks(litho_model_id)
            )
        )

        # --- formation metadata, for labels / colours in the dump -----------------
        formations: dict[str, dict[str, Any]] = {}
        for fid, name, color, nad_class, soil_code, source_litho in (
            await session.execute(
                text(
                    "SELECT id::text, name, color, nad_class, litho_main_soil_code, "
                    "source_litho_formation_id::text FROM geological_formation "
                    "WHERE app_project_id = :p"
                ),
                {"p": project_id},
            )
        ).all():
            formations[fid] = {
                "name": name,
                "color": color,
                "nad_class": nad_class,
                "soil_code": soil_code,
                "source_litho_formation_id": source_litho,
            }

        # --- section names + investigation names, for the fence context ----------
        section_rows = (
            await session.execute(
                text(
                    "SELECT name, start_x, start_y, end_x, end_y FROM cross_section "
                    "WHERE app_project_id = :p"
                ),
                {"p": project_id},
            )
        ).all()
        section_names: dict[tuple[int, int, int, int], str] = {
            (round(float(sx)), round(float(sy)), round(float(ex)), round(float(ey))): name
            for name, sx, sy, ex, ey in section_rows
        }
        inv_names: dict[str, str] = {}
        for table in ("cpt", "borehole"):
            for inv_id, name in (
                await session.execute(
                    text(f"SELECT id::text, name FROM {table} WHERE app_project_id = :p"),
                    {"p": project_id},
                )
            ).all():
                inv_names[inv_id] = name

    # --- the pipeline, in BuildVoxelLithoModel's order ---------------------------
    t0 = time.perf_counter()
    grid, sections_as_drawn, notes = _label_payload(
        _sections_from_payload(payload), investigation_columns, h, v, honor
    )
    label_s = time.perf_counter() - t0
    print(
        f"  cross-section body merge: aliased {notes['merged']} of {notes['aliases']} body id(s) "
        f"({notes['aliases'] - notes['merged']} component(s) remain)\n"
        f"  re-seated {notes['moved']} section column(s) onto true map positions "
        f"(max shift {notes['shift']:.2f} m)\n"
        f"  domain footprint: {notes['hull']}-vertex hull"
    )
    labels = np.asarray(grid.labels)
    filled = int(np.count_nonzero(labels >= 0))
    cell_m3 = h * h * v
    print(
        f"  labelled {len(grid.gx)}x{len(grid.gy)}x{len(grid.gz)} grid, "
        f"{len(grid.body_id_by_index)} body slots  [{label_s:.1f}s]"
    )

    t0 = time.perf_counter()
    meshes = [m for m in extract_body_solids(grid) if m.vertices and m.triangles]
    extract_s = time.perf_counter() - t0
    total_tris = sum(len(m.triangles) for m in meshes)
    total_verts = sum(len(m.vertices) for m in meshes)
    print(
        f"  extracted {len(meshes)} body solid(s), {total_tris:,} triangles, "
        f"{total_verts:,} vertices  [{extract_s:.1f}s]"
    )

    # --- the two properties the geotech watertight gate asserts -------------------
    manifold_failures: list[str] = []
    for m in meshes:
        try:
            assert_closed_manifold(m.vertices, m.triangles)
        except AssertionError as err:
            manifold_failures.append(f"{m.body_id}: {err}")
    print(
        f"\n  WATERTIGHT : {len(meshes) - len(manifold_failures)}/{len(meshes)} solids are closed "
        f"2-manifolds with consistent winding"
    )
    for line in manifold_failures[:5]:
        print(f"      FAIL {line}")

    t0 = time.perf_counter()
    tested, hit = _overlap_sweep(meshes, args.raster, args.raster)
    print(
        f"  ZERO-OVERLAP: no two different bodies interpenetrate over {tested} rastered "
        f"samples ({hit} inside some body)  [{time.perf_counter() - t0:.1f}s]"
    )
    flagged = sum(1 for m in meshes if m.is_flagged)
    print(f"  FLAGGED    : {flagged} solid(s) flagged (the gate requires 0)")

    # --- per-body volume, from the label grid (exact; the mesh is its boundary) ---
    counts = np.bincount(labels[labels >= 0].ravel(), minlength=len(grid.body_id_by_index))
    volume_by_body: dict[str, float] = {}
    for index, body_id in enumerate(grid.body_id_by_index):
        if index < len(counts):
            volume_by_body[str(body_id)] = float(counts[index]) * cell_m3

    # --- the dump ---------------------------------------------------------------
    bodies_out: list[dict[str, Any]] = []
    for m in meshes:
        meta = formations.get(str(m.formation_id), {})
        parent = formations.get(str(meta.get("source_litho_formation_id")), {})
        nad = meta.get("nad_class")
        label = meta.get("name") or str(m.formation_id)[:8]
        bodies_out.append(
            {
                "id": str(m.body_id),
                "label": f"{label} · {str(m.body_id)[-6:]}",
                "formation_id": str(m.formation_id),
                "formation_name": meta.get("name"),
                "litho_formation_name": parent.get("name"),
                "nad_class": nad,
                "soil_code": meta.get("soil_code"),
                "color": meta.get("color"),
                "volume_m3": round(volume_by_body.get(str(m.body_id), 0.0), 1),
                "vertices": [[round(x, 3), round(y, 3), round(z, 3)] for x, y, z in m.vertices],
                "triangles": [list(t) for t in m.triangles],
            }
        )
    bodies_out.sort(key=lambda b: -b["volume_m3"])

    fences_out: list[dict[str, Any]] = []
    for sec in sections_as_drawn:
        key = (
            round(float(sec.start_x)),
            round(float(sec.start_y)),
            round(float(sec.end_x)),
            round(float(sec.end_y)),
        )
        elevs = [p[1] for r in sec.regions for p in r.polygon]
        fences_out.append(
            {
                "name": section_names.get(key, "?"),
                "start": [sec.start_x, sec.start_y],
                "end": [sec.end_x, sec.end_y],
                "top_elev_m": max(elevs) if elevs else None,
                "base_elev_m": min(elevs) if elevs else None,
                "region_count": len(sec.regions),
                "columns": [
                    {
                        "investigation_id": c.investigation_id,
                        "name": inv_names.get(c.investigation_id, c.investigation_id[:8]),
                        "along_m": c.along_m,
                        "world_x": c.world_x,
                        "world_y": c.world_y,
                    }
                    for c in sec.columns
                ],
            }
        )

    document = {
        "meta": {
            "geotech_model_id": geotech_id,
            "geotech_model_name": geotech_name,
            "litho_model_id": litho_model_id,
            "litho_generation_id": str(gen.id),
            "horizontal_spacing_m": h,
            "vertical_spacing_m": v,
            "honor_radius_m": honor,
            "grid": [len(grid.gx), len(grid.gy), len(grid.gz)],
            "grid_origin": [float(grid.gx[0]), float(grid.gy[0]), float(grid.gz[0])],
            "sections_in_payload": len(payload["sections"]),
            "regions_in_payload": sum(len(s["regions"]) for s in payload["sections"]),
            "bodies": len(meshes),
            "triangles": total_tris,
            "vertices": total_verts,
            "labelled_cells": filled,
            "labelled_volume_m3": filled * cell_m3,
            "manifold_failures": manifold_failures,
            "flagged": flagged,
            "label_seconds": round(label_s, 1),
            "extract_seconds": round(extract_s, 1),
        },
        "bodies": bodies_out,
        "fences": fences_out,
    }
    out_path = Path(args.out)
    out_path.write_text(json.dumps(document), encoding="utf-8")

    # --- headline numbers --------------------------------------------------------
    print("\n  === WHAT THE GEOTECH BUILD PRODUCED ===")
    print(f"    bodies                : {len(meshes)}")
    print(f"    triangles             : {total_tris:,}")
    print(f"    labelled cells        : {filled:,}  ({filled * cell_m3:,.0f} m3)")
    vols = sorted((b["volume_m3"] for b in bodies_out), reverse=True)
    if vols:
        print(
            f"    body volume           : max {vols[0]:,.0f} m3, median {np.median(vols):,.0f} m3, "
            f"min {vols[-1]:,.0f} m3"
        )
        tiny = sum(1 for x in vols if x < 100.0)
        print(f"    bodies under 100 m3   : {tiny} of {len(vols)}")
        top = sum(vols[:10])
        print(
            f"    top 10 bodies hold    : {top:,.0f} m3 "
            f"({100.0 * top / max(sum(vols), 1.0):.1f} % of the labelled volume)"
        )
    by_nad: dict[Any, float] = {}
    for b in bodies_out:
        by_nad[b["nad_class"]] = by_nad.get(b["nad_class"], 0.0) + b["volume_m3"]
    print("\n    NAD class      bodies        volume m3")
    for nad in sorted(by_nad, key=lambda k: -by_nad[k]):
        n_bodies = sum(1 for b in bodies_out if b["nad_class"] == nad)
        print(f"    {str(nad):<12} {n_bodies:>7} {by_nad[nad]:>16,.0f}")

    # --- the same question asked of the LITHO model, on the same grid ------------
    # The litho generation is a build the owner ran, so re-labelling its own stored
    # payload is a like-for-like comparison rather than a claim: same pipeline, same
    # spacings, same honour radius — only the model differs. Only the labelling is
    # repeated (extraction is the slow half and the persisted solid/triangle counts
    # already record its result).
    if not args.no_compare_litho:
        t0 = time.perf_counter()
        litho_grid, _litho_drawn, litho_notes = _label_payload(
            _sections_from_payload(gen.payload), litho_columns, h, v, honor
        )
        litho_labels = np.asarray(litho_grid.labels)
        litho_filled = int(np.count_nonzero(litho_labels >= 0))
        print(f"\n  === THE SAME GRID, THE LITHO MODEL ===  [{time.perf_counter() - t0:.1f}s]")
        print(f"    {'':22} {'geotech':>14} {'litho':>14}")
        print(
            f"    {'sections in payload':22} {len(payload['sections']):>14} "
            f"{len(gen.payload['sections']):>14}"
        )
        print(
            f"    {'regions in payload':22} "
            f"{sum(len(s['regions']) for s in payload['sections']):>14} "
            f"{sum(len(s['regions']) for s in gen.payload['sections']):>14}"
        )
        print(
            f"    {'columns in payload':22} "
            f"{sum(len(s['columns']) for s in payload['sections']):>14} "
            f"{sum(len(s['columns']) for s in gen.payload['sections']):>14}"
        )
        print(f"    {'honored columns':22} {notes['honored']:>14} {litho_notes['honored']:>14}")
        print(
            f"    {'grid':22} "
            f"{f'{len(grid.gx)}x{len(grid.gy)}x{len(grid.gz)}':>14} "
            f"{f'{len(litho_grid.gx)}x{len(litho_grid.gy)}x{len(litho_grid.gz)}':>14}"
        )
        print(
            f"    {'body slots':22} {len(grid.body_id_by_index):>14} "
            f"{len(litho_grid.body_id_by_index):>14}"
        )
        print(f"    {'labelled cells':22} {filled:>14,} {litho_filled:>14,}")
        print(
            f"    {'labelled volume m3':22} {filled * cell_m3:>14,.0f} "
            f"{litho_filled * cell_m3:>14,.0f}"
        )
        # Where each model reaches. Same axes only if both grids framed the same
        # elevation range — they need not, so compare the map-plane footprint only.
        geo_void, geo_cols, geo_holed = _interior_voids(labels)
        litho_void, litho_cols, litho_holed = _interior_voids(litho_labels)
        print(f"    {'map cells with model':22} {geo_cols:>14,} {litho_cols:>14,}")
        print(f"    {'interior void cells':22} {geo_void:>14,} {litho_void:>14,}")
        print(
            f"    {'map cells with a hole':22} {geo_holed:>14,} {litho_holed:>14,}"
            f"   ({100.0 * geo_holed / max(geo_cols, 1):.1f} % vs "
            f"{100.0 * litho_holed / max(litho_cols, 1):.1f} %)"
        )

    print(f"\n  wrote {out_path}  ({out_path.stat().st_size / 1024 / 1024:.1f} MiB)\n")


if __name__ == "__main__":
    asyncio.run(main())

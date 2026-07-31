"""READ-ONLY: dump everything the v1-vs-v2 partition-engine A/B emitter needs.

The A/B emitter (``desktop/src/renderer/src/utils/enginePayloadAB.diag.test.ts``)
runs the two partition engines over the SAME real-model inputs and writes one
voxel-build payload per engine. Everything it needs has to come out of the dev
database in a single, self-consistent snapshot, because the two halves of the
input live in different places:

* the 2-D engine inputs (accepted litho units, approved correlation edges,
  surface elevations) are live rows and drift whenever the owner edits;
* the world positions of each column are CANONICAL — the projection foot on the
  densest section carrying that test — and are only recoverable from a stored
  build generation's payload, because the frontend computes them across all
  sections at once.

Mixing a fresh row read with a stale capture of the other half is how a
diagnostic silently ends up describing a model nobody has built. So this script
takes the section set, the section order and the per-column world positions from
ONE stored generation (the anchor), and joins today's rows onto it.

The join key is the section line's endpoint quadruple → ``cross_section.id``,
never the array index: the payload's section order and the section order of any
other capture in this repo do not agree.

Nothing is written to the database. Reads only, behind the usual dev-DB guard.

Usage
-----
    uv run python scripts/diag_engine_ab_dump.py
    uv run python scripts/diag_engine_ab_dump.py --generation <uuid>
    uv run python scripts/diag_engine_ab_dump.py --out scripts/other.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any
from uuid import UUID

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sqlalchemy import text  # noqa: E402

from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402
from scripts.eval_strat_fidelity import _confirm_db_target  # noqa: E402

_DEFAULT_OUT = _REPO_ROOT / "scripts" / "throwaway_engine_ab_inputs.json"

# Endpoint match tolerance in metres. The payload stores the section line as
# float metres in the project CRS and the cross_section row is the same value
# round-tripped through the API, so agreement is exact in practice; the tolerance
# only guards against a float printed at reduced precision somewhere in between.
_ENDPOINT_TOL_M = 0.01


async def _fetch_generation(session: Any, generation_id: UUID | None) -> dict[str, Any]:
    """Load the anchor build generation (newest, or the one named).

    Parameters
    ----------
    session : AsyncSession
        Open read-only session against the dev database.
    generation_id : UUID or None
        Specific generation to load. ``None`` loads the most recent one.

    Returns
    -------
    dict
        Mapping of the generation row's columns, including its ``payload``.

    Raises
    ------
    SystemExit
        When no generation exists, or the named generation is absent.
    """
    sql = (
        "SELECT id::text, model_id::text, created_at, builder_version, sections_count, "
        "bodies_built, triangles, horizontal_spacing_m, vertical_spacing_m, honor_radius_m, "
        "litho_snap_tolerance_m, payload "
        "FROM litho_build_generation "
    )
    if generation_id is not None:
        sql += "WHERE id = :gid "
    sql += "ORDER BY created_at DESC LIMIT 1"
    row = (
        (await session.execute(text(sql), {"gid": str(generation_id)} if generation_id else {}))
        .mappings()
        .first()
    )
    if row is None:
        raise SystemExit("ABORT: no litho_build_generation row found — click Build once first.")
    return dict(row)


async def _fetch_sections(session: Any, model_id: str) -> list[dict[str, Any]]:
    """Load every cross-section of the project owning ``model_id``.

    Parameters
    ----------
    session : AsyncSession
        Open read-only session.
    model_id : str
        The lithostratigraphic model id whose project's sections to load.

    Returns
    -------
    list of dict
        One entry per section with id, name and the four endpoint coordinates.
    """
    rows = (
        (
            await session.execute(
                text(
                    "SELECT cs.id::text AS id, cs.name, cs.start_x, cs.start_y, cs.end_x, cs.end_y "
                    "FROM cross_section cs "
                    "JOIN geological_model gm ON gm.app_project_id = cs.app_project_id "
                    "WHERE gm.id = :mid"
                ),
                {"mid": model_id},
            )
        )
        .mappings()
        .all()
    )
    return [dict(r) for r in rows]


async def _fetch_units_by_investigation(session: Any, model_id: str) -> dict[str, list[dict]]:
    """Load every accepted litho unit of the model, grouped by investigation.

    Units are ordered by depth, which is the order the frontend's section
    assembly imposes before handing a column to the partition engine.

    Parameters
    ----------
    session : AsyncSession
        Open read-only session.
    model_id : str
        The lithostratigraphic model id.

    Returns
    -------
    dict
        Investigation id → its ordered unit stack, each unit carrying
        ``layerId``, ``topDepthM``, ``baseDepthM``, ``formationId`` and ``bodyId``.
    """
    rows = (
        (
            await session.execute(
                text(
                    "SELECT id::text AS layer_id, COALESCE(cpt_id, borehole_id)::text AS inv_id, "
                    "depth_top_m, depth_base_m, formation_id::text AS formation_id, "
                    "body_id::text AS body_id "
                    "FROM litho_layer WHERE model_id = :mid AND status = 'accepted' "
                    "ORDER BY COALESCE(cpt_id, borehole_id), depth_top_m"
                ),
                {"mid": model_id},
            )
        )
        .mappings()
        .all()
    )
    out: dict[str, list[dict]] = {}
    for r in rows:
        out.setdefault(r["inv_id"], []).append(
            {
                "layerId": r["layer_id"],
                "topDepthM": float(r["depth_top_m"]),
                "baseDepthM": float(r["depth_base_m"]),
                "formationId": r["formation_id"],
                "bodyId": r["body_id"],
            }
        )
    return out


async def _fetch_surface_elevations(session: Any) -> dict[str, float]:
    """Load the surface elevation of every CPT and borehole that has one.

    Parameters
    ----------
    session : AsyncSession
        Open read-only session.

    Returns
    -------
    dict
        Investigation id → surface elevation in mTAW.
    """
    elev: dict[str, float] = {}
    for table in ("cpt", "borehole"):
        rows = (
            (
                await session.execute(
                    text(
                        f"SELECT id::text AS id, elevation_m "  # noqa: S608
                        f"FROM {table} WHERE elevation_m IS NOT NULL"
                    )
                )
            )
            .mappings()
            .all()
        )
        for r in rows:
            elev[r["id"]] = float(r["elevation_m"])
    return elev


async def _fetch_edges_by_section(session: Any, model_id: str) -> dict[str, list[dict]]:
    """Load the model's approved correlation edges, grouped by section.

    The sides are load-bearing: the engine splits edges into top-keyed,
    base-tied and mixed lookups whose band semantics differ, so an edge whose
    side is defaulted to ``top`` silently becomes a different correlation.

    Parameters
    ----------
    session : AsyncSession
        Open read-only session.
    model_id : str
        The lithostratigraphic model id.

    Returns
    -------
    dict
        Section id → list of ``{a, b, aSide, bSide, source}`` edges.
    """
    rows = (
        (
            await session.execute(
                text(
                    "SELECT section_id::text AS section_id, layer_a_id::text AS a, "
                    "layer_b_id::text AS b, layer_a_side AS a_side, layer_b_side AS b_side, source "
                    "FROM litho_contact_correlation_edge "
                    "WHERE model_id = :mid AND user_approved = true"
                ),
                {"mid": model_id},
            )
        )
        .mappings()
        .all()
    )
    out: dict[str, list[dict]] = {}
    for r in rows:
        out.setdefault(r["section_id"], []).append(
            {
                "a": r["a"],
                "b": r["b"],
                "aSide": r["a_side"],
                "bSide": r["b_side"],
                "source": r["source"],
            }
        )
    return out


async def _fetch_boundaries(session: Any, model_id: str) -> list[dict[str, Any]]:
    """Load one boundary response per body, mirroring what the app fetches.

    The production build request builder lists every body and fetches each
    body's boundary, so the map it hands the override derivation has one entry
    per body — most of them with empty node arrays. That matters beyond
    completeness: ``buildVoxelRequest`` only runs its no-override base pass when
    the map is non-empty, so a dump carrying only the hand-drawn bodies would
    skip a pass the real build runs.

    Parameters
    ----------
    session : AsyncSession
        Open read-only session.
    model_id : str
        The lithostratigraphic model id.

    Returns
    -------
    list of dict
        One ``BodyBoundaryResponse``-shaped entry per body of the model.
    """
    bodies = (
        (
            await session.execute(
                text(
                    "SELECT id::text AS id, primary_section_id::text AS primary_section_id "
                    "FROM body WHERE model_id = :mid"
                ),
                {"mid": model_id},
            )
        )
        .mappings()
        .all()
    )
    shapes = (
        (
            await session.execute(
                text(
                    "SELECT s.body_id::text AS body_id, s.render_style, n.boundary, n.node_index, "
                    "n.along_m, n.elevation_m "
                    "FROM body_boundary_shape s "
                    "LEFT JOIN body_boundary_node n ON n.shape_id = s.id "
                    "WHERE s.model_id = :mid "
                    "ORDER BY s.body_id, n.boundary, n.node_index"
                ),
                {"mid": model_id},
            )
        )
        .mappings()
        .all()
    )

    style_by_body: dict[str, str] = {}
    nodes_by_body: dict[str, dict[str, list[dict]]] = {}
    for r in shapes:
        style_by_body[r["body_id"]] = r["render_style"]
        slot = nodes_by_body.setdefault(r["body_id"], {"upper": [], "lower": []})
        if r["boundary"] is None:
            continue
        slot[r["boundary"]].append(
            {"along_m": float(r["along_m"]), "elevation_m": float(r["elevation_m"])}
        )

    out: list[dict[str, Any]] = []
    for b in bodies:
        nodes = nodes_by_body.get(b["id"], {"upper": [], "lower": []})
        out.append(
            {
                "body_id": b["id"],
                # Only the node arrays are load-bearing: the override derivation
                # (buildApexOverridesForGaps / collectContactOverridesForGap) reads
                # upper_nodes and lower_nodes and nothing else off this object. The
                # remaining fields are carried so the dumped shape stays recognisably
                # a BodyBoundaryResponse; content_key lives on the shape row, not on
                # the body, and no shape row means no key.
                "content_key": None,
                "render_style": style_by_body.get(b["id"], "straight"),
                "primary_section_id": b["primary_section_id"],
                "upper_nodes": nodes["upper"],
                "lower_nodes": nodes["lower"],
            }
        )
    return out


async def _fetch_formation_names(session: Any, model_id: str) -> dict[str, str]:
    """Load formation id → name for readable console output.

    Parameters
    ----------
    session : AsyncSession
        Open read-only session.
    model_id : str
        The lithostratigraphic model id whose project's formations to load.

    Returns
    -------
    dict
        Formation id → display name.
    """
    rows = (
        (
            await session.execute(
                text(
                    "SELECT f.id::text AS id, f.name FROM geological_formation f "
                    "JOIN geological_model gm ON gm.app_project_id = f.app_project_id "
                    "WHERE gm.id = :mid"
                ),
                {"mid": model_id},
            )
        )
        .mappings()
        .all()
    )
    return {r["id"]: r["name"] for r in rows}


def _match_section(payload_section: dict, db_sections: list[dict[str, Any]]) -> dict[str, Any]:
    """Resolve a payload section to its ``cross_section`` row by line endpoints.

    Parameters
    ----------
    payload_section : dict
        One entry of the stored generation payload's ``sections`` array.
    db_sections : list of dict
        Every cross-section of the project.

    Returns
    -------
    dict
        The matching cross-section row.

    Raises
    ------
    SystemExit
        When the endpoints match no section, or more than one.
    """
    hits = [
        s
        for s in db_sections
        if abs(float(s["start_x"]) - payload_section["start_x"]) < _ENDPOINT_TOL_M
        and abs(float(s["start_y"]) - payload_section["start_y"]) < _ENDPOINT_TOL_M
        and abs(float(s["end_x"]) - payload_section["end_x"]) < _ENDPOINT_TOL_M
        and abs(float(s["end_y"]) - payload_section["end_y"]) < _ENDPOINT_TOL_M
    ]
    if len(hits) != 1:
        raise SystemExit(
            f"ABORT: payload section starting at ({payload_section['start_x']:.2f}, "
            f"{payload_section['start_y']:.2f}) matched {len(hits)} cross_section rows — "
            f"the endpoint join is not unambiguous on this project."
        )
    return hits[0]


async def main() -> None:
    """Assemble and write the A/B input snapshot, then report what it contains."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--generation", type=UUID, default=None)
    ap.add_argument("--out", type=Path, default=_DEFAULT_OUT)
    args = ap.parse_args()

    print("\n=== ENGINE A/B INPUT DUMP (READ-ONLY) ===\n")
    _confirm_db_target()

    async with AsyncSessionFactory() as session:
        gen = await _fetch_generation(session, args.generation)
        model_id = gen["model_id"]
        db_sections = await _fetch_sections(session, model_id)
        units_by_inv = await _fetch_units_by_investigation(session, model_id)
        elev = await _fetch_surface_elevations(session)
        edges_by_section = await _fetch_edges_by_section(session, model_id)
        boundaries = await _fetch_boundaries(session, model_id)
        formation_names = await _fetch_formation_names(session, model_id)

    payload_sections = gen["payload"]["sections"]
    print(
        f"\n  anchor generation {gen['id']}  ({gen['created_at']:%Y-%m-%d %H:%M} UTC, "
        f"{gen['builder_version']})\n"
        f"    model {model_id}\n"
        f"    {gen['sections_count']} section(s), {gen['bodies_built']} bodies, "
        f"{gen['triangles']:,} triangles\n"
        f"    grid {gen['horizontal_spacing_m']} m / {gen['vertical_spacing_m']} m, "
        f"honor {gen['honor_radius_m']} m\n"
    )

    anchor_regions = sum(len(s["regions"]) for s in payload_sections)
    out_sections: list[dict[str, Any]] = []
    missing_elev: list[str] = []
    empty_stacks: list[str] = []

    for sec in payload_sections:
        db_sec = _match_section(sec, db_sections)
        columns: list[dict[str, Any]] = []
        for col in sec["columns"]:
            inv = col["investigation_id"]
            units = units_by_inv.get(inv, [])
            if inv not in elev:
                missing_elev.append(inv)
            if not units:
                empty_stacks.append(inv)
            columns.append(
                {
                    "investigationId": inv,
                    "alongM": float(col["along_m"]),
                    "worldX": float(col["world_x"]),
                    "worldY": float(col["world_y"]),
                    "surfaceElevM": elev.get(inv),
                    "units": units,
                }
            )
        out_sections.append(
            {
                "sectionId": db_sec["id"],
                "name": db_sec["name"],
                "start_x": float(sec["start_x"]),
                "start_y": float(sec["start_y"]),
                "end_x": float(sec["end_x"]),
                "end_y": float(sec["end_y"]),
                "columns": columns,
                "edges": edges_by_section.get(db_sec["id"], []),
                "anchorRegionCount": len(sec["regions"]),
            }
        )
        print(
            f"    {db_sec['name']:<20} cols={len(columns):>3}  "
            f"units={sum(len(c['units']) for c in columns):>4}  "
            f"edges={len(edges_by_section.get(db_sec['id'], [])):>4}  "
            f"anchorRegions={len(sec['regions']):>4}"
        )

    drawn = [b for b in boundaries if b["upper_nodes"] or b["lower_nodes"]]
    print(
        f"\n  {len(boundaries)} body boundary response(s); {len(drawn)} carry hand-drawn nodes "
        f"({sum(len(b['upper_nodes']) + len(b['lower_nodes']) for b in drawn)} node(s) total)"
    )
    if missing_elev:
        print(
            f"  !! {len(missing_elev)} column(s) have NO surface elevation: "
            f"{sorted(set(missing_elev))}"
        )
    if empty_stacks:
        print(
            f"  !! {len(empty_stacks)} column(s) have NO accepted units: "
            f"{sorted(set(empty_stacks))}"
        )
    if not missing_elev and not empty_stacks:
        print("  every anchor column still has a surface elevation and a non-empty unit stack")

    snapshot = {
        "generationId": gen["id"],
        "modelId": model_id,
        "builderVersion": gen["builder_version"],
        "horizontalSpacingM": float(gen["horizontal_spacing_m"]),
        "verticalSpacingM": float(gen["vertical_spacing_m"]),
        "anchor": {
            "sections": len(payload_sections),
            "regions": anchor_regions,
            "bodies": gen["bodies_built"],
            "triangles": gen["triangles"],
        },
        "formationNames": formation_names,
        "sections": out_sections,
        "boundaries": boundaries,
    }
    args.out.write_text(json.dumps(snapshot, indent=1), encoding="utf-8")
    print(
        f"\n  wrote {args.out}: {len(out_sections)} section(s), "
        f"{sum(len(s['columns']) for s in out_sections)} column(s), "
        f"anchor payload carries {anchor_regions} region(s)\n"
    )


if __name__ == "__main__":
    asyncio.run(main())

"""READ-ONLY dump of BOTH sets of inputs the geotech axis derives geometry from.

On the geotech axis the section canvas and the 3-D build do not share a
computation. The canvas builds the LITHO partition and refines it in
thickness-fraction space::

    partition = computeSectionFillActive(LITHO columns, LITHO edges, ...)
    refined   = refineLithoPartition(partition, geotech refinement bundle)

while "Build model" runs the engine a second time on a different model
entirely::

    computeSectionFill(GEOTECH columns, GEOTECH edges)

This script extracts both sets of inputs for every section of the owner's real
project so a TypeScript harness can compute the two geometries side by side
without touching the database. It measures nothing itself and changes nothing —
it is the loader the measurement runs on.

Provenance of each field is traced to the code that consumes it:

* the LITHO arm mirrors ``PartitionFillOverlay``'s column assembly
  (``assembleSectionPartitionInput``: accepted layers only, columns with a
  surface elevation and at least one accepted unit, sorted by along-position,
  units sorted shallow to deep) and its edge filter (``user_approved``, the
  section's own edges, the LITHO model);
* the GEOTECH arm mirrors ``makeVoxelRequestBuilder`` →
  ``assembleLithoSectionInputs`` → the same shared assembly, but on the GEOTECH
  model's layers and the edges ``fetchApprovedEdgesBySection`` fetches for the
  GEOTECH model;
* the refinement bundle mirrors ``SectionsCanvas``'s ``geotechRefinement``
  memo (``geotechLayers`` / ``nadMeta`` / ``lithoSoilByFormationId`` /
  ``lithoFormationColorById``).

Each section's LITHO block is emitted under the same key names as
``scripts/diag_allsections_extract.py`` writes (``sectionId`` / ``name`` /
``columns`` / ``edges`` / ``alongM``) so the harnesses already written against
``scripts/diag_allsections_input.json`` read this file unchanged.

Run: ``uv run python scripts/dump_geotech_axis_inputs.py``
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sqlalchemy import text  # noqa: E402

from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402
from scripts.eval_strat_fidelity import _confirm_db_target  # noqa: E402

OUT = _REPO_ROOT / "scripts" / "throwaway_geotech_axis_inputs.json"

# Two columns of a section are the same column when their along-positions agree
# to a millimetre. Used only by the anchor check against the persisted build.
ANCHOR_TOL_M = 0.001


def _section_kind(name: str) -> str:
    """Classify a section as a cross-section or a tie from its name.

    ``cross_section`` has no kind column — the distinction is a naming
    convention in the owner's project ("Cross-section 1", "Tie-section 7"), so
    the classification is reported alongside the raw name and a reader can
    always check it.

    Parameters
    ----------
    name : str
        The section's stored name.

    Returns
    -------
    str
        ``'cross'``, ``'tie'`` or ``'other'``.
    """
    lowered = name.strip().lower()
    if lowered.startswith("cross-section") or lowered.startswith("cross section"):
        return "cross"
    if lowered.startswith("tie-section") or lowered.startswith("tie section"):
        return "tie"
    return "other"


def _project_onto(
    start_x: float,
    start_y: float,
    end_x: float,
    end_y: float,
    px: float,
    py: float,
) -> tuple[float, float] | None:
    """Project a point onto a section line.

    Reproduces ``projectPointOntoLine`` in
    ``desktop/src/renderer/src/utils/sectionProjection.ts`` exactly: the
    along-distance is the dot product with the unit direction, the offset is
    the 2-D cross product, both in the section's own CRS.

    Parameters
    ----------
    start_x, start_y, end_x, end_y : float
        The section endpoints in the project CRS, metres.
    px, py : float
        The investigation's easting and northing, metres.

    Returns
    -------
    tuple of float or None
        ``(along, signed offset)`` in metres; ``None`` for a zero-length line.
    """
    dx = end_x - start_x
    dy = end_y - start_y
    length_sq = dx * dx + dy * dy
    if length_sq < 1e-12:
        return None
    length = math.sqrt(length_sq)
    ux = dx / length
    uy = dy / length
    vx = px - start_x
    vy = py - start_y
    return vx * ux + vy * uy, vx * uy - vy * ux


def _assemble_columns(
    section: dict[str, Any],
    investigations: list[dict[str, Any]],
    units_by_inv: dict[str, list[dict[str, Any]]],
) -> tuple[list[dict[str, Any]], list[float]]:
    """Assemble one section's partition columns for one model's layers.

    Mirrors ``investigationsOnSection`` followed by
    ``assembleSectionPartitionInput``: keep the investigations inside the
    lateral buffer and the line span that are not explicitly excluded, drop
    those with no surface elevation or no units in this model, order the
    survivors by along-position and each column's units shallow to deep.

    Parameters
    ----------
    section : dict
        The section row (endpoints, buffer, exclusion lists).
    investigations : list of dict
        Every CPT and borehole of the project with an id, position and
        elevation.
    units_by_inv : dict
        Investigation id to that investigation's already-shaped unit list for
        the model being assembled.

    Returns
    -------
    tuple
        ``(columns, alongM)`` — the ``PartitionColumn``-shaped column list and
        the parallel true along-section positions in metres.
    """
    excluded = set(section["excludedCptIds"]) | set(section["excludedBoreholeIds"])
    projected: list[tuple[float, dict[str, Any]]] = []
    # sqrt(dx^2 + dy^2), NOT math.dist. The two disagree in the last bit, and
    # the span test is a knife edge for an investigation drilled exactly on a
    # section endpoint: Tie-section 14 ends on GEO-10/117-B4, whose along
    # exceeds the JS length by one ulp and falls short of math.dist's more
    # accurate length. The app drops that column and the persisted build proves
    # it, so the loader has to reproduce the JS arithmetic, not improve on it.
    dx = section["endX"] - section["startX"]
    dy = section["endY"] - section["startY"]
    line_length = math.sqrt(dx * dx + dy * dy)
    for inv in investigations:
        if inv["id"] in excluded:
            continue
        p = _project_onto(
            section["startX"],
            section["startY"],
            section["endX"],
            section["endY"],
            inv["locationX"],
            inv["locationY"],
        )
        if p is None:
            continue
        along, offset = p
        if along < 0 or along > line_length:
            continue
        if abs(offset) > section["projectionBufferM"]:
            continue
        projected.append((along, inv))

    projected.sort(key=lambda pair: pair[0])
    columns: list[dict[str, Any]] = []
    along_m: list[float] = []
    for along, inv in projected:
        if inv["elevationM"] is None:
            continue
        units = sorted(units_by_inv.get(inv["id"], []), key=lambda u: u["topDepthM"])
        if not units:
            continue
        columns.append(
            {
                "investigationId": inv["id"],
                "surfaceElevM": inv["elevationM"],
                "units": units,
            }
        )
        along_m.append(along)
    return columns, along_m


async def _load(session, model_id: str) -> dict[str, list[dict[str, Any]]]:
    """Load one model's accepted layers, grouped by investigation.

    Parameters
    ----------
    session : AsyncSession
        Open read-only session.
    model_id : str
        The model whose layers are loaded. Layers are model-scoped, so no
        project filter is needed.

    Returns
    -------
    dict
        Investigation id to unit dicts in the engine's ``PartitionUnit`` shape.
    """
    rows = (
        await session.execute(
            text(
                "SELECT id::text, COALESCE(cpt_id, borehole_id)::text AS inv, "
                "depth_top_m, depth_base_m, formation_id::text, body_id::text, status "
                "FROM litho_layer WHERE model_id = :m AND status = 'accepted' "
                "ORDER BY inv, depth_top_m"
            ),
            {"m": model_id},
        )
    ).all()
    out: dict[str, list[dict[str, Any]]] = {}
    for layer_id, inv, top, base, formation_id, body_id, _status in rows:
        if inv is None:
            continue
        out.setdefault(inv, []).append(
            {
                "layerId": layer_id,
                "topDepthM": float(top),
                "baseDepthM": float(base),
                "formationId": formation_id,
                "bodyId": body_id,
            }
        )
    return out


async def _edges(session, model_id: str, section_id: str) -> list[dict[str, Any]]:
    """Load the approved correlation edges of one model on one section.

    This is the same row set the desktop's ``fetchApprovedEdgesBySection``
    ends up with: ``GET .../models/{mid}/contact-correlations?section_id={sid}``
    filters ``model_id`` and ``section_id`` in SQL (see
    ``api/routers/geology/contact_correlations.py``) and the client keeps the
    rows with ``user_approved``.

    Parameters
    ----------
    session : AsyncSession
        Open read-only session.
    model_id : str
        Litho or geotech model id.
    section_id : str
        The section the edges were authored on.

    Returns
    -------
    list of dict
        ``{a, b, aSide, bSide, source}`` per edge.
    """
    rows = (
        await session.execute(
            text(
                "SELECT layer_a_id::text, layer_b_id::text, layer_a_side, layer_b_side, source "
                "FROM litho_contact_correlation_edge "
                "WHERE model_id = :m AND section_id = :s AND user_approved = true "
                "ORDER BY created_at"
            ),
            {"m": model_id, "s": section_id},
        )
    ).all()
    return [
        {"a": a, "b": b, "aSide": a_side, "bSide": b_side, "source": src}
        for a, b, a_side, b_side, src in rows
    ]


async def main() -> None:
    """Extract both arms' inputs for every section and write the JSON."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--litho-model",
        default=None,
        help="Litho model id; defaults to the one carrying the most accepted layers.",
    )
    args = parser.parse_args()

    print("\n=== GEOTECH-AXIS INPUT DUMP (READ-ONLY) ===\n")
    _confirm_db_target()

    async with AsyncSessionFactory() as session:
        # --- models -------------------------------------------------------
        if args.litho_model:
            litho_id = args.litho_model
        else:
            litho_id = (
                await session.execute(
                    text(
                        "SELECT m.id::text FROM geological_model m "
                        "LEFT JOIN litho_layer l ON l.model_id = m.id "
                        "WHERE m.kind = 'lithostratigraphic' "
                        "GROUP BY m.id ORDER BY count(l.id) DESC LIMIT 1"
                    )
                )
            ).scalar_one()
        litho_name, project_id = (
            await session.execute(
                text("SELECT name, app_project_id::text FROM geological_model WHERE id = :m"),
                {"m": litho_id},
            )
        ).one()
        geotech = (
            await session.execute(
                text(
                    "SELECT id::text, name FROM geological_model "
                    "WHERE kind = 'geotechnical' AND parent_model_id = :m"
                ),
                {"m": litho_id},
            )
        ).all()
        if len(geotech) != 1:
            raise SystemExit(
                f"ABORT: expected exactly one geotechnical child of litho model {litho_id}, "
                f"found {len(geotech)}."
            )
        geotech_id, geotech_name = geotech[0]
        print(f"  project      {project_id}")
        print(f"  litho  model {litho_id}  ({litho_name})")
        print(f"  geotech model {geotech_id}  ({geotech_name})")

        # --- investigations ----------------------------------------------
        investigations: list[dict[str, Any]] = []
        for table in ("cpt", "borehole"):
            for inv_id, name, x, y, elev in (
                await session.execute(
                    text(
                        f"SELECT id::text, name, location_x, location_y, elevation_m "
                        f"FROM {table} WHERE app_project_id = :p"
                    ),
                    {"p": project_id},
                )
            ).all():
                investigations.append(
                    {
                        "id": inv_id,
                        "name": name,
                        "kind": table,
                        "locationX": float(x),
                        "locationY": float(y),
                        "elevationM": None if elev is None else float(elev),
                    }
                )
        print(f"  investigations in project: {len(investigations)}")

        # --- layers -------------------------------------------------------
        litho_units = await _load(session, litho_id)
        geotech_units = await _load(session, geotech_id)
        status_hist = {
            kind: dict(
                (row[0], row[1])
                for row in (
                    await session.execute(
                        text(
                            "SELECT status, count(*) FROM litho_layer "
                            "WHERE model_id = :m GROUP BY status"
                        ),
                        {"m": mid},
                    )
                ).all()
            )
            for kind, mid in (("litho", litho_id), ("geotech", geotech_id))
        }
        print(f"  litho   layers by status: {status_hist['litho']}")
        print(f"  geotech layers by status: {status_hist['geotech']}")

        # --- formations (the refinement bundle) ---------------------------
        formation_rows = (
            await session.execute(
                text(
                    "SELECT id::text, name, color, nad_class, litho_main_soil_code, "
                    "source_litho_formation_id::text "
                    "FROM geological_formation WHERE app_project_id = :p"
                ),
                {"p": project_id},
            )
        ).all()
        formation_names: dict[str, str] = {}
        nad_meta: dict[str, dict[str, Any]] = {}
        litho_soil: dict[str, str | None] = {}
        litho_color: dict[str, str] = {}
        geotech_color: dict[str, str] = {}
        for fid, name, color, nad_class, soil_code, source_litho in formation_rows:
            formation_names[fid] = name
            is_geotech = source_litho is not None
            is_litho = soil_code is not None and source_litho is None
            if is_geotech:
                # SectionsCanvas: nadMeta.set(f.id, {nadClass, soilCode}) over
                # geotechFormations (isGeotechUnit = source_litho_formation_id set).
                nad_meta[fid] = {"nadClass": nad_class, "soilCode": soil_code}
                geotech_color[fid] = color
            if is_litho:
                # SectionsCanvas: the two litho maps over lithoFormations
                # (isLithoUnit = soil code set AND no source litho formation).
                litho_soil[fid] = soil_code
                litho_color[fid] = color
        print(
            f"  formations: {len(litho_soil)} litho, {len(nad_meta)} geotech "
            f"({sum(1 for v in nad_meta.values() if v['nadClass'] is None)} with no NAD class)"
        )

        # --- hand-drawn body boundaries -----------------------------------
        # The render arm derives apex overrides from the LITHO model's stored
        # boundaries; the build arm fetches them for whichever model it builds,
        # so the geotech build would read the GEOTECH model's. Bodies with no
        # stored shape return empty node lists and produce no override, so only
        # stored shapes are emitted.
        boundaries: dict[str, dict[str, Any]] = {"litho": {}, "geotech": {}}
        for model_key, mid in (("litho", litho_id), ("geotech", geotech_id)):
            for shape_id, body_id, style, primary_section in (
                await session.execute(
                    text(
                        "SELECT s.id::text, s.body_id::text, s.render_style, "
                        "b.primary_section_id::text FROM body_boundary_shape s "
                        "JOIN body b ON b.id = s.body_id WHERE s.model_id = :m"
                    ),
                    {"m": mid},
                )
            ).all():
                nodes = (
                    await session.execute(
                        text(
                            "SELECT boundary, along_m, elevation_m FROM body_boundary_node "
                            "WHERE shape_id = :s ORDER BY boundary, node_index"
                        ),
                        {"s": shape_id},
                    )
                ).all()
                boundaries[model_key][body_id] = {
                    "body_id": body_id,
                    "render_style": style,
                    "primary_section_id": primary_section,
                    "upper_nodes": [
                        {"along_m": float(a), "elevation_m": float(e)}
                        for b, a, e in nodes
                        if b == "upper"
                    ],
                    "lower_nodes": [
                        {"along_m": float(a), "elevation_m": float(e)}
                        for b, a, e in nodes
                        if b == "lower"
                    ],
                }
        print(
            f"  stored body boundaries: litho {len(boundaries['litho'])}, "
            f"geotech {len(boundaries['geotech'])}"
        )

        # --- the anchor ---------------------------------------------------
        # The columns below are computed here, so on their own they are a
        # claim. The newest persisted build generation is a real build the
        # owner ran; matching its per-section column ids and along-positions is
        # what makes the LITHO arm reproduced rather than asserted.
        gen = (
            await session.execute(
                text(
                    "SELECT id::text, created_at, payload FROM litho_build_generation "
                    "WHERE model_id = :m ORDER BY created_at DESC LIMIT 1"
                ),
                {"m": litho_id},
            )
        ).first()
        anchor_sections: dict[tuple[int, int, int, int], list[dict[str, Any]]] = {}
        anchor_meta: dict[str, Any] = {"generationId": None, "createdAt": None}
        if gen is not None:
            gen_id, created_at, payload = gen
            payload = payload if isinstance(payload, dict) else json.loads(payload)
            anchor_meta = {"generationId": gen_id, "createdAt": created_at.isoformat()}
            for sec in payload.get("sections", []):
                key = (
                    round(sec["start_x"]),
                    round(sec["start_y"]),
                    round(sec["end_x"]),
                    round(sec["end_y"]),
                )
                anchor_sections[key] = sec["columns"]
            print(
                f"  anchor: build generation {gen_id} ({created_at:%Y-%m-%d %H:%M}) "
                f"with {len(anchor_sections)} section(s)"
            )
        else:
            print("  anchor: NONE — no persisted litho build generation for this model")
        geotech_gen = (
            await session.execute(
                text("SELECT count(*) FROM litho_build_generation WHERE model_id = :m"),
                {"m": geotech_id},
            )
        ).scalar_one()
        print(f"  persisted GEOTECH build generations: {geotech_gen}")

        # --- sections -----------------------------------------------------
        section_rows = (
            await session.execute(
                text(
                    "SELECT id::text, name, start_x, start_y, end_x, end_y, "
                    "projection_buffer_m, excluded_cpt_ids, excluded_borehole_ids "
                    "FROM cross_section WHERE app_project_id = :p "
                    "ORDER BY display_order, name"
                ),
                {"p": project_id},
            )
        ).all()

        out_sections: list[dict[str, Any]] = []
        for (
            sid,
            name,
            start_x,
            start_y,
            end_x,
            end_y,
            buffer_m,
            excluded_cpts,
            excluded_bhs,
        ) in section_rows:
            section = {
                "sectionId": sid,
                "name": name,
                "kind": _section_kind(name),
                "startX": float(start_x),
                "startY": float(start_y),
                "endX": float(end_x),
                "endY": float(end_y),
                "projectionBufferM": float(buffer_m),
                "excludedCptIds": [str(x) for x in (excluded_cpts or [])],
                "excludedBoreholeIds": [str(x) for x in (excluded_bhs or [])],
            }

            litho_columns, litho_along = _assemble_columns(section, investigations, litho_units)
            geo_columns, geo_along = _assemble_columns(section, investigations, geotech_units)

            # The LITHO arm at the top level, under the exact key names
            # scripts/diag_allsections_extract.py writes, so the harnesses
            # already written against diag_allsections_input.json read this
            # file with no changes.
            section["columns"] = litho_columns
            section["edges"] = await _edges(session, litho_id, sid)
            section["alongM"] = litho_along

            section["geotech"] = {
                "columns": geo_columns,
                "edges": await _edges(session, geotech_id, sid),
                "alongM": geo_along,
            }

            # The refinement bundle's maps are section-independent (they live in
            # one SectionsCanvas memo), so they are emitted once at the top
            # level. What IS section-scoped is which sub-bands the refinement
            # can reach: refineLithoPartition only ever looks up
            # columnOrder[colIx], and columnOrder is the LITHO column order, so
            # restricting the rows to those investigations is exactly
            # equivalent to passing the whole model's rows.
            litho_col_ids = [c["investigationId"] for c in litho_columns]
            section["refinement"] = {
                "geotechLayers": [
                    {
                        "id": u["layerId"],
                        "investigationId": inv_id,
                        "depth_top_m": u["topDepthM"],
                        "depth_base_m": u["baseDepthM"],
                        "formation_id": u["formationId"],
                        "body_id": u["bodyId"],
                    }
                    for inv_id in litho_col_ids
                    for u in geotech_units.get(inv_id, [])
                ]
            }

            # Anchor this section's LITHO columns against the persisted build.
            key = (
                round(float(start_x)),
                round(float(start_y)),
                round(float(end_x)),
                round(float(end_y)),
            )
            anchor_cols = anchor_sections.get(key)
            if anchor_cols is None:
                verdict = "no-payload-section"
            elif len(anchor_cols) != len(litho_columns):
                verdict = f"COUNT {len(anchor_cols)} vs {len(litho_columns)}"
            else:
                mismatches = [
                    i
                    for i, (built, mine) in enumerate(zip(anchor_cols, litho_columns))
                    if built["investigation_id"] != mine["investigationId"]
                    or abs(float(built["along_m"]) - litho_along[i]) > ANCHOR_TOL_M
                ]
                verdict = "match" if not mismatches else f"MISMATCH at {mismatches}"
            section["anchor"] = verdict
            out_sections.append(section)

    document = {
        "meta": {
            "generatedAt": datetime.now(UTC).isoformat(),
            "projectId": project_id,
            "lithoModelId": litho_id,
            "lithoModelName": litho_name,
            "geotechModelId": geotech_id,
            "geotechModelName": geotech_name,
            "lithoLayerStatusCounts": status_hist["litho"],
            "geotechLayerStatusCounts": status_hist["geotech"],
            "anchor": anchor_meta,
            "persistedGeotechBuildGenerations": geotech_gen,
        },
        "formationNames": formation_names,
        "refinementBundle": {
            "nadMeta": nad_meta,
            "lithoSoilByFormationId": litho_soil,
            "lithoFormationColorById": litho_color,
            "geotechFormationColorById": geotech_color,
        },
        "bodyBoundaries": boundaries,
        "investigations": investigations,
        "sections": out_sections,
    }
    OUT.write_text(json.dumps(document, indent=1), encoding="utf-8")

    header = (
        f"{'section':<18}{'kind':<7}{'L cols':>7}{'L units':>8}{'L edges':>8}"
        f"{'G cols':>8}{'G units':>8}{'G edges':>8}  anchor"
    )
    print("\n" + header)
    print("  " + "-" * (len(header) + 2))
    for sec in out_sections:
        print(
            f"  {sec['name']:<18}{sec['kind']:<7}"
            f"{len(sec['columns']):>7}"
            f"{sum(len(c['units']) for c in sec['columns']):>8}"
            f"{len(sec['edges']):>8}"
            f"{len(sec['geotech']['columns']):>8}"
            f"{sum(len(c['units']) for c in sec['geotech']['columns']):>8}"
            f"{len(sec['geotech']['edges']):>8}"
            f"  {sec['anchor']}"
        )
    print(
        f"\n  totals: {len(out_sections)} sections | "
        f"litho {sum(len(s['columns']) for s in out_sections)} cols / "
        f"{sum(len(c['units']) for s in out_sections for c in s['columns'])} units / "
        f"{sum(len(s['edges']) for s in out_sections)} edges | "
        f"geotech {sum(len(s['geotech']['columns']) for s in out_sections)} cols / "
        f"{sum(len(c['units']) for s in out_sections for c in s['geotech']['columns'])} units / "
        f"{sum(len(s['geotech']['edges']) for s in out_sections)} edges"
    )
    print(f"\n  wrote {OUT}  ({OUT.stat().st_size / 1024:.1f} KiB)")


if __name__ == "__main__":
    asyncio.run(main())

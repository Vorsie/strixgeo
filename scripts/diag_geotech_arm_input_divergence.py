"""Classify WHY the geotech render arm and the geotech build arm diverge.

``desktop/.../utils/geotechEngineAgreement.diag.test.ts`` measures HOW MUCH the
two geotech-axis geometries disagree (area of the section plane where the two
assign a different NAD packing class). It does not say WHY. This script answers
the why on the INPUT side, before any engine runs, because the two arms are fed
different column sets, different correlation edges and different layer stacks::

    RENDER arm : computeSectionFill(LITHO columns, LITHO edges) refined by the
                 geotech sub-bands  ->  litho boundaries invariant
    BUILD  arm : computeSectionFill(GEOTECH columns, GEOTECH edges)
                 ->  a free re-partition of the geotech layers

It reads ONLY ``scripts/throwaway_geotech_axis_inputs.json`` (produced by
``scripts/dump_geotech_axis_inputs.py``, read-only against the dev DB), so it
touches no database itself and is safe to re-run at any time.

Four questions, each answered with counts and worst-case metres:

1. COLUMN SETS — which litho columns are missing from the build arm, and does
   each missing column have geotech sub-bands anywhere in the model? A column
   that HAS bands but is absent from the build arm would be an assembly defect;
   a column with none is an undivided borehole (a build-order fact, see
   ``docs/design/geotech-stage.md`` section 6).
2. PER-COLUMN STACKS — do the geotech bands of a column reproduce that column's
   litho units exactly (each band nested in one litho unit, the bands of a unit
   tiling it)? If they do, the two arms agree AT the columns and every
   divergence is interpolation BETWEEN them.
3. EDGES — how many litho correlations have no geotech counterpart tying the
   same investigation pair at the same contact elevation? Those are the ties the
   render arm inherits and the build arm does not have, so a band on screen can
   be a lens in the payload.
4. DEPTH REACH — how far below the deepest geotech sub-band does each column's
   litho stack continue? That is the depth range where the render can only draw
   plain lithology (``tag='fallback'``) while the build extrapolates a class.

Run: ``uv run python scripts/diag_geotech_arm_input_divergence.py``
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parents[1]
INPUT = _REPO_ROOT / "scripts" / "throwaway_geotech_axis_inputs.json"

# Two depths are the same depth when they agree to a millimetre: the no-overlap
# constraint rounds persisted depths to mm (memory
# ``project_litho_layer_min_thickness_500``), so anything finer is float noise.
DEPTH_TOL_M = 0.0015


def _load() -> dict[str, Any]:
    """Load the dumped input file, or exit with the regeneration command.

    Returns
    -------
    dict
        The parsed dump.

    Raises
    ------
    SystemExit
        When the dump is absent.
    """
    if not INPUT.exists():
        raise SystemExit(
            f"ABORT: {INPUT} not found — run "
            f"'uv run python scripts/dump_geotech_axis_inputs.py' first."
        )
    return json.loads(INPUT.read_text(encoding="utf8"))


def _stack(units: list[dict[str, Any]]) -> list[tuple[float, float, str]]:
    """Sort a unit list shallow-to-deep as ``(top, base, formation_id)`` tuples.

    Parameters
    ----------
    units : list of dict
        Raw units carrying ``topDepthM`` / ``baseDepthM`` / ``formationId``.

    Returns
    -------
    list of tuple
        ``(top_depth_m, base_depth_m, formation_id)``, shallow first.
    """
    return sorted(
        ((u["topDepthM"], u["baseDepthM"], u["formationId"]) for u in units),
        key=lambda t: t[0],
    )


def main() -> None:
    """Run all four classifications and print the report."""
    raw = _load()
    sections = raw["sections"]
    nad_meta = raw["refinementBundle"]["nadMeta"]
    litho_soil = raw["refinementBundle"]["lithoSoilByFormationId"]

    print("=" * 96)
    print("GEOTECH ARM INPUT DIVERGENCE — why the two arms can disagree at all")
    print("=" * 96)
    print(f"  input        {INPUT}")
    print(f"  generated    {raw['meta']['generatedAt']}")
    print(f"  litho model  {raw['meta']['lithoModelId']}")
    print(f"  geotech      {raw['meta']['geotechModelId']}")
    print("")

    # ---- 1. Column sets ---------------------------------------------------
    print("-" * 96)
    print("1. COLUMN SETS — litho columns the build arm never sees")
    print("-" * 96)
    print(
        "  section            Lcol Gcol  missing  of which have NO geotech band  "
        "have bands (DEFECT)"
    )
    total_missing = 0
    total_missing_no_bands = 0
    total_missing_with_bands = 0
    defect_rows: list[str] = []
    for sec in sections:
        litho_ids = [c["investigationId"] for c in sec["columns"]]
        geo_ids = {c["investigationId"] for c in sec["geotech"]["columns"]}
        # Geotech sub-bands PRESENT for this investigation anywhere in the model,
        # as the refinement bundle sees them (the render arm's own input).
        banded: set[str] = {
            layer["investigationId"] for layer in sec["refinement"]["geotechLayers"]
        }
        missing = [i for i in litho_ids if i not in geo_ids]
        no_bands = [i for i in missing if i not in banded]
        with_bands = [i for i in missing if i in banded]
        total_missing += len(missing)
        total_missing_no_bands += len(no_bands)
        total_missing_with_bands += len(with_bands)
        for inv in with_bands:
            defect_rows.append(f"    {sec['name']}: {inv} has geotech bands but no build column")
        print(
            f"  {sec['name']:<18} {len(litho_ids):>4} {len(sec['geotech']['columns']):>4} "
            f"{len(missing):>8} {len(no_bands):>29} {len(with_bands):>19}"
        )
    print("  " + "-" * 94)
    print(
        f"  TOTAL                        {total_missing:>8} "
        f"{total_missing_no_bands:>29} {total_missing_with_bands:>19}"
    )
    for row in defect_rows:
        print(row)
    dropped = [s["name"] for s in sections if len(s["geotech"]["columns"]) < 2]
    print(
        f"  sections the build DROPS ENTIRELY (fewer than 2 geotech columns): "
        f"{len(dropped)} — {', '.join(dropped) if dropped else 'none'}"
    )
    print("")

    # ---- 2. Per-column stacks --------------------------------------------
    print("-" * 96)
    print("2. PER-COLUMN STACKS — do the geotech bands reproduce the litho units?")
    print("-" * 96)
    checked = 0
    straddlers = 0
    worst_straddle = 0.0
    uncovered_units = 0
    uncovered_m = 0.0
    covered_units = 0
    worst_edge_offset = 0.0
    seen_inv: set[str] = set()
    for sec in sections:
        geo_by_inv: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for layer in sec["refinement"]["geotechLayers"]:
            geo_by_inv[layer["investigationId"]].append(
                {
                    "topDepthM": layer["depth_top_m"],
                    "baseDepthM": layer["depth_base_m"],
                    "formationId": layer["formation_id"],
                }
            )
        for col in sec["columns"]:
            inv = col["investigationId"]
            if inv in seen_inv:
                continue  # one investigation is enough; sections repeat columns
            seen_inv.add(inv)
            lstack = _stack(col["units"])
            gstack = _stack(geo_by_inv.get(inv, []))
            if not lstack or not gstack:
                continue
            checked += 1
            for gtop, gbase, _fid in gstack:
                # Nesting: the band must sit inside exactly one litho unit.
                host = [
                    (lt, lb)
                    for (lt, lb, _lf) in lstack
                    if gtop >= lt - DEPTH_TOL_M and gbase <= lb + DEPTH_TOL_M
                ]
                if not host:
                    straddlers += 1
                    # How far the band reaches past the nearest unit boundary.
                    over = min(
                        max(lt - gtop, gbase - lb)
                        for (lt, lb, _lf) in lstack
                        if not (gbase <= lt or gtop >= lb)
                    )
                    worst_straddle = max(worst_straddle, over)
            for lt, lb, _lf in lstack:
                inside = [
                    (gt, gb)
                    for (gt, gb, _gf) in gstack
                    if gt >= lt - DEPTH_TOL_M and gb <= lb + DEPTH_TOL_M
                ]
                if not inside:
                    uncovered_units += 1
                    uncovered_m += lb - lt
                    continue
                covered_units += 1
                worst_edge_offset = max(
                    worst_edge_offset,
                    abs(min(g[0] for g in inside) - lt),
                    abs(max(g[1] for g in inside) - lb),
                )
    print(f"  investigations with both stacks           {checked}")
    print(
        f"  geotech bands straddling a litho contact  {straddlers} (worst {worst_straddle:.4f} m)"
    )
    print(f"  litho units WITH geotech bands            {covered_units}")
    print(
        f"  litho units with NO geotech band          {uncovered_units} "
        f"({uncovered_m:.2f} m of column length)"
    )
    print(
        f"  worst offset between a litho unit boundary and its outermost band "
        f"{worst_edge_offset:.4f} m"
    )
    print("")

    # ---- 3. Edges ---------------------------------------------------------
    print("-" * 96)
    print("3. EDGES — litho ties with no geotech counterpart at the same contact")
    print("-" * 96)
    print("  section            Ledge Gedge  litho ties w/o geotech tie   geotech ties w/o litho")
    tot_l = tot_g = tot_l_orphan = tot_g_orphan = 0
    tot_l_orphan_both = 0
    for sec in sections:
        # layer id -> (investigation, elevation of each side)
        def _index(cols: list[dict[str, Any]]) -> dict[str, tuple[str, float, float]]:
            """Map every layer id to its (investigation, top elev, base elev)."""
            out: dict[str, tuple[str, float, float]] = {}
            for c in cols:
                surf = c["surfaceElevM"]
                if surf is None:
                    continue
                for u in c["units"]:
                    out[u["layerId"]] = (
                        c["investigationId"],
                        surf - u["topDepthM"],
                        surf - u["baseDepthM"],
                    )
            return out

        lidx = _index(sec["columns"])
        gidx = _index(sec["geotech"]["columns"])

        def _key(edge: dict[str, Any], idx: dict[str, tuple[str, float, float]]) -> tuple | None:
            """Identity of one tie: the two ends it joins, arm-independent."""
            a = idx.get(edge["a"])
            b = idx.get(edge["b"])
            if a is None or b is None:
                return None
            ea = a[1] if edge.get("aSide", "top") == "top" else a[2]
            eb = b[1] if edge.get("bSide", "top") == "top" else b[2]
            # Unordered investigation pair + both contact elevations, mm-rounded.
            ends = sorted([(a[0], round(ea, 3)), (b[0], round(eb, 3))])
            return (ends[0], ends[1])

        lkeys = {k for k in (_key(e, lidx) for e in sec["edges"]) if k is not None}
        gkeys = {k for k in (_key(e, gidx) for e in sec["geotech"]["edges"]) if k is not None}
        l_orphan = len(lkeys - gkeys)
        g_orphan = len(gkeys - lkeys)
        # A litho tie whose endpoints are BOTH on columns the build arm has is a
        # tie genuinely lost in translation; one touching a column the build arm
        # never sees (an undivided borehole) is a build-order consequence.
        build_invs = {c["investigationId"] for c in sec["geotech"]["columns"]}
        both_present = sum(
            1 for k in (lkeys - gkeys) if k[0][0] in build_invs and k[1][0] in build_invs
        )
        tot_l_orphan_both += both_present
        tot_l += len(sec["edges"])
        tot_g += len(sec["geotech"]["edges"])
        tot_l_orphan += l_orphan
        tot_g_orphan += g_orphan
        print(
            f"  {sec['name']:<18} {len(sec['edges']):>5} {len(sec['geotech']['edges']):>5} "
            f"{l_orphan:>27} {g_orphan:>24}"
        )
    print("  " + "-" * 94)
    print(f"  TOTAL              {tot_l:>5} {tot_g:>5} {tot_l_orphan:>27} {tot_g_orphan:>24}")
    print(
        f"  of the {tot_l_orphan} litho ties with no geotech counterpart, {tot_l_orphan_both} join "
        f"two columns the build arm HAS (a tie lost in translation); the rest touch a column "
        f"the build never sees"
    )
    print("")

    # ---- 4. Depth reach ---------------------------------------------------
    print("-" * 96)
    print("4. DEPTH REACH — column length where litho exists and packing does not")
    print("-" * 96)
    below_total = 0.0
    below_cols = 0
    no_packing_cols = 0
    seen_inv.clear()
    for sec in sections:
        geo_by_inv: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for layer in sec["refinement"]["geotechLayers"]:
            geo_by_inv[layer["investigationId"]].append(
                {
                    "topDepthM": layer["depth_top_m"],
                    "baseDepthM": layer["depth_base_m"],
                    "formationId": layer["formation_id"],
                }
            )
        for col in sec["columns"]:
            inv = col["investigationId"]
            if inv in seen_inv:
                continue
            seen_inv.add(inv)
            lstack = _stack(col["units"])
            gstack = _stack(geo_by_inv.get(inv, []))
            if not lstack:
                continue
            if not gstack:
                no_packing_cols += 1
                continue
            deepest_l = max(u[1] for u in lstack)
            deepest_g = max(u[1] for u in gstack)
            if deepest_l - deepest_g > DEPTH_TOL_M:
                below_cols += 1
                below_total += deepest_l - deepest_g
    print(f"  columns with litho units but NO geotech band at all   {no_packing_cols}")
    print(
        f"  columns whose litho stack reaches deeper than packing  {below_cols} "
        f"(total {below_total:.2f} m, mean "
        f"{below_total / below_cols if below_cols else 0:.2f} m)"
    )

    # NAD-class coverage of the geotech formations, since a null class becomes
    # class -1 in the refinement and is a different failure from "no band".
    null_class = [f for f, m in nad_meta.items() if m.get("nadClass") is None]
    print(
        f"  geotech formations with a NULL nad_class              "
        f"{len(null_class)} of {len(nad_meta)}"
    )
    soils = sorted({v for v in litho_soil.values() if v})
    print(f"  litho soil codes in play                              {', '.join(soils)}")
    print("=" * 96)


if __name__ == "__main__":
    sys.exit(main())

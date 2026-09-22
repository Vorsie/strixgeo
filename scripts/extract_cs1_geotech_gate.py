"""Extract CS1 geotech data from the dev DB for the real-data gate.

Queries the dev DB for every investigation that projects onto Cross-section 1
(CS1) of ``test.strix`` and dumps their geotech band + sample data to
``scripts/cs1_geotech_gate.json``.  The gate test (``tests/gate_cs1_geotech.py``)
reads this file and asserts on the real-data geometry.

**Must be re-run after any code change and re-materialisation** — the JSON
snapshots the DB state at extraction time, not at test time.  Typical workflow::

    uv run python scripts/rematerialise_dev_geotech.py
    uv run python scripts/extract_cs1_geotech_gate.py
    CS1_GEOTECH_GATE=1 uv run pytest tests/gate_cs1_geotech.py -v

Output
------
``scripts/cs1_geotech_gate.json`` — gitignored; regenerated each time.

Constants
---------
LITHO_MODEL_ID : str
    Litho model whose geotech child model supplies the geotech bands.
GEOTECH_MODEL_ID : str
    Geotech child model id.
CS1_ID : str
    Cross-section 1 id (supplies the corridor geometry).
PROJECT_ID : str
    Owning project id.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

# ---------------------------------------------------------------------------
# Dev-DB constants (test.strix project on dev DB localhost:5433).
# ---------------------------------------------------------------------------
LITHO_MODEL_ID: str = "019e934c-70fd-7d11-a44a-b2073f4063a2"
GEOTECH_MODEL_ID: str = "019ef689-9a90-7a70-b0a9-97077c49a170"
CS1_ID: str = "019e9330-e333-7357-95ac-c0c93fa1e523"
PROJECT_ID: str = "019e932e-30bb-7967-8dee-e6a4f1b25378"

OUT = Path(__file__).parent / "cs1_geotech_gate.json"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def psql(sql: str) -> list[list[str]]:
    """Run a tab-separated, header-less psql query against the dev DB.

    Parameters
    ----------
    sql : str
        SQL query to execute.

    Returns
    -------
    list[list[str]]
        Rows as lists of tab-split string values.
    """
    res = subprocess.run(
        [
            "docker",
            "exec",
            "strix-db-1",
            "psql",
            "-U",
            "groundmodel",
            "-d",
            "groundmodel",
            "-tAF",
            "\t",
            "-c",
            sql,
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    rows = []
    for line in res.stdout.splitlines():
        if line.strip() == "":
            continue
        rows.append(line.split("\t"))
    return rows


# ---------------------------------------------------------------------------
# Step 1 — resolve CS1 corridor (perpendicular-distance filter).
# ---------------------------------------------------------------------------

cs1_meta = psql(
    f"SELECT start_x, start_y, end_x, end_y, projection_buffer_m "
    f"FROM cross_section WHERE id = '{CS1_ID}';"
)
sx, sy, ex, ey, buf = (float(v) for v in cs1_meta[0])
buf_m = buf

# All CPTs within the CS1 corridor.
cpt_rows = psql(
    f"""
    WITH line AS (
      SELECT
        {sx} AS sx, {sy} AS sy, {ex} AS ex, {ey} AS ey,
        {ex} - {sx} AS dx, {ey} - {sy} AS dy,
        ({ex} - {sx})^2 + ({ey} - {sy})^2 AS len2
    )
    SELECT c.id::text
    FROM cpt c, line l
    WHERE c.app_project_id = '{PROJECT_ID}'
      AND ABS((c.location_x - l.sx)*l.dy - (c.location_y - l.sy)*l.dx)
          / SQRT(l.len2) <= {buf_m};
    """
)
cpt_ids: list[str] = [r[0] for r in cpt_rows]

# All boreholes within the CS1 corridor.
bh_rows = psql(
    f"""
    WITH line AS (
      SELECT
        {sx} AS sx, {sy} AS sy, {ex} AS ex, {ey} AS ey,
        {ex} - {sx} AS dx, {ey} - {sy} AS dy,
        ({ex} - {sx})^2 + ({ey} - {sy})^2 AS len2
    )
    SELECT b.id::text
    FROM borehole b, line l
    WHERE b.app_project_id = '{PROJECT_ID}'
      AND ABS((b.location_x - l.sx)*l.dy - (b.location_y - l.sy)*l.dx)
          / SQRT(l.len2) <= {buf_m};
    """
)
bh_ids: list[str] = [r[0] for r in bh_rows]

print(f"CS1 corridor: {len(cpt_ids)} CPTs, {len(bh_ids)} boreholes")

# ---------------------------------------------------------------------------
# Step 2 — geotech bands per investigation.
# Query: litho_layer in the geotech model, joined to the geotech formation
# for nad_class and litho_main_soil_code.
# ---------------------------------------------------------------------------

all_inv_ids = cpt_ids + bh_ids
if not all_inv_ids:
    print("WARNING: no in-corridor investigations found — gate will be empty")
    bands_data: list[dict] = []
else:
    # Build the IN clause for all investigation ids.
    id_list = ", ".join(f"'{i}'" for i in all_inv_ids)
    band_sql = f"""
    SELECT
      ll.id::text AS layer_id,
      COALESCE(ll.cpt_id, ll.borehole_id)::text AS inv_id,
      CASE WHEN ll.cpt_id IS NOT NULL THEN 'cpt' ELSE 'borehole' END AS kind,
      ll.depth_top_m,
      ll.depth_base_m,
      gf.nad_class,
      gf.litho_main_soil_code,
      ll.body_id::text AS body_id
    FROM litho_layer ll
    JOIN geological_formation gf ON gf.id = ll.formation_id
    WHERE ll.model_id = '{GEOTECH_MODEL_ID}'
      AND (ll.cpt_id::text IN ({id_list}) OR ll.borehole_id::text IN ({id_list}))
    ORDER BY inv_id, ll.depth_top_m;
    """
    band_rows = psql(band_sql)
    bands_data = [
        {
            "layer_id": r[0],
            "inv_id": r[1],
            "kind": r[2],
            "depth_top_m": float(r[3]),
            "depth_base_m": float(r[4]),
            "nad_class": int(r[5]) if r[5] not in ("", "\\N") else None,
            "litho_main_soil_code": r[6] if r[6] not in ("", "\\N") else None,
            "body_id": r[7] if r[7] not in ("", "\\N") else None,
        }
        for r in band_rows
    ]

# ---------------------------------------------------------------------------
# Step 2b — qc coverage per CPT geotech band.
#
# ``suggest_geotech_subdivision`` answers ``nad_class=None`` when it cannot
# derive a class from qc: either the cone never read inside the band's interval,
# or the valid readings leave a material gap (>40% of the thickness, or a ≥5 cm
# continuous span).  The gate has to be able to tell a legitimate null-class band
# from a defect, so each CPT band carries the same three numbers the segmenter
# decided on, computed here with the segmenter's OWN helpers rather than a
# re-implementation in SQL.
# ---------------------------------------------------------------------------
from groundmodel.domain.services.geotech_subdivision import (  # noqa: E402
    _is_valid_qc,
    _missing_qc_coverage,
)


def _parse_pg_float_array(text: str) -> list[float | None]:
    """Parse a Postgres ``double precision[]`` literal into Python floats.

    Parameters
    ----------
    text : str
        The array as psql prints it, e.g. ``{0.02,1.5,NULL}``.

    Returns
    -------
    list[float | None]
        One entry per element; ``None`` for SQL NULL.
    """
    body = text.strip().strip("{}")
    if not body:
        return []
    out: list[float | None] = []
    for token in body.split(","):
        token = token.strip().strip('"')
        out.append(None if token.upper() == "NULL" else float(token))
    return out


cpt_series: dict[str, tuple[list[float], list[float | None]]] = {}
if cpt_ids:
    cpt_id_list = ", ".join(f"'{i}'" for i in cpt_ids)
    series_rows = psql(
        f"""
        SELECT cs.cpt_id::text, cs.depths_m::text, cs.qc_mpa::text
        FROM cpt_series cs
        WHERE cs.cpt_id::text IN ({cpt_id_list});
        """
    )
    for row in series_rows:
        depths = [d for d in _parse_pg_float_array(row[1]) if d is not None]
        qc = _parse_pg_float_array(row[2])
        cpt_series[row[0]] = (depths, qc)

print(f"Loaded qc series for {len(cpt_series)}/{len(cpt_ids)} corridor CPTs")

for band in bands_data:
    if band["kind"] != "cpt":
        continue
    depths, qc = cpt_series.get(band["inv_id"], ([], []))
    top, base = band["depth_top_m"], band["depth_base_m"]
    in_range = [(d, q) for d, q in zip(depths, qc) if top - 1e-9 <= d <= base + 1e-9]
    missing_fraction, max_gap_m = (
        _missing_qc_coverage(in_range, top, base) if in_range else (1.0, max(base - top, 0.0))
    )
    band["qc_samples_in_band"] = len(in_range)
    band["qc_valid_samples_in_band"] = sum(1 for _d, q in in_range if _is_valid_qc(q))
    band["qc_missing_fraction"] = missing_fraction
    band["qc_max_gap_m"] = max_gap_m
    band["has_series"] = band["inv_id"] in cpt_series


# ---------------------------------------------------------------------------
# Step 3 — litho bands per borehole (for the sample-contradiction check).
# Query: litho_layer in the LITHO model (not geotech) for each corridor borehole.
# ---------------------------------------------------------------------------
litho_bh_bands_data: list[dict] = []
if bh_ids:
    bh_id_list = ", ".join(f"'{i}'" for i in bh_ids)
    litho_bh_sql = f"""
    SELECT
      ll.borehole_id::text AS bh_id,
      ll.depth_top_m,
      ll.depth_base_m,
      gf.litho_main_soil_code
    FROM litho_layer ll
    JOIN geological_formation gf ON gf.id = ll.formation_id
    WHERE ll.model_id = '{LITHO_MODEL_ID}'
      AND ll.borehole_id::text IN ({bh_id_list})
      AND ll.status = 'accepted'
    ORDER BY bh_id, ll.depth_top_m;
    """
    litho_bh_rows = psql(litho_bh_sql)
    litho_bh_bands_data = [
        {
            "bh_id": r[0],
            "depth_top_m": float(r[1]),
            "depth_base_m": float(r[2]),
            "litho_main_soil_code": r[3] if r[3] not in ("", "\\N") else None,
        }
        for r in litho_bh_rows
    ]

# ---------------------------------------------------------------------------
# Step 4 — sample geotech assignments for corridor boreholes.
# ---------------------------------------------------------------------------
samples_data: list[dict] = []
if bh_ids:
    bh_id_list = ", ".join(f"'{i}'" for i in bh_ids)
    sample_sql = f"""
    SELECT
      s.id::text,
      s.borehole_id::text,
      s.depth_top_m,
      s.depth_base_m,
      s.geotech_body_id::text,
      s.geotech_nad_class,
      s.geotech_assignment_source
    FROM sample s
    WHERE s.borehole_id::text IN ({bh_id_list})
    ORDER BY s.borehole_id, s.depth_top_m;
    """
    sample_rows = psql(sample_sql)
    samples_data = [
        {
            "id": r[0],
            "borehole_id": r[1],
            "depth_top_m": float(r[2]),
            "depth_base_m": float(r[3]),
            "geotech_body_id": r[4] if r[4] not in ("", "\\N") else None,
            "geotech_nad_class": int(r[5]) if r[5] not in ("", "\\N") else None,
            "geotech_assignment_source": r[6] if r[6] not in ("", "\\N") else None,
        }
        for r in sample_rows
    ]

# ---------------------------------------------------------------------------
# Write JSON.
# ---------------------------------------------------------------------------
out = {
    "meta": {
        "cs1_id": CS1_ID,
        "litho_model_id": LITHO_MODEL_ID,
        "geotech_model_id": GEOTECH_MODEL_ID,
        "project_id": PROJECT_ID,
        "cpt_count": len(cpt_ids),
        "borehole_count": len(bh_ids),
    },
    "bands": bands_data,
    "litho_bh_bands": litho_bh_bands_data,
    "samples": samples_data,
}
OUT.write_text(json.dumps(out, indent=1))

# ---------------------------------------------------------------------------
# Quick summary.
# ---------------------------------------------------------------------------
cpt_bands = [b for b in bands_data if b["kind"] == "cpt"]
bh_bands = [b for b in bands_data if b["kind"] == "borehole"]
null_cpt = [b for b in cpt_bands if b["nad_class"] is None]
null_bh = [b for b in bh_bands if b["nad_class"] is None]

print(
    f"Bands: {len(cpt_bands)} CPT ({len(null_cpt)} null-class), "
    f"{len(bh_bands)} borehole ({len(null_bh)} null-class)"
)
print(f"Litho borehole layers: {len(litho_bh_bands_data)}")
print(f"Samples: {len(samples_data)}")
unassigned = [s for s in samples_data if s["geotech_assignment_source"] is None]
unresolved = [s for s in samples_data if s["geotech_assignment_source"] == "unresolved"]
print(f"  unassigned={len(unassigned)}, unresolved={len(unresolved)}")
print(f"Written to {OUT}")

"""Extract CS1's computeSectionFill INPUT from the dev DB.

Reconstructs the partition input for Cross-section 1 (model 019e934c…) into a
JSON the CS1 gate harness (``partitionFillV2.cs1gates.diag.test.ts``) feeds to
computeSectionFill. A diagnostics tool, not production code.
Run: ``uv run python scripts/extract_cs1_partition_input.py``
"""

import json
import subprocess

MODEL_ID = "019e934c-70fd-7d11-a44a-b2073f4063a2"
CS1_ID = "019e9330-e333-7357-95ac-c0c93fa1e523"
FIXTURE = "tests/fixtures/voxel/teststrix_partitions.json"
OUT = "scripts/throwaway_cs1_input.json"


def psql(sql: str) -> list[list[str]]:
    """Run a tab-separated, header-less psql query against the dev DB."""
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


# CS1 column ORDER (the 24 investigation ids in along-section order).
fixture = json.load(open(FIXTURE))
cs1 = fixture["sections"][12]
order = [c["investigation_id"] for c in cs1["columns"]]

# Surface elevations for every investigation (cpt + borehole).
elev: dict[str, float] = {}
for row in psql("SELECT id::text, elevation_m FROM cpt WHERE elevation_m IS NOT NULL;"):
    elev[row[0]] = float(row[1])
for row in psql("SELECT id::text, elevation_m FROM borehole WHERE elevation_m IS NOT NULL;"):
    elev[row[0]] = float(row[1])

# Investigation names (the cs1sandbody gate locates B2 by name).
names: dict[str, str] = {}
for row in psql("SELECT id::text, name FROM cpt WHERE name IS NOT NULL;"):
    names[row[0]] = row[1]
for row in psql("SELECT id::text, name FROM borehole WHERE name IS NOT NULL;"):
    names[row[0]] = row[1]

# Accepted litho layers for the model, keyed by investigation (cpt OR borehole).
layers_sql = f"""
SELECT id::text, COALESCE(cpt_id, borehole_id)::text AS inv,
       depth_top_m, depth_base_m, formation_id::text, body_id::text
FROM litho_layer
WHERE model_id = '{MODEL_ID}' AND status = 'accepted'
ORDER BY COALESCE(cpt_id, borehole_id), depth_top_m;
"""
layers_by_inv: dict[str, list[dict]] = {}
for row in psql(layers_sql):
    lid, inv, top, base, fid, bid = row
    layers_by_inv.setdefault(inv, []).append(
        {
            "layerId": lid,
            "topDepthM": float(top),
            "baseDepthM": float(base),
            "formationId": fid,
            "bodyId": None if bid == "" else bid,
        }
    )

# Approved correlation edges scoped to CS1's section_id (matches the overlay,
# which receives section-scoped contactEdges and filters user_approved).
edges_sql = f"""
SELECT layer_a_id::text, layer_b_id::text, layer_a_side, layer_b_side
FROM litho_contact_correlation_edge
WHERE model_id = '{MODEL_ID}' AND user_approved = true AND section_id = '{CS1_ID}';
"""
edges = []
for row in psql(edges_sql):
    a, b, aside, bside = row
    edges.append({"a": a, "b": b, "aSide": aside, "bSide": bside})

# Build the columns array in CS1 along-section order. Skip investigations with no
# accepted layers (computeSectionFill drops empty columns anyway).
columns = []
for inv in order:
    units = layers_by_inv.get(inv, [])
    columns.append(
        {
            "investigationId": inv,
            "surfaceElevM": elev.get(inv),
            "units": units,
            "name": names.get(inv),
        }
    )

# Real along-section metres — offline runs MUST thread these (uniform-spacing
# fallback diverges on the deep-to-deep substrate).
along = [c["along_m"] for c in cs1["columns"]]

out = {"columns": columns, "edges": edges, "order": order, "along": along}
json.dump(out, open(OUT, "w"), indent=1)

# Report a quick inventory.
n_units = sum(len(c["units"]) for c in columns)
n_nonempty = sum(1 for c in columns if c["units"])
print(f"columns={len(columns)} nonempty={n_nonempty} units={n_units} edges={len(edges)}")
missing_elev = [c["investigationId"] for c in columns if c["surfaceElevM"] is None]
print(f"missing_elev={missing_elev}")

# Landmark detail.
landmarks = {
    "019e932e-9668-7a79-b38d-338b41a2eb55": "B2 (borehole, col16)",
    "019e932e-7c50-777b-a72f-040217e7e28f": "S7a (cpt, col17)",
    "019e932e-7c4e-7413-8e00-00a99e80f0ac": "S6 (cpt, col19)",
    "019e932e-7c4c-736a-a206-b7baf1986ffc": "S5a (cpt, col20)",
}
ZAND = "019e940a-4b41-7e01-a763-ab030a38d1bc"
for inv, label in landmarks.items():
    units = layers_by_inv.get(inv, [])
    surf = elev.get(inv)
    td_depth = max((u["baseDepthM"] for u in units), default=None)
    print(
        f"\n{label}  surf={surf}  TD_elev={None if td_depth is None else round(surf - td_depth, 2)}  n_units={len(units)}"
    )
    for u in units:
        zflag = " <ZAND>" if u["formationId"] == ZAND else ""
        print(
            f"   top {round(surf - u['topDepthM'], 2):+.2f} .. base {round(surf - u['baseDepthM'], 2):+.2f}"
            f"  (d {u['topDepthM']}-{u['baseDepthM']})  body={(u['bodyId'] or 'null')[:8]}{zflag}"
        )

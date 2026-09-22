"""THROWAWAY DIAG — extract EVERY section's computeSectionFill INPUT from the dev DB.

Generalises ``extract_cs1_partition_input.py`` across all sections of the
litho model so the all-sections tie-straddle diagnostic can hunt the owner's
"lithology spilling over a correlation band" report. Not production code.
Run: ``uv run python scripts/diag_allsections_extract.py``
"""

import json
import subprocess

MODEL_ID = "019e934c-70fd-7d11-a44a-b2073f4063a2"
FIXTURE = "tests/fixtures/voxel/teststrix_partitions.json"
OUT = "scripts/diag_allsections_input.json"


def psql(sql: str) -> list[list[str]]:
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
    return [line.split("\t") for line in res.stdout.splitlines() if line.strip()]


fixture = json.load(open(FIXTURE))

# DB sections for the model's project, matched to fixture entries by coords.
proj_rows = psql(f"SELECT app_project_id::text FROM geological_model WHERE id = '{MODEL_ID}';")
project_id = proj_rows[0][0]
db_sections = psql(
    f"SELECT id::text, name, start_x, start_y, end_x, end_y "
    f"FROM cross_section WHERE app_project_id = '{project_id}';"
)


def match_section(sec: dict) -> tuple[str, str] | None:
    for sid, name, sx, sy, ex, ey in db_sections:
        if (
            abs(float(sx) - sec["start_x"]) < 0.01
            and abs(float(sy) - sec["start_y"]) < 0.01
            and abs(float(ex) - sec["end_x"]) < 0.01
            and abs(float(ey) - sec["end_y"]) < 0.01
        ):
            return sid, name
    return None


elev: dict[str, float] = {}
for row in psql("SELECT id::text, elevation_m FROM cpt WHERE elevation_m IS NOT NULL;"):
    elev[row[0]] = float(row[1])
for row in psql("SELECT id::text, elevation_m FROM borehole WHERE elevation_m IS NOT NULL;"):
    elev[row[0]] = float(row[1])

layers_by_inv: dict[str, list[dict]] = {}
for row in psql(
    f"SELECT id::text, COALESCE(cpt_id, borehole_id)::text, depth_top_m, depth_base_m, "
    f"formation_id::text, body_id::text FROM litho_layer "
    f"WHERE model_id = '{MODEL_ID}' AND status = 'accepted' "
    f"ORDER BY COALESCE(cpt_id, borehole_id), depth_top_m;"
):
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

# Formation names for readable reports.
formation_names = {
    row[0]: row[1]
    for row in psql(
        f"SELECT id::text, name FROM geological_formation WHERE app_project_id = '{project_id}';"
    )
}

out_sections = []
for sec in fixture["sections"]:
    m = match_section(sec)
    if m is None:
        print(
            f"!! no DB section matches fixture coords ({sec['start_x']:.0f},{sec['start_y']:.0f})"
        )
        continue
    sid, name = m
    edges = [
        {"a": r[0], "b": r[1], "aSide": r[2], "bSide": r[3], "source": r[4]}
        for r in psql(
            f"SELECT layer_a_id::text, layer_b_id::text, layer_a_side, layer_b_side, source "
            f"FROM litho_contact_correlation_edge "
            f"WHERE model_id = '{MODEL_ID}' AND user_approved = true AND section_id = '{sid}';"
        )
    ]
    columns = []
    along = []
    for c in sec["columns"]:
        inv = c["investigation_id"]
        columns.append(
            {
                "investigationId": inv,
                "surfaceElevM": elev.get(inv),
                "units": layers_by_inv.get(inv, []),
            }
        )
        along.append(c["along_m"])
    out_sections.append(
        {"sectionId": sid, "name": name, "columns": columns, "edges": edges, "alongM": along}
    )
    n_units = sum(len(c["units"]) for c in columns)
    print(f"{name}: cols={len(columns)} units={n_units} edges={len(edges)}")

json.dump(
    {"sections": out_sections, "formationNames": formation_names},
    open(OUT, "w"),
    indent=1,
)
print(f"\nwrote {OUT}: {len(out_sections)} section(s)")

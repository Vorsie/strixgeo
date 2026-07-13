"""THROWAWAY DIAG — same-lithology lens-in-matrix bodies (owner report).

Hunts the signature: a small body A (formation F) on column i whose elevation
span is COVERED by a bigger body B (same formation F) present on an adjacent
column, where A has no approved edge into B. The fill classifies A as an
enclosed lens inside its own lithology; geotech Subdivide then treats A and B
as separate bodies (owner: "a sand lens in the sand matrix was subdivided
separately").
Run: uv run python scripts/diag_samelitho_lens_bodies.py
"""

import json
import subprocess

data = json.load(open("scripts/diag_allsections_input.json"))
fnames = data["formationNames"]


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


inv_names = {r[0]: r[1] for r in psql("SELECT id::text, name FROM cpt")}
inv_names.update({r[0]: r[1] for r in psql("SELECT id::text, name FROM borehole")})

# geotech bands per parent body: proves which bodies Subdivide split separately
geo_bands = {}
for bid, n in psql(
    "SELECT l.body_id::text, count(*) FROM litho_layer l "
    "WHERE l.model_id='019ef689-9a90-7a70-b0a9-97077c49a170' AND l.body_id IS NOT NULL "
    "GROUP BY 1;"
):
    geo_bands[bid] = int(n)

hits = []
seen = set()
for sec in data["sections"]:
    cols = [c for c in sec["columns"] if c["units"] and c["surfaceElevM"] is not None]
    for i, col in enumerate(cols):
        for u in col["units"]:
            if u["bodyId"] is None:
                continue
            t = col["surfaceElevM"] - u["topDepthM"]
            b = col["surfaceElevM"] - u["baseDepthM"]
            for j in (i - 1, i + 1):
                if not (0 <= j < len(cols)):
                    continue
                nb = cols[j]
                for v in nb["units"]:
                    if v["formationId"] != u["formationId"]:
                        continue
                    if v["bodyId"] is None or v["bodyId"] == u["bodyId"]:
                        continue
                    vt = nb["surfaceElevM"] - v["topDepthM"]
                    vb = nb["surfaceElevM"] - v["baseDepthM"]
                    # B covers A entirely -> A reads as enclosed in B's matrix
                    if vt >= t - 0.01 and vb <= b + 0.01:
                        key = (u["layerId"], v["layerId"])
                        if key in seen:
                            continue
                        seen.add(key)
                        hits.append(
                            f"{sec['name']}: {fnames.get(u['formationId'], '?')} "
                            f"lens-candidate {inv_names.get(col['investigationId'], '?')}"
                            f"({t:+.2f}..{b:+.2f}, body {str(u['bodyId'])[:8]}, "
                            f"geotech-bands={geo_bands.get(u['bodyId'], 0)}) enclosed by "
                            f"{inv_names.get(nb['investigationId'], '?')}({vt:+.2f}..{vb:+.2f}, "
                            f"body {str(v['bodyId'])[:8]}, geotech-bands={geo_bands.get(v['bodyId'], 0)})"
                        )

print(f"same-litho enclosed-body candidates: {len(hits)}")
for h in hits:
    print(" ", h)

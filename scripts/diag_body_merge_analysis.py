"""THROWAWAY DIAG — why don't adjacent same-lithology layers share a body?

For every section in scripts/diag_allsections_input.json: every adjacent
column pair, every same-formation unit pair whose ELEVATION ranges overlap.
Classify:
  EDGE+SAMEBODY  — correlated and merged (healthy)
  EDGE+DIFFBODY  — an approved edge exists but bodies differ → resolve bug/stale
  NOEDGE+SAMEBODY — merged via another section's edges (healthy, union semantics)
  NOEDGE+DIFFBODY — not correlated anywhere → separate bodies BY DESIGN
Run: uv run python scripts/diag_body_merge_analysis.py
"""

import json
import subprocess
from collections import Counter

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

# ALL approved edges model-wide (body resolve unions across sections).
all_edges = set()
for a, b, *_ in psql(
    "SELECT layer_a_id::text, layer_b_id::text FROM litho_contact_correlation_edge "
    "WHERE model_id='019e934c-70fd-7d11-a44a-b2073f4063a2' AND user_approved=true;"
):
    all_edges.add((a, b))
    all_edges.add((b, a))

counts: Counter = Counter()
examples: dict[str, list[str]] = {"EDGE+DIFFBODY": [], "NOEDGE+DIFFBODY": []}
pair_seen = set()  # dedupe layer pairs appearing on multiple sections

for sec in data["sections"]:
    cols = [c for c in sec["columns"] if c["units"] and c["surfaceElevM"] is not None]
    for i in range(len(cols) - 1):
        a, b = cols[i], cols[i + 1]
        for ua in a["units"]:
            ta = a["surfaceElevM"] - ua["topDepthM"]
            ba = a["surfaceElevM"] - ua["baseDepthM"]
            for ub in b["units"]:
                if ub["formationId"] != ua["formationId"]:
                    continue
                tb = b["surfaceElevM"] - ub["topDepthM"]
                bb = b["surfaceElevM"] - ub["baseDepthM"]
                overlap = min(ta, tb) - max(ba, bb)
                if overlap <= 0.0:
                    continue
                key = tuple(sorted((ua["layerId"], ub["layerId"])))
                if key in pair_seen:
                    continue
                pair_seen.add(key)
                has_edge = (ua["layerId"], ub["layerId"]) in all_edges
                same_body = ua["bodyId"] is not None and ua["bodyId"] == ub["bodyId"]
                cls = ("EDGE+" if has_edge else "NOEDGE+") + (
                    "SAMEBODY" if same_body else "DIFFBODY"
                )
                code = fnames.get(ua["formationId"], "?")
                counts[cls + " " + code] += 1
                counts[cls] += 1
                if cls in examples and len(examples[cls]) < 12:
                    examples[cls].append(
                        f"{sec['name']}: {inv_names.get(a['investigationId'], '?')}"
                        f"({ta:+.2f}..{ba:+.2f}) ~ {inv_names.get(b['investigationId'], '?')}"
                        f"({tb:+.2f}..{bb:+.2f}) {code} overlap={overlap:.2f}m "
                        f"bodies={str(ua['bodyId'])[:8]}/{str(ub['bodyId'])[:8]}"
                    )

print("=== classification counts (deduped layer pairs) ===")
for k in sorted(counts):
    print(f"{counts[k]:5d}  {k}")
print("\n=== EDGE but DIFFERENT body (resolve bug/stale candidates) ===")
for e in examples["EDGE+DIFFBODY"]:
    print(" ", e)
print("\n=== NO edge, different body (uncorrelated by design) — samples ===")
for e in examples["NOEDGE+DIFFBODY"]:
    print(" ", e)

"""READ-ONLY predictor: what does a pipeline step-2 re-run add under the
2026-08-13 derivation rules, and what does the geotech fill's litho-consistency
become with those edges in place?

Mirrors ``derive_geotech_edges_from_litho``'s ACCEPTED emissions only (the
forced-topmost restatement + the base↔base bottom-tie restatement) — pending
proposals never enter the fill, so they cannot move the consistency number.
The alignment rule is imported from the real module, not re-implemented.

Inputs
------
* ``scripts/throwaway_geotech_axis_inputs.json`` — the read-only dev-DB dump
  (``uv run python scripts/dump_geotech_axis_inputs.py``). Carries the
  approved litho edges WITH sides, the litho unit windows, the geotech bands
  and the approved geotech edges per section.
* The dev DB, one read-only SELECT: ALL persisted geotech edge pairs (any
  approval state) so the dedup matches the real derivation exactly.

Output
------
* ``scripts/throwaway_geotech_axis_inputs_predicted.json`` — a copy of the
  dump with the predicted accepted edges appended per section, consumable by
  the litho-consistency gate via ``GEOTECH_AXIS_INPUT``.
* A per-section summary of what a re-run would add.

Run: ``uv run python scripts/diag_predict_restatement_rerun.py``
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sqlalchemy import text  # noqa: E402

from groundmodel.domain.services.geotech_packing_edges import (  # noqa: E402
    aligned_pairs_with_forced_top,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402

DUMP = _REPO_ROOT / "scripts" / "throwaway_geotech_axis_inputs.json"
OUT = _REPO_ROOT / "scripts" / "throwaway_geotech_axis_inputs_predicted.json"

# Mirror of geotech_edge_derivation._DEPTH_TOL_M.
_DEPTH_TOL_M = 0.001


async def _load_existing_pairs(geotech_model_id: str) -> dict[str, set[tuple[str, str]]]:
    """All persisted geotech edge pairs by section (any approval), read-only."""
    async with AsyncSessionFactory() as session:
        rows = (
            await session.execute(
                text(
                    "SELECT section_id, layer_a_id, layer_b_id, layer_a_side, layer_b_side "
                    "FROM litho_contact_correlation_edge WHERE model_id = :m"
                ),
                {"m": geotech_model_id},
            )
        ).all()
    pairs: dict[str, set[tuple[str, str]]] = {}
    base_pairs: dict[str, set[tuple[str, str]]] = {}
    for section_id, a, b, sa, sb in rows:
        key = (min(str(a), str(b)), max(str(a), str(b)))
        pairs.setdefault(str(section_id), set()).add(key)
        if sa == "base" and sb == "base":
            base_pairs.setdefault(str(section_id), set()).add(key)
    # Return both maps in one structure: base pairs keyed with a marker.
    return {"pairs": pairs, "base": base_pairs}  # type: ignore[return-value]


def main() -> None:
    """Predict the re-run's accepted additions and write the augmented dump."""
    dump = json.loads(DUMP.read_text(encoding="utf8"))
    existing = asyncio.run(_load_existing_pairs(dump["meta"]["geotechModelId"]))
    existing_pairs: dict[str, set[tuple[str, str]]] = existing["pairs"]  # type: ignore[assignment]
    existing_base: dict[str, set[tuple[str, str]]] = existing["base"]  # type: ignore[assignment]

    nad_class = {k: v["nadClass"] for k, v in dump["refinementBundle"]["nadMeta"].items()}

    total_top = 0
    total_base = 0
    for sec in dump["sections"]:
        # Geotech band stacks per investigation, sorted top->base.
        bands_by_inv: dict[str, list[dict]] = {}
        for layer in sec["refinement"]["geotechLayers"]:
            bands_by_inv.setdefault(layer["investigationId"], []).append(layer)
        for stack in bands_by_inv.values():
            stack.sort(key=lambda x: x["depth_top_m"])

        # Litho unit windows per litho layer id.
        litho_window: dict[str, tuple[str, float, float]] = {}
        for col in sec["columns"]:
            for u in col["units"]:
                litho_window[u["layerId"]] = (
                    col["investigationId"],
                    u["topDepthM"],
                    u["baseDepthM"],
                )

        def stack_in(inv: str, top: float, base: float) -> list[tuple[str, int | None]]:
            return [
                (b["id"], nad_class.get(b["formation_id"]))
                for b in bands_by_inv.get(inv, [])
                if b["depth_top_m"] >= top - _DEPTH_TOL_M
                and b["depth_base_m"] <= base + _DEPTH_TOL_M
            ]

        seen = set(existing_pairs.get(sec["sectionId"], set()))
        seen_base = set(existing_base.get(sec["sectionId"], set()))
        added: list[dict] = []
        for e in sec["edges"]:  # approved litho edges, sides preserved
            wa = litho_window.get(e["a"])
            wb = litho_window.get(e["b"])
            if wa is None or wb is None:
                continue
            left = stack_in(*wa)
            right = stack_in(*wb)
            if not left or not right:
                continue
            is_bottom_tie = e.get("aSide") == "base" and e.get("bSide") == "base"
            # Forced-topmost restatement (accepted) — the first aligned pair
            # when both tops carry a class.
            aligned = aligned_pairs_with_forced_top(left, right)
            if aligned and left[0][1] is not None and right[0][1] is not None:
                la, rb = aligned[0]
                if (la, rb) == (left[0][0], right[0][0]) or (rb, la) == (
                    left[0][0],
                    right[0][0],
                ):
                    key = (min(la, rb), max(la, rb))
                    if key not in seen and la != rb:
                        seen.add(key)
                        added.append({"a": key[0], "b": key[1], "aSide": "top", "bSide": "top"})
            # Base↔base restatement of a litho bottom tie (accepted).
            if is_bottom_tie:
                (ld, lcls), (rd, rcls) = left[-1], right[-1]
                if lcls is not None and rcls is not None and ld != rd:
                    key = (min(ld, rd), max(ld, rd))
                    if key not in seen_base:
                        seen_base.add(key)
                        added.append({"a": key[0], "b": key[1], "aSide": "base", "bSide": "base"})

        tops = sum(1 for a in added if a["aSide"] == "top")
        bases = len(added) - tops
        total_top += tops
        total_base += bases
        sec["geotech"]["edges"].extend(added)
        print(f"  {sec['name']:<18} +{tops} topmost restatement(s), +{bases} base tie(s)")

    OUT.write_text(json.dumps(dump), encoding="utf8")
    print(f"\n  total predicted accepted additions: {total_top} top + {total_base} base")
    print(f"  wrote {OUT}")


if __name__ == "__main__":
    main()

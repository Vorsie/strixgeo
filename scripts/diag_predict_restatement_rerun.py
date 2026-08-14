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
    overlap_gated_interior_pairs,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402

DUMP = _REPO_ROOT / "scripts" / "throwaway_geotech_axis_inputs.json"
OUT = _REPO_ROOT / "scripts" / "throwaway_geotech_axis_inputs_predicted.json"
OUT_ACCEPT_ALL = _REPO_ROOT / "scripts" / "throwaway_geotech_axis_inputs_predicted_accept_all.json"

# Mirror of geotech_edge_derivation._DEPTH_TOL_M.
_DEPTH_TOL_M = 0.001


async def _load_existing_pairs(geotech_model_id: str) -> dict[str, set[tuple[str, str]]]:
    """All persisted geotech edge pairs by section (any approval), read-only."""
    async with AsyncSessionFactory() as session:
        rows = (
            await session.execute(
                text(
                    "SELECT section_id, layer_a_id, layer_b_id, layer_a_side, "
                    "layer_b_side, user_approved "
                    "FROM litho_contact_correlation_edge WHERE model_id = :m"
                ),
                {"m": geotech_model_id},
            )
        ).all()
    pairs: dict[str, set[tuple[str, str]]] = {}
    sided: dict[str, set[tuple[str, str, str, str]]] = {}
    pending: dict[str, list[dict]] = {}
    for section_id, a, b, sa, sb, approved in rows:
        a, b = str(a), str(b)
        pairs.setdefault(str(section_id), set()).add((min(a, b), max(a, b)))
        skey = (a, b, sa, sb) if a < b else (b, a, sb, sa)
        sided.setdefault(str(section_id), set()).add(skey)
        if not approved:
            # A step-3 accept-all PROMOTES these — scenario 2 must include
            # them (the CS1 gap-3 silt-body ghost already sits here pending).
            pending.setdefault(str(section_id), []).append(
                {"a": a, "b": b, "aSide": sa, "bSide": sb}
            )
    return {"pairs": pairs, "sided": sided, "pending": pending}  # type: ignore[return-value]


def main() -> None:
    """Predict the re-run's accepted additions and write the augmented dump."""
    dump = json.loads(DUMP.read_text(encoding="utf8"))
    existing = asyncio.run(_load_existing_pairs(dump["meta"]["geotechModelId"]))
    existing_pairs: dict[str, set[tuple[str, str]]] = existing["pairs"]  # type: ignore[assignment]
    existing_sided: dict[str, set[tuple[str, str, str, str]]] = existing["sided"]  # type: ignore[assignment]
    existing_pending: dict[str, list[dict]] = existing["pending"]  # type: ignore[assignment]

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

        def stack_frac(
            inv: str, top: float, base: float
        ) -> list[tuple[str, int | None, float, float]]:
            height = base - top
            if height <= _DEPTH_TOL_M:
                return []
            return [
                (
                    b["id"],
                    nad_class.get(b["formation_id"]),
                    max(0.0, (b["depth_top_m"] - top) / height),
                    min(1.0, (b["depth_base_m"] - top) / height),
                )
                for b in bands_by_inv.get(inv, [])
                if b["depth_top_m"] >= top - _DEPTH_TOL_M
                and b["depth_base_m"] <= base + _DEPTH_TOL_M
            ]

        seen = set(existing_pairs.get(sec["sectionId"], set()))
        seen_sided = set(existing_sided.get(sec["sectionId"], set()))
        added: list[dict] = []
        interior_added: list[dict] = []
        for e in sec["edges"]:  # approved litho edges, sides preserved
            wa = litho_window.get(e["a"])
            wb = litho_window.get(e["b"])
            if wa is None or wb is None:
                continue
            left = stack_in(*wa)
            right = stack_in(*wb)
            if not left or not right:
                continue
            sa, sb = e.get("aSide", "top"), e.get("bSide", "top")
            if (sa, sb) == ("top", "top"):
                # Forced-topmost restatement (accepted) — the first aligned
                # pair when both tops carry a class.
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
            else:
                # Sided restatement (accepted): side → the band owning that
                # contact surface (top → topmost, base → deepest).
                lid, lcls = left[0] if sa == "top" else left[-1]
                rid, rcls = right[0] if sb == "top" else right[-1]
                if lcls is not None and rcls is not None and lid != rid:
                    skey = (lid, rid, sa, sb) if lid < rid else (rid, lid, sb, sa)
                    if skey not in seen_sided:
                        seen_sided.add(skey)
                        added.append(
                            {"a": skey[0], "b": skey[1], "aSide": skey[2], "bSide": skey[3]}
                        )
            # The interior body ghosts a step-2 press also emits (pending) and
            # a step-3 accept-all would promote — AFTER the restatement, same
            # order as the real derivation, so a ghost never steals its pair.
            for la, rb in overlap_gated_interior_pairs(stack_frac(*wa), stack_frac(*wb)):
                key = (min(la, rb), max(la, rb))
                if key not in seen and la != rb:
                    seen.add(key)
                    interior_added.append(
                        {"a": key[0], "b": key[1], "aSide": "top", "bSide": "top"}
                    )

        tops = sum(1 for a in added if (a["aSide"], a["bSide"]) == ("top", "top"))
        sided_n = len(added) - tops
        total_top += tops
        total_base += sided_n
        sec["geotech"]["edges"].extend(added)
        sec["_interior"] = interior_added
        print(
            f"  {sec['name']:<18} +{tops} topmost restatement(s), "
            f"+{sided_n} sided tie(s), +{len(interior_added)} interior ghost(s)"
        )

    OUT.write_text(json.dumps(dump), encoding="utf8")
    # Scenario 2: the engineer presses accept-all (step 3) — the NEW interior
    # ghosts AND the already-persisted pending proposals join the fill's
    # edge set.
    for sec in dump["sections"]:
        sec["geotech"]["edges"].extend(sec.pop("_interior", []))
        sec["geotech"]["edges"].extend(existing_pending.get(sec["sectionId"], []))
    OUT_ACCEPT_ALL.write_text(json.dumps(dump), encoding="utf8")
    print(f"\n  total predicted accepted additions: {total_top} top + {total_base} sided")
    print(f"  wrote {OUT} and {OUT_ACCEPT_ALL}")


if __name__ == "__main__":
    main()

"""READ-ONLY: diff an emitted engine-arm payload against the stored build generation.

The A/B emitter claims its v2 arm is what the owner's machine actually posts. A
matching region COUNT is weak evidence for that — two partitions can agree on how
many pieces they cut and disagree about every piece. This script settles it by
walking both payloads region for region: same section order, same column order,
same gap index, same body, same classification, same polygon vertices.

It also reports the v1 arm against the same anchor, which is the number that
matters commercially: v1 is what a fresh install builds, and the size of its
disagreement with the stored generation is the size of the gap between what the
owner has validated and what a new user would get.

Normalisation, and why it is not cheating: the stored payload is a Python
dataclass serialised with ``asdict``, so every optional classification field
materialises as an explicit ``null`` / ``false``. The frontend omits an optional
field whose engine value is ``undefined``. The two encodings mean the same thing
to ``_sections_from_payload``, which reads all four with ``.get()`` defaults, so
an absent key is compared as the default rather than as a difference.

Nothing is written. Reads only, behind the usual dev-DB guard.

Usage
-----
    uv run python scripts/diag_engine_ab_compare.py
    uv run python scripts/diag_engine_ab_compare.py --generation <uuid>
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any
from uuid import UUID

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sqlalchemy import text  # noqa: E402

from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402
from scripts.eval_strat_fidelity import _confirm_db_target  # noqa: E402

_ARMS = {
    "v1": _REPO_ROOT / "scripts" / "throwaway_engine_payload_v1.json",
    "v2": _REPO_ROOT / "scripts" / "throwaway_engine_payload_v2.json",
}


def _normalise_region(region: dict[str, Any]) -> tuple:
    """Reduce a region to the comparable tuple both encodings agree on.

    Parameters
    ----------
    region : dict
        One region, from either the stored payload or an emitted arm.

    Returns
    -------
    tuple
        ``(formation_id, body_id, gap_index, kind, overlay_tier, tied_band_base,
        tie_clipped, polygon)`` with the four optional fields defaulted exactly
        as ``_sections_from_payload`` defaults them.
    """
    return (
        region["formation_id"],
        region["body_id"],
        region["gap_index"],
        region.get("kind"),
        region.get("overlay_tier"),
        region.get("tied_band_base"),
        bool(region.get("tie_clipped", False)),
        tuple((float(p[0]), float(p[1])) for p in region["polygon"]),
    )


def _compare(arm: str, emitted: dict[str, Any], stored: dict[str, Any]) -> bool:
    """Report one arm against the stored generation payload.

    Parameters
    ----------
    arm : str
        Label for the console output, e.g. ``"v1"``.
    emitted : dict
        The payload written by the emitter for this arm.
    stored : dict
        The stored generation's payload.

    Returns
    -------
    bool
        ``True`` when the two payloads are identical after normalisation.
    """
    e_secs = emitted["sections"]
    s_secs = stored["sections"]
    print(f"\n  --- {arm} vs stored generation ---")
    if len(e_secs) != len(s_secs):
        print(f"    SECTION COUNT DIFFERS: emitted {len(e_secs)}, stored {len(s_secs)}")
        return False

    identical = True
    total_e = total_s = total_same = total_same_geom = 0
    for i, (e_sec, s_sec) in enumerate(zip(e_secs, s_secs, strict=True)):
        line_delta = max(abs(e_sec[k] - s_sec[k]) for k in ("start_x", "start_y", "end_x", "end_y"))
        e_cols = [
            (c["investigation_id"], c["along_m"], c["world_x"], c["world_y"])
            for c in e_sec["columns"]
        ]
        s_cols = [
            (c["investigation_id"], c["along_m"], c["world_x"], c["world_y"])
            for c in s_sec["columns"]
        ]
        e_regs = [_normalise_region(r) for r in e_sec["regions"]]
        s_regs = [_normalise_region(r) for r in s_sec["regions"]]
        total_e += len(e_regs)
        total_s += len(s_regs)

        # Order-independent on the region list: the emitter and the build agree on
        # section and column ORDER (asserted above and by the column tuple compare),
        # but the region list order is an engine emission detail, not a contract.
        # Compared as MULTISETS rather than sets so two identical-geometry regions
        # in one gap still have to appear the same number of times on both sides.
        e_count = Counter(e_regs)
        s_count = Counter(s_regs)
        same = e_count == s_count
        overlap = sum((e_count & s_count).values())
        total_same += overlap
        # Second, weaker pass: the same comparison with the four classification
        # fields dropped. It separates "this engine cut a different shape" from
        # "this engine cut the same shape and labelled it differently", which are
        # very different findings — the first changes the model's geometry, the
        # second changes only how the labeller terminates it.
        e_geom = Counter((r[0], r[1], r[2], r[7]) for r in e_regs)
        s_geom = Counter((r[0], r[1], r[2], r[7]) for r in s_regs)
        total_same_geom += sum((e_geom & s_geom).values())
        problems = []
        if line_delta > 1e-9:
            problems.append(f"line Δ{line_delta:.4g} m")
        if e_cols != s_cols:
            problems.append(f"columns differ ({len(e_cols)} vs {len(s_cols)})")
        if not same:
            problems.append(
                f"regions {len(e_regs)} vs {len(s_regs)}, {overlap} identical, "
                f"{len(e_regs) - overlap} emitted-only, {len(s_regs) - overlap} stored-only"
            )
        if problems:
            identical = False
            print(f"    section {i:>2}: " + "; ".join(problems))

    print(
        f"    {total_same} of {total_e} emitted region(s) are byte-identical to the "
        f"{total_s} stored region(s)"
    )
    print(
        f"    {total_same_geom} of {total_e} match on GEOMETRY alone "
        f"(formation, body, gap, polygon -- classification ignored)"
    )
    print(
        "    IDENTICAL: this arm reproduces the stored generation's payload exactly."
        if identical
        else "    DIFFERS: this arm does not reproduce the stored generation's payload."
    )
    return identical


async def main() -> None:
    """Load the stored generation and diff every emitted arm against it."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--generation", type=UUID, default=None)
    args = ap.parse_args()

    print("\n=== ENGINE A/B PAYLOAD COMPARE (READ-ONLY) ===\n")
    _confirm_db_target()

    sql = (
        "SELECT id::text, created_at, bodies_built, triangles, payload FROM litho_build_generation "
    )
    if args.generation is not None:
        sql += "WHERE id = :gid "
    sql += "ORDER BY created_at DESC LIMIT 1"
    async with AsyncSessionFactory() as session:
        row = (
            (
                await session.execute(
                    text(sql), {"gid": str(args.generation)} if args.generation else {}
                )
            )
            .mappings()
            .first()
        )
    if row is None:
        raise SystemExit("ABORT: no litho_build_generation row found.")

    stored = row["payload"]
    print(
        f"\n  anchor {row['id']} ({row['created_at']:%Y-%m-%d %H:%M} UTC): "
        f"{len(stored['sections'])} sections, "
        f"{sum(len(s['regions']) for s in stored['sections'])} regions, "
        f"{row['bodies_built']} bodies, {row['triangles']:,} triangles"
    )

    for arm, path in _ARMS.items():
        if not path.exists():
            print(f"\n  --- {arm}: {path} missing — run the emitter first ---")
            continue
        _compare(arm, json.loads(path.read_text(encoding="utf-8")), stored)
    print()


if __name__ == "__main__":
    asyncio.run(main())

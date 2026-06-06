"""Algorithm-vs-ground-truth evaluation harness for Strix suggestion passes.

Compares a Strix suggestion algorithm's output against the *user's own manual
marks* in a real project, and reports a per-decision confusion matrix,
precision / recall, and — most importantly — the SPECIFIC misses with their
geological context so the divergence pattern is visible (not just a score).

This is the automated form of the recurring manual task: "I hand-marked the
pinch-outs / correlations in test.strix, now run the algorithm and tell me
where it disagrees with me." (e.g. the R1 pinch-out rule, validated at
"39/42 marks" — the 3 misses being thin-lens picks.)

Currently implemented target
----------------------------
``pinch_out`` — ``SuggestBodyPinchOuts`` (the R1 lithology-continuity rule)
vs the user-claimed body extents (``body.extent_*_provenance = 'user'``).

Ground truth is read straight from the live DB. The algorithm is run inside a
SINGLE transaction that nulls the user extents (so the suppress-already-claimed
guard doesn't hide them), collects candidates, then **rolls back** — the
user's project is never mutated.

Usage
-----
    uv run python scripts/eval_suggestions.py --target pinch_out
    uv run python scripts/eval_suggestions.py --target pinch_out --model-id <uuid>
    uv run python scripts/eval_suggestions.py --target pinch_out --section-id <uuid> --json

With no ``--model-id`` it auto-selects the lithostratigraphic model that
carries the most user-marked bodies (the one you were just dogfeeding).
"""

from __future__ import annotations

import argparse
import asyncio
import json
from collections import Counter
from uuid import UUID

from sqlalchemy import text

from groundmodel.application.suggest_body_pinch_outs import SuggestBodyPinchOuts
from groundmodel.infrastructure.db.session import AsyncSessionFactory

# Map the stored extent kind onto the three decisions the algorithm makes, so
# ground truth and algorithm output share one vocabulary (band / pinch / open).
_KIND_TO_DECISION = {
    None: "band",  # no user extent on this side → unit continues (a band)
    "to_target": "band",  # detector bilateral closure ≈ continues to neighbour
    "extrapolated": "band",
    "pinch_out_halfway": "pinch",
    "open": "open",
}
_SIDES = ("left", "right")


async def _auto_select_model(session) -> tuple[UUID, UUID]:
    """Pick the litho model with the most user-marked bodies + its project."""
    row = (
        await session.execute(
            text(
                """
                SELECT gm.app_project_id, gm.id,
                       count(*) FILTER (WHERE b.extent_left_provenance='user'
                                          OR b.extent_right_provenance='user') AS marked
                FROM geological_model gm
                JOIN body b ON b.model_id = gm.id
                WHERE gm.kind = 'lithostratigraphic'
                GROUP BY gm.app_project_id, gm.id
                ORDER BY marked DESC
                LIMIT 1
                """
            )
        )
    ).first()
    if row is None:
        raise SystemExit("No lithostratigraphic model with bodies found in the DB.")
    return row[0], row[1]


async def _ground_truth(session, model_id: UUID) -> dict[tuple[UUID, str], str]:
    """Per (body, side) the user's manual decision; only user-claimed sides."""
    rows = (
        await session.execute(
            text(
                """
                SELECT id, extent_left_kind, extent_left_provenance,
                       extent_right_kind, extent_right_provenance
                FROM body WHERE model_id = :mid
                """
            ),
            {"mid": str(model_id)},
        )
    ).all()
    gt: dict[tuple[UUID, str], str] = {}
    for bid, lk, lp, rk, rp in rows:
        if lp == "user":
            gt[(bid, "left")] = _KIND_TO_DECISION.get(lk, "band")
        if rp == "user":
            gt[(bid, "right")] = _KIND_TO_DECISION.get(rk, "band")
    return gt


async def _body_context(session, model_id: UUID) -> dict[UUID, str]:
    """Short geological label per body: lithology + member count (for misses)."""
    rows = (
        await session.execute(
            text(
                """
                SELECT b.id, gf.litho_main_soil_code, count(ll.id) AS members
                FROM body b
                LEFT JOIN litho_layer ll ON ll.body_id = b.id
                LEFT JOIN geological_formation gf ON gf.id = ll.formation_id
                WHERE b.model_id = :mid
                GROUP BY b.id, gf.litho_main_soil_code
                """
            ),
            {"mid": str(model_id)},
        )
    ).all()
    ctx: dict[UUID, str] = {}
    for bid, soil, members in rows:
        ctx[bid] = f"{soil or '?'}·{members}m"  # e.g. "ZAND·1m" → 1-member = lens
    return ctx


async def _run_algorithm(session, project_id, model_id, section_id) -> dict[tuple[UUID, str], str]:
    """Run R1 fresh (un-suppressed) inside a rolled-back txn; map to decisions."""
    # The algo suppresses sides the user already claimed → null them first so
    # every side gets a fresh decision. This write is rolled back below.
    await session.execute(
        text(
            """
            UPDATE body SET
              extent_left_kind=NULL,  extent_left_provenance='detector',
              extent_right_kind=NULL, extent_right_provenance='detector'
            WHERE model_id=:mid
            """
        ),
        {"mid": str(model_id)},
    )
    await session.flush()  # visible to the use case within this txn, never committed

    candidates = await SuggestBodyPinchOuts(session).execute(
        project_id=project_id, model_id=model_id, section_id=section_id
    )
    algo: dict[tuple[UUID, str], str] = {}
    for c in candidates:
        if c.body_id is not None:
            algo[(c.body_id, c.side)] = "pinch" if c.kind == "pinch_out_halfway" else "open"
    return algo


def _report(gt, algo, ctx, as_json: bool) -> None:
    labels = ("band", "pinch", "open")
    confusion: Counter = Counter()
    misses = []
    for key, truth in gt.items():
        pred = algo.get(key, "band")  # no candidate emitted == band
        confusion[(truth, pred)] += 1
        if pred != truth:
            bid, side = key
            misses.append(
                {"body": ctx.get(bid, str(bid)[:8]), "side": side, "expected": truth, "got": pred}
            )
    total = sum(confusion.values())
    correct = sum(confusion[(l, l)] for l in labels)

    if as_json:
        per_class = {}
        for l in labels:
            tp = confusion[(l, l)]
            fp = sum(confusion[(t, l)] for t in labels if t != l)
            fn = sum(confusion[(l, p)] for p in labels if p != l)
            per_class[l] = {
                "precision": round(tp / (tp + fp), 3) if tp + fp else None,
                "recall": round(tp / (tp + fn), 3) if tp + fn else None,
                "support": tp + fn,
            }
        print(
            json.dumps(
                {"marks": total, "matched": correct, "per_class": per_class, "misses": misses},
                indent=2,
            )
        )
        return

    print(f"\n  ALGORITHM vs YOUR MARKS — matched {correct}/{total}\n")
    print("  confusion (row = your mark, col = algorithm):")
    print("            " + "".join(f"{l:>8}" for l in labels))
    for t in labels:
        print(f"    {t:>8}  " + "".join(f"{confusion[(t, p)]:>8}" for p in labels))
    print("\n  per-decision precision / recall:")
    for l in labels:
        tp = confusion[(l, l)]
        fp = sum(confusion[(t, l)] for t in labels if t != l)
        fn = sum(confusion[(l, p)] for p in labels if p != l)
        p = f"{tp / (tp + fp):.2f}" if tp + fp else "  —"
        r = f"{tp / (tp + fn):.2f}" if tp + fn else "  —"
        print(f"    {l:>6}:  precision {p}   recall {r}   (support {tp + fn})")
    if misses:
        print("\n  MISSES (look for the pattern — e.g. all 1-member = thin lenses):")
        for m in misses:
            print(
                f"    {m['body']:>10}  {m['side']:>5}:  you said {m['expected']:<5}  algo said {m['got']}"
            )
    else:
        print("\n  no misses — algorithm matches every mark.")
    print()


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--target", default="pinch_out", choices=["pinch_out"])
    ap.add_argument("--model-id", type=UUID, default=None)
    ap.add_argument("--project-id", type=UUID, default=None)
    ap.add_argument("--section-id", type=UUID, default=None)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    async with AsyncSessionFactory() as session:
        if args.model_id is None:
            project_id, model_id = await _auto_select_model(session)
        else:
            model_id = args.model_id
            project_id = args.project_id
            if project_id is None:
                project_id = (
                    await session.execute(
                        text("SELECT app_project_id FROM geological_model WHERE id=:m"),
                        {"m": str(model_id)},
                    )
                ).scalar_one()

        gt = await _ground_truth(session, model_id)
        ctx = await _body_context(session, model_id)
        if not gt:
            raise SystemExit(
                "No user-claimed marks on this model — nothing to evaluate against. "
                "Hand-mark the section first, then re-run."
            )
        algo = await _run_algorithm(session, project_id, model_id, args.section_id)
        await session.rollback()  # NEVER mutate the user's project

    _report(gt, algo, ctx, args.json)


if __name__ == "__main__":
    asyncio.run(main())

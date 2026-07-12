"""Real-data eval: run SubdivideAllBodies against the dev DB litho model.

Connects to the dev ``groundmodel`` DB, resolves the known lithostratigraphic
model ``019e934c-...``, and for each of its cross-sections runs:

``SubdivideAllBodies.execute(...)`` — classify bodies into NAD sub-units and
materialise geotech layers + edges + bodies (the use case find-or-creates the
geotech sibling model itself).

The use case commits to the dev DB, so after this script runs the owner can
dogfeed the built geotech model in the desktop app.

The script reports, per section and aggregated:

- Body group decision: consistent-split vs one-representative-class vs borehole-only.
- The split-vs-one-class ratio — the primary signal for whether the exact-sequence
  consensus knob (B-policy §0.1 default) is too strict on real data.
- Count of borehole-only carry-through groups (no CPT qc → nad_class=None).
- Any per-section errors (caught + reported, run continues).

Usage
-----
    uv run python scripts/eval_geotech_subdivision.py
    uv run python scripts/eval_geotech_subdivision.py --litho-model-id <uuid>
    uv run python scripts/eval_geotech_subdivision.py --dry-run

Notes
-----
No owner-marked ground-truth NAD data exists yet (this is the first geotech build
for this project). The script reports the algorithm's decisions and the split/one-
class ratio so the owner can judge whether exact-sequence consensus is a useful
default or needs a ±1-band fuzzy tolerance.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import traceback
from pathlib import Path
from uuid import UUID

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sqlalchemy import select  # noqa: E402

from groundmodel.application.subdivide_all_bodies import (  # noqa: E402
    SubdivideAllBodies,
    SubdivideAllBodiesResult,
)
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm  # noqa: E402
from groundmodel.infrastructure.db.models.geological_model_orm import (  # noqa: E402
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402
from groundmodel.shared.config import settings  # noqa: E402

# Known dev-DB lithostratigraphic model id.
_DEFAULT_LITHO_MODEL_ID = UUID("019e934c-70fd-7d11-a44a-b2073f4063a2")

# NAD class labels (Belgium / NAD-NEN packing class 1-indexed, loose→dense).
_NAD_CLASS_LABELS: dict[int, str] = {
    1: "los/los",
    2: "los/matig",
    3: "matig/matig",
    4: "matig/dicht",
    5: "dicht/dicht",
    6: "zeer dicht",
}


# ---------------------------------------------------------------------------
# DB safety guard
# ---------------------------------------------------------------------------


def _confirm_dev_db() -> None:
    """Abort when the DSN is not the dev groundmodel DB.

    This script WRITES to the DB. The guard prevents accidental runs against
    the integration/test sibling (which would wipe the Playwright fixture).

    Raises
    ------
    SystemExit
        When the DSN does not contain ``groundmodel`` or is an
        integration/test sibling.
    """
    url = settings.database_url
    print(f"  DB target: {url}")
    if "groundmodel" not in url:
        raise SystemExit(
            f"ABORT: DSN does not contain 'groundmodel' — refusing to run against ({url!r})."
        )
    if url.rstrip("/").endswith(("_integration", "_test")):
        raise SystemExit(
            f"ABORT: DSN names an integration/test DB — use the dev "
            f"'groundmodel' DB only ({url!r})."
        )
    print("  DB target OK (dev groundmodel).")


# ---------------------------------------------------------------------------
# Per-section result holder
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------


async def _resolve_litho_model(session, litho_model_id: UUID) -> tuple[UUID, UUID]:
    """Return ``(project_id, litho_model_id)`` after verifying the model exists.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    litho_model_id : UUID
        The lithostratigraphic model to resolve.

    Returns
    -------
    tuple[UUID, UUID]
        ``(project_id, litho_model_id)``.

    Raises
    ------
    SystemExit
        When the model row is absent or has the wrong kind.
    """
    model = await session.get(GeologicalModelOrm, litho_model_id)
    if model is None:
        raise SystemExit(f"ABORT: lithostratigraphic model {litho_model_id} not found in DB.")
    print(
        f"  litho model: {model.id}  name={model.name!r}  "
        f"kind={model.kind!r}  project={model.app_project_id}"
    )
    if model.kind != "lithostratigraphic":
        raise SystemExit(f"ABORT: model kind is {model.kind!r} — expected 'lithostratigraphic'.")
    return model.app_project_id, litho_model_id


async def _list_sections(session, project_id: UUID) -> list[CrossSectionOrm]:
    """Return all cross-sections for the project, ordered by display_order then name.

    Parameters
    ----------
    session : AsyncSession
        Active database session.
    project_id : UUID
        Owning project id.

    Returns
    -------
    list[CrossSectionOrm]
        All sections for the project, in display order.
    """
    rows = (
        (
            await session.execute(
                select(CrossSectionOrm)
                .where(CrossSectionOrm.app_project_id == project_id)
                .order_by(CrossSectionOrm.display_order, CrossSectionOrm.name)
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


# ---------------------------------------------------------------------------
# Model-wide runner
# ---------------------------------------------------------------------------


async def _run_subdivide(
    *,
    project_id: UUID,
    litho_model_id: UUID,
    dry_run: bool,
) -> SubdivideAllBodiesResult | None:
    """Run the model-wide ``SubdivideAllBodies`` once and return its result.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    litho_model_id : UUID
        Lithostratigraphic model id (the whole model is subdivided in one
        transaction — geotech layers are model-wide, edges are per-section).
    dry_run : bool
        When True, roll back rather than committing.

    Returns
    -------
    SubdivideAllBodiesResult | None
        The use-case result, or ``None`` when the run raised.
    """
    print("\n  [model-wide SubdivideAllBodies]")
    try:
        async with AsyncSessionFactory() as session:
            sab = SubdivideAllBodies(session)
            result = await sab.execute(project_id=project_id, litho_model_id=litho_model_id)
            if dry_run:
                await session.rollback()
            print(
                f"    SAB SubdivideAllBodies: "
                f"{'DRY RUN — rolled back' if dry_run else 'COMMITTED'} — "
                f"layers={result.layer_count} "
                f"bodies={result.body_count} "
                f"split={result.split_body_count} "
                f"one_class={result.one_class_body_count} "
                f"borehole_only={result.borehole_only_count}"
            )
        return result
    except Exception as exc:  # noqa: BLE001
        tb = traceback.format_exc()
        print(f"    ERROR: {type(exc).__name__}: {exc}")
        for line in tb.splitlines():
            print(f"    {line}")
        return None


# ---------------------------------------------------------------------------
# Reporting helpers
# ---------------------------------------------------------------------------


def _print_divider(char: str = "=", width: int = 70) -> None:
    """Print a horizontal divider line."""
    print(char * width)


def _print_section_header(title: str) -> None:
    """Print a named section header between two divider lines."""
    _print_divider()
    print(f"  {title}")
    _print_divider()


def _aggregate_and_report(
    result: SubdivideAllBodiesResult | None,
    *,
    sections_run: int,
    sections_errored: list[str],
) -> None:
    """Print the model-wide subdivision summary.

    Parameters
    ----------
    result : SubdivideAllBodiesResult | None
        The single model-wide subdivision result (None when it raised).
    sections_run : int
        Number of section-skeleton builds attempted.
    sections_errored : list[str]
        Names of sections whose skeleton build raised.
    """
    _print_section_header("AGGREGATE SUMMARY")
    print(f"  section builds run        : {sections_run}")
    print(f"  section builds errored    : {len(sections_errored)}")
    if sections_errored:
        for name in sections_errored:
            print(f"    - {name}")
    print()

    if result is None:
        print("  SubdivideAllBodies ERRORED — no model-wide result to report.")
        return

    total_split = result.split_body_count
    total_one_class = result.one_class_body_count
    total_borehole_only = result.borehole_only_count
    total_groups = total_split + total_one_class + total_borehole_only

    print(f"  total body groups         : {total_groups}")
    if total_groups > 0:
        pct_split = 100 * total_split / total_groups
        pct_one = 100 * total_one_class / total_groups
        pct_bh = 100 * total_borehole_only / total_groups
        print(f"  consistent split          : {total_split}  ({pct_split:.1f} %)")
        print(f"  one representative class  : {total_one_class}  ({pct_one:.1f} %)")
        print(f"  borehole-only (no CPT qc) : {total_borehole_only}  ({pct_bh:.1f} %)")
    else:
        print(f"  consistent split          : {total_split}")
        print(f"  one representative class  : {total_one_class}")
        print(f"  borehole-only (no CPT qc) : {total_borehole_only}")

    print()
    print(f"  total geotech layers      : {result.layer_count}")
    print(f"  total geotech bodies      : {result.body_count}")
    print(f"  new geotech formations    : {len(result.created_formation_ids)}")

    # --- Consensus-strictness verdict ---
    _print_section_header("CONSENSUS-STRICTNESS VERDICT (§0.1 B-policy)")
    if total_groups == 0:
        print("  No body groups processed — model may have no in-corridor litho data.")
        return

    cpt_groups = total_split + total_one_class
    if cpt_groups == 0:
        print(
            "  All groups were borehole-only — no CPT qc available to assess consensus strictness."
        )
        return

    pct_split_of_cpt = 100 * total_split / cpt_groups
    print(
        f"  Of {cpt_groups} CPT-bearing body groups:"
        f"  {total_split} split ({pct_split_of_cpt:.1f} %)"
        f"  /  {total_one_class} one-class ({100 - pct_split_of_cpt:.1f} %)."
    )
    print()
    if pct_split_of_cpt < 5:
        print(
            f"  VERDICT: Exact-sequence consensus appears TOO STRICT on real data.\n"
            f"  Only {pct_split_of_cpt:.1f} % of CPT-bearing groups split — almost everything\n"
            f"  falls to 'one representative class'. This strongly signals the\n"
            f"  documented ±1-band fuzzy tolerance refinement should be evaluated.\n"
            f"  Do NOT change the default yet — report to owner for a threshold decision."
        )
    elif pct_split_of_cpt < 20:
        print(
            f"  VERDICT: Split rate {pct_split_of_cpt:.1f} % is low but non-trivial.\n"
            f"  Exact-sequence consensus may be workable; the ±1-band fuzzy option\n"
            f"  is a candidate improvement but not an urgent blocker."
        )
    else:
        print(
            f"  VERDICT: Split rate {pct_split_of_cpt:.1f} % is healthy.\n"
            f"  Exact-sequence consensus appears effective on this real data.\n"
            f"  No change to the default recommended."
        )

    print()
    print(
        "  NOTE: No owner-authored ground-truth NAD marks exist yet — this is the\n"
        "  first geotech build. The above verdict is based solely on the algorithm's\n"
        "  own B-policy consistency check, not on a comparison to expected classes."
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


async def main() -> None:
    """Run the geotech subdivision eval against the dev DB and print the report."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--litho-model-id",
        type=UUID,
        default=_DEFAULT_LITHO_MODEL_ID,
        help="Lithostratigraphic model UUID (default: the known dev-DB model).",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Roll back instead of committing — eval only, no persistent DB writes.",
    )
    args = ap.parse_args()

    print("\n=== GEOTECH SUBDIVISION REAL-DATA EVAL ===\n")
    _confirm_dev_db()

    # Resolve litho model + project id in a short read-only session.
    async with AsyncSessionFactory() as session:
        project_id, litho_model_id = await _resolve_litho_model(session, args.litho_model_id)
        sections = await _list_sections(session, project_id)

    print(f"\n  Found {len(sections)} cross-section(s) for project {project_id}.\n")
    if not sections:
        print("  No sections found — nothing to eval.")
        return

    if args.dry_run:
        print("  DRY RUN: changes will NOT be committed.\n")

    # Model-wide NAD subdivision, ONCE (geotech layers are model-wide; the
    # use case find-or-creates the geotech sibling model itself).
    _print_section_header("MODEL-WIDE SUBDIVISION")
    sab_result = await _run_subdivide(
        project_id=project_id,
        litho_model_id=litho_model_id,
        dry_run=args.dry_run,
    )

    print()
    _aggregate_and_report(
        sab_result,
        sections_run=len(sections),
        sections_errored=[],
    )
    print("\n=== EVAL COMPLETE ===\n")


if __name__ == "__main__":
    asyncio.run(main())

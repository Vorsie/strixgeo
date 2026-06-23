"""Real-data eval: run SubdivideAllBodies against the dev DB litho model.

Connects to the dev ``groundmodel`` DB, resolves the known lithostratigraphic
model ``019e934c-...``, and for each of its cross-sections runs:

1. ``BuildGeotechModelFromLitho.execute(...)`` — ensures the geotech model +
   geo-bounded skeleton contacts exist.
2. ``SubdivideAllBodies.execute(...)`` — classify bodies into NAD sub-units and
   materialise geotech layers + edges + bodies.

Both use cases commit to the dev DB, so after this script runs the owner can
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
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sqlalchemy import select  # noqa: E402

from groundmodel.application.build_geotech_model_from_litho import (  # noqa: E402
    BuildGeotechModelFromLitho,
)
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


@dataclass
class _SectionResult:
    """Per-section outcome of the eval run.

    Attributes
    ----------
    section_id : UUID
        The cross-section id.
    section_name : str
        Human-readable name for reporting.
    errored : bool
        True when the run for this section raised an exception.
    error_summary : str
        Short error description (empty when not errored).
    result : SubdivideAllBodiesResult | None
        The use-case return value, or None when errored.
    """

    section_id: UUID
    section_name: str
    errored: bool
    error_summary: str
    result: SubdivideAllBodiesResult | None


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
# Per-section runner
# ---------------------------------------------------------------------------


async def _run_section(
    *,
    project_id: UUID,
    litho_model_id: UUID,
    section: CrossSectionOrm,
    dry_run: bool,
) -> _SectionResult:
    """Run BuildGeotechModelFromLitho + SubdivideAllBodies for one section.

    Opens a fresh session per section so an error on one section leaves the
    others unaffected.

    Parameters
    ----------
    project_id : UUID
        Project scope guard.
    litho_model_id : UUID
        Lithostratigraphic model id.
    section : CrossSectionOrm
        The cross-section to process.
    dry_run : bool
        When True, roll back rather than committing — no persistent DB writes.

    Returns
    -------
    _SectionResult
        The outcome for this section (errored=True on exception).
    """
    section_id = section.id
    section_name = section.name
    print(f"\n  [{section_name}]  id={section_id}")

    try:
        async with AsyncSessionFactory() as session:
            # Step A: ensure geotech model + geo-bounded skeleton contacts.
            c1 = BuildGeotechModelFromLitho(session)
            c1_result = await c1.execute(
                project_id=project_id,
                litho_model_id=litho_model_id,
                section_id=section_id,
            )
            print(
                f"    C1 BuildGeotechModelFromLitho: "
                f"geotech_model={c1_result.geotech_model_id} "
                f"created_model={c1_result.created_model} "
                f"skeleton_formations={len(c1_result.created_formation_ids)} "
                f"contacts={len(c1_result.created_contact_ids)} "
                f"geo_cuts={c1_result.divided_contact_count}"
            )

            # Step B: classify + materialise NAD sub-bodies.
            sab = SubdivideAllBodies(session)
            sab_result = await sab.execute(
                project_id=project_id,
                litho_model_id=litho_model_id,
                section_id=section_id,
            )

            if dry_run:
                await session.rollback()
                print(
                    f"    SAB SubdivideAllBodies: DRY RUN — rolled back "
                    f"(layers={sab_result.layer_count} "
                    f"bodies={sab_result.body_count} "
                    f"split={sab_result.split_body_count} "
                    f"one_class={sab_result.one_class_body_count} "
                    f"borehole_only={sab_result.borehole_only_count})"
                )
            else:
                print(
                    f"    SAB SubdivideAllBodies: COMMITTED — "
                    f"layers={sab_result.layer_count} "
                    f"bodies={sab_result.body_count} "
                    f"split={sab_result.split_body_count} "
                    f"one_class={sab_result.one_class_body_count} "
                    f"borehole_only={sab_result.borehole_only_count}"
                )

        return _SectionResult(
            section_id=section_id,
            section_name=section_name,
            errored=False,
            error_summary="",
            result=sab_result,
        )

    except Exception as exc:  # noqa: BLE001
        tb = traceback.format_exc()
        summary = f"{type(exc).__name__}: {exc}"
        print(f"    ERROR: {summary}")
        print("    --- traceback ---")
        for line in tb.splitlines():
            print(f"    {line}")
        print("    --- end traceback ---")
        return _SectionResult(
            section_id=section_id,
            section_name=section_name,
            errored=True,
            error_summary=summary,
            result=None,
        )


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


def _aggregate_and_report(section_results: list[_SectionResult]) -> None:
    """Print the aggregate summary table across all sections.

    Parameters
    ----------
    section_results : list[_SectionResult]
        One entry per section in run order.
    """
    total_split = 0
    total_one_class = 0
    total_borehole_only = 0
    total_layers = 0
    total_bodies = 0
    total_formations_new: set[UUID] = set()
    errored_sections: list[str] = []

    for sr in section_results:
        if sr.errored:
            errored_sections.append(sr.section_name)
            continue
        r = sr.result
        assert r is not None  # guarded by errored check
        total_split += r.split_body_count
        total_one_class += r.one_class_body_count
        total_borehole_only += r.borehole_only_count
        total_layers += r.layer_count
        total_bodies += r.body_count
        total_formations_new.update(r.created_formation_ids)

    total_groups = total_split + total_one_class + total_borehole_only

    _print_section_header("AGGREGATE SUMMARY")
    print(f"  sections run              : {len(section_results)}")
    print(f"  sections errored          : {len(errored_sections)}")
    print()
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
    print(f"  total geotech layers      : {total_layers}")
    print(f"  total geotech bodies      : {total_bodies}")
    print(f"  new geotech formations    : {len(total_formations_new)}")

    if errored_sections:
        print()
        print("  ERRORED SECTIONS:")
        for name in errored_sections:
            print(f"    - {name}")

    # --- Per-section table ---
    _print_section_header("PER-SECTION TABLE")
    hdr = (
        f"  {'Section':30s}  {'Grps':>5}  {'Split':>5}  "
        f"{'1-cls':>5}  {'BH-only':>7}  {'Layers':>6}  {'Bodies':>6}  Status"
    )
    print(hdr)
    print("  " + "-" * (len(hdr) - 2))
    for sr in section_results:
        if sr.errored:
            row = (
                f"  {sr.section_name[:30]:30s}  "
                f"{'':>5}  {'':>5}  {'':>5}  {'':>7}  "
                f"{'':>6}  {'':>6}  ERROR: {sr.error_summary[:40]}"
            )
        else:
            r = sr.result
            assert r is not None
            g = r.split_body_count + r.one_class_body_count + r.borehole_only_count
            row = (
                f"  {sr.section_name[:30]:30s}  "
                f"{g:>5}  {r.split_body_count:>5}  {r.one_class_body_count:>5}  "
                f"{r.borehole_only_count:>7}  {r.layer_count:>6}  "
                f"{r.body_count:>6}  OK"
            )
        print(row)

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

    _print_section_header("PER-SECTION RUNS")

    section_results: list[_SectionResult] = []
    for section in sections:
        sr = await _run_section(
            project_id=project_id,
            litho_model_id=litho_model_id,
            section=section,
            dry_run=args.dry_run,
        )
        section_results.append(sr)

    print()
    _aggregate_and_report(section_results)
    print("\n=== EVAL COMPLETE ===\n")


if __name__ == "__main__":
    asyncio.run(main())

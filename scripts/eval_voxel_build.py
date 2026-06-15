"""Real-data gate: build the voxel litho model on the dev ``test.strix`` model.

Task-6 Step-4 validation.  Runs the FULL application use case
:class:`~groundmodel.application.build_voxel_litho_model.BuildVoxelLithoModel`
against the dev ``groundmodel`` DB using the captured ``test.strix`` section
partitions (``tests/fixtures/voxel/teststrix_partitions.json`` — the same payload
the labeller / mesher eval scripts gate), then asserts the model BUILDS and is
watertight, and records the wall-clock.

⚠ ROLL-BACK BY DEFAULT.  The dev model currently holds the OLD strat-field solids;
overwriting them with voxel solids is Task 7's job (via the on-click Build button),
NOT this validation.  So this script wraps the build in a transaction it ROLLS
BACK — the use case's internal ``commit`` is neutralised by a SAVEPOINT-style outer
rollback (the AsyncSession is begun in a nested transaction; the use case's commit
flushes within it; the outer rollback discards everything).  Pass ``--persist`` to
keep the build (do NOT, unless you intend to replace the dogfeed model's solids).

What it reports (raw numbers — the caller interprets)
-----------------------------------------------------
1. **DB target confirmation** — prints ``settings.database_url`` and ABORTS if it
   is not the dev ``groundmodel`` DB.
2. **Build outcome** — ``bodies_built`` / ``bodies_flagged`` / ``orphans_deleted``
   + the wall-clock of ``execute(force=True)``.
3. **Overlap diagnostic** — ray-samples the BUILT meshes (read back from the
   uncommitted rows) at every section region interior and counts interior overlaps
   between DIFFERENT bodies (the anti-overlap invariant; target ~0).

Usage
-----
    uv run python scripts/eval_voxel_build.py
    uv run python scripts/eval_voxel_build.py --model-id <uuid>
    uv run python scripts/eval_voxel_build.py --grid-spacing 2.0
    uv run python scripts/eval_voxel_build.py --persist        # keep the build (Task 7)
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from pathlib import Path
from uuid import UUID

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import (  # noqa: E402
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool  # noqa: E402

from groundmodel.application.build_voxel_litho_model import BuildVoxelLithoModel  # noqa: E402
from groundmodel.infrastructure.db.models.geological_model_orm import (  # noqa: E402
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.litho_body_solid_orm import (  # noqa: E402
    LithoBodySolidOrm,
)
from groundmodel.shared.config import settings  # noqa: E402
from scripts.eval_voxel_label import _load_sections  # noqa: E402
from tests.unit.domain.services.strat_field.strat_invariants import (  # noqa: E402
    assert_no_overlap_sampled,
)

_FIXTURE = _REPO_ROOT / "tests" / "fixtures" / "voxel" / "teststrix_partitions.json"


def _confirm_db_target() -> None:
    """Print the DB DSN and ABORT if it is not the dev ``groundmodel`` DB."""
    url = settings.database_url
    print(f"  DB target: {url}")
    if "groundmodel" not in url:
        raise SystemExit(f"ABORT: DSN does not contain 'groundmodel' — refusing to run ({url!r}).")
    if url.rstrip("/").endswith(("_integration", "_test")):
        raise SystemExit(
            f"ABORT: DSN names an integration/test DB — this eval must run against "
            f"the dev 'groundmodel' DB only ({url!r})."
        )
    print("  DB target OK (dev groundmodel).")


async def _resolve_model_id(session: AsyncSession, model_id: UUID | None) -> UUID:
    """Return the model id to build — the given one, or the only litho model."""
    if model_id is not None:
        return model_id
    rows = (
        await session.execute(
            select(GeologicalModelOrm.id, GeologicalModelOrm.name).where(
                GeologicalModelOrm.kind == "lithostratigraphic"
            )
        )
    ).all()
    if not rows:
        raise SystemExit("ABORT: no lithostratigraphic model found in the dev DB.")
    if len(rows) > 1:
        listing = "\n".join(f"    {r.id}  {r.name}" for r in rows)
        raise SystemExit(
            f"ABORT: {len(rows)} litho models found — pass --model-id one of:\n{listing}"
        )
    print(f"  auto-selected litho model: {rows[0].id}  ({rows[0].name})")
    return rows[0].id


async def main() -> None:
    """Build the voxel model on the dev test.strix model (rolled back) + report."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model-id", type=UUID, default=None, help="Litho model id (auto if omitted).")
    ap.add_argument(
        "--grid-spacing",
        type=float,
        default=None,
        help="Voxel edge length in metres (default: the fixture's grid_spacing_m).",
    )
    ap.add_argument(
        "--persist",
        action="store_true",
        help="Keep the build (commit). Default rolls back — Task 7 owns persistence.",
    )
    ap.add_argument("--fixture", type=Path, default=_FIXTURE)
    args = ap.parse_args()

    print("=== voxel build real-data gate (test.strix) ===")
    _confirm_db_target()

    sections, fixture_h = _load_sections(args.fixture)
    h = args.grid_spacing if args.grid_spacing is not None else fixture_h
    print(f"  fixture: {args.fixture.name} — {len(sections)} sections; grid spacing {h} m")

    engine = create_async_engine(settings.database_url, poolclass=NullPool)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    try:
        async with factory() as session:
            model_id = await _resolve_model_id(session, args.model_id)

            # Wrap in an outer transaction we roll back: the use case's own
            # commit() flushes within this outer scope, and the outer rollback
            # discards every write so the dev model's persisted solids are
            # untouched.  --persist replaces this with a real commit.
            t0 = time.perf_counter()
            outcome = await BuildVoxelLithoModel(session).execute(
                model_id, sections, grid_spacing_m=h, force=True
            )
            elapsed = time.perf_counter() - t0

            print()
            print("--- BUILD OUTCOME ---")
            print(f"  bodies_built          : {outcome.bodies_built}")
            print(f"  bodies_flagged        : {outcome.bodies_flagged}")
            print(f"  bodies_skipped_chksum : {outcome.bodies_skipped_checksum}")
            print(f"  orphans_deleted       : {outcome.orphans_deleted}")
            print(f"  wall-clock            : {elapsed:.2f} s")

            # Read the just-built rows back (still in this session, pre-rollback).
            rows = (
                (
                    await session.execute(
                        select(LithoBodySolidOrm).where(LithoBodySolidOrm.model_id == model_id)
                    )
                )
                .scalars()
                .all()
            )
            n_flagged = sum(1 for r in rows if r.is_flagged)
            n_verts = sum(len(r.vertices) for r in rows)
            n_tris = sum(len(r.triangles) for r in rows)
            print(
                f"  persisted rows        : {len(rows)} "
                f"({n_flagged} flagged, {n_verts:,} verts, {n_tris:,} tris)"
            )

            # Overlap diagnostic: ray-sample at each section region interior.
            meshes = [
                _MeshView(
                    str(r.body_id),
                    str(r.formation_id),
                    [tuple(v) for v in r.vertices],
                    [tuple(t) for t in r.triangles],
                )
                for r in rows
                if r.vertices and r.triangles
            ]
            samples = _section_interior_samples(sections)
            overlap_err: str | None = None
            try:
                assert_no_overlap_sampled(meshes, samples)
            except AssertionError as exc:
                overlap_err = str(exc)
            print()
            print("--- OVERLAP DIAGNOSTIC ---")
            if overlap_err:
                print(f"  OVERLAP over {len(samples)} samples: {overlap_err[:200]}")
            else:
                print(f"  no inter-body overlap over {len(samples)} (x, y) samples.")

            if args.persist:
                await session.commit()
                print("\n  PERSISTED (--persist): the build was committed.")
            else:
                await session.rollback()
                print("\n  ROLLED BACK: the dev model's solids are unchanged.")

            print()
            ok = outcome.bodies_built > 0 and outcome.bodies_flagged == 0 and overlap_err is None
            if ok:
                print(
                    f"PASS — voxel build produced {outcome.bodies_built} bodies, "
                    f"0 flagged, no overlap, in {elapsed:.2f} s."
                )
            else:
                print(
                    f"FAIL — built={outcome.bodies_built} flagged={outcome.bodies_flagged} "
                    f"overlap={overlap_err is not None}. Investigate (do NOT relax the gate)."
                )
                raise SystemExit(1)
    finally:
        await engine.dispose()


def _section_interior_samples(sections: list) -> list[tuple[float, float]]:
    """One interior ``(world_x, world_y)`` sample per region of every section."""
    from scripts.eval_voxel_label import _frac_gap_to_world, _region_interior_samples

    out: list[tuple[float, float]] = []
    for section in sections:
        for region in section.regions:
            pts = _region_interior_samples(region, 1)
            if pts:
                frac, _elev = pts[0]
                out.append(_frac_gap_to_world(section, region.gap_index, frac))
    return out


class _MeshView:
    """Duck-typed mesh view (``body_id`` / ``formation_id`` / ``vertices`` / ``triangles``)."""

    def __init__(
        self,
        body_id: str,
        formation_id: str,
        vertices: list[tuple[float, float, float]],
        triangles: list[tuple[int, int, int]],
    ) -> None:
        self.body_id = body_id
        self.formation_id = formation_id
        self.vertices = vertices
        self.triangles = triangles


if __name__ == "__main__":
    asyncio.run(main())

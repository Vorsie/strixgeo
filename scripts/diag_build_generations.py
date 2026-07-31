"""READ-ONLY: list stored build generations and reproduce one from the database.

Until build generations existed, every real-data check in the voxel campaign ran
against a section payload captured by hand into a throwaway JSON file. That is
fragile in a way that bit: when the owner's live build used 14 sections and the
captured file had 16, every number computed from the file was quietly about a
different model, and nothing surfaced the mismatch.

``litho_build_generation`` closes that. Each row carries the exact payload, the
settings, the grid geometry and the derived body-alias map of one build, so a
diagnostic can reproduce a build from the database alone.

``--reproduce`` re-runs the labeller and mesher on a stored generation and
compares the result to what that build recorded — bodies, triangles and a mesh
checksum. A mismatch means the builder no longer reproduces its own output, which
is the thing a provenance record exists to detect.

Nothing is written. Reads only, behind the usual dev-DB guard.

Usage
-----
    uv run python scripts/diag_build_generations.py
    uv run python scripts/diag_build_generations.py --reproduce
    uv run python scripts/diag_build_generations.py --reproduce --generation <uuid>
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import sys
import time
from pathlib import Path
from uuid import UUID

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sqlalchemy import select  # noqa: E402

from groundmodel.application.build_voxel_litho_model import (  # noqa: E402
    _apply_aliases_to_columns,
    _investigation_columns_from_picks,
)
from groundmodel.application.load_geo_surfaces import load_geo_surfaces  # noqa: E402
from groundmodel.domain.services.voxel_litho.build_domain_from_sections import (  # noqa: E402
    build_domain_from_sections,
)
from groundmodel.domain.services.voxel_litho.extract_body_solids import (  # noqa: E402
    extract_body_solids,
)
from groundmodel.domain.services.voxel_litho.label_voxels import label_voxels  # noqa: E402
from groundmodel.domain.services.voxel_litho.merge_bodies_across_sections import (  # noqa: E402
    apply_body_aliases,
)
from groundmodel.domain.services.voxel_litho.true_column_positions import (  # noqa: E402
    apply_true_column_positions,
)
from groundmodel.domain.services.voxel_litho.voxel_types import (  # noqa: E402
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (  # noqa: E402
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.litho_body_solid_orm import (  # noqa: E402
    LithoBodySolidOrm,
)
from groundmodel.infrastructure.db.models.litho_build_generation_orm import (  # noqa: E402
    LithoBuildGenerationOrm,
)
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (  # noqa: E402
    LithoLayerRepository,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402
from scripts.eval_strat_fidelity import _confirm_db_target  # noqa: E402


def _sections_from_payload(payload: dict) -> list[SectionPartitionInput]:
    """Rebuild the frozen value objects from a stored generation's payload."""
    return [
        SectionPartitionInput(
            start_x=sec["start_x"],
            start_y=sec["start_y"],
            end_x=sec["end_x"],
            end_y=sec["end_y"],
            columns=tuple(
                SectionColumnInput(
                    investigation_id=c["investigation_id"],
                    along_m=c["along_m"],
                    world_x=c["world_x"],
                    world_y=c["world_y"],
                )
                for c in sec["columns"]
            ),
            regions=tuple(
                RegionInput(
                    formation_id=r["formation_id"],
                    body_id=r["body_id"],
                    polygon=tuple((p[0], p[1]) for p in r["polygon"]),
                    gap_index=r["gap_index"],
                    # Absent on any generation stored before #256, which is why every
                    # field defaults rather than being required — an old build must
                    # stay inspectable.
                    kind=r.get("kind"),
                    overlay_tier=r.get("overlay_tier"),
                    tied_band_base=r.get("tied_band_base"),
                    tie_clipped=bool(r.get("tie_clipped", False)),
                )
                for r in sec["regions"]
            ),
        )
        for sec in payload["sections"]
    ]


def _mesh_checksum(meshes: list) -> str:
    """Order-independent SHA-256 over every mesh's body id, vertices and triangles."""
    digest = hashlib.sha256()
    for mesh in sorted(meshes, key=lambda m: m.body_id):
        digest.update(mesh.body_id.encode())
        digest.update(repr(mesh.vertices).encode())
        digest.update(repr(mesh.triangles).encode())
    return digest.hexdigest()


async def main() -> None:
    """List generations, and optionally reproduce one from the database."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model-id", type=UUID, default=None)
    ap.add_argument("--generation", type=UUID, default=None)
    ap.add_argument("--reproduce", action="store_true")
    args = ap.parse_args()

    print("\n=== LITHO BUILD GENERATIONS (READ-ONLY) ===\n")
    _confirm_db_target()

    async with AsyncSessionFactory() as session:
        stmt = select(LithoBuildGenerationOrm).order_by(LithoBuildGenerationOrm.created_at.desc())
        if args.model_id:
            stmt = stmt.where(LithoBuildGenerationOrm.model_id == args.model_id)
        generations = list((await session.execute(stmt)).scalars().all())

        if not generations:
            print(
                "  No build generations recorded yet — click Build once and they start appearing.\n"
            )
            return

        print(f"  {len(generations)} generation(s):\n")
        for g in generations:
            solids = (
                await session.execute(
                    select(LithoBodySolidOrm.id).where(LithoBodySolidOrm.generation_id == g.id)
                )
            ).all()
            merged = sum(1 for src, dst in (g.body_aliases or {}).items() if src != dst)
            print(
                f"    {g.id}  {g.created_at:%Y-%m-%d %H:%M}  {g.builder_version}\n"
                f"        model {g.model_id}\n"
                f"        {g.horizontal_spacing_m} m / {g.vertical_spacing_m} m   "
                f"honor {g.honor_radius_m} m   snap {g.litho_snap_tolerance_m} m\n"
                f"        grid {g.grid_nx}x{g.grid_ny}x{g.grid_nz} from "
                f"({g.grid_origin_x:.2f}, {g.grid_origin_y:.2f}, {g.grid_origin_z:.2f})\n"
                f"        {g.sections_count} section(s), {g.bodies_built} bodies, "
                f"{g.triangles:,} tris in {g.duration_s:.1f}s\n"
                f"        {merged} body id(s) merged by the cross-section pass; "
                f"{len(solids)} solid row(s) still point here\n"
            )

        if not args.reproduce:
            print("  Pass --reproduce to rebuild the newest generation from the DB.\n")
            return

        target = generations[0]
        if args.generation:
            target = next((g for g in generations if g.id == args.generation), None)  # type: ignore[assignment]
            if target is None:
                raise SystemExit(f"ABORT: generation {args.generation} not found.")

        print(f"  --- reproducing {target.id} ---")
        model = await session.get(GeologicalModelOrm, target.model_id)
        picks = await LithoLayerRepository(session).load_body_picks(target.model_id)
        geo_surfaces: tuple = ()
        if model is not None and model.parent_model_id is not None:
            geo_surfaces = await load_geo_surfaces(session, model.parent_model_id)

    # Mirror BuildVoxelLithoModel.execute exactly. The stored payload is AS
    # RECEIVED, so the alias map and the true-position re-seat are re-derived
    # here, and — crucially — the footprint hull is built from the columns AS
    # DRAWN unioned with the true positions, exactly as the build does. Building
    # it from the re-seated payload instead loses the projected feet and returns
    # a narrower grid.
    received = _sections_from_payload(target.payload)
    aliases = dict(target.body_aliases or {})
    aliased = apply_body_aliases(received, aliases)
    columns = _apply_aliases_to_columns(_investigation_columns_from_picks(picks), aliases)
    seated, _moved, _shift = apply_true_column_positions(aliased, columns)

    started = time.perf_counter()
    domain = build_domain_from_sections(
        aliased,
        investigation_positions=tuple((c.investigation_id, c.world_x, c.world_y) for c in columns),
    )
    grid = label_voxels(
        domain,
        target.horizontal_spacing_m,
        seated,
        vertical_spacing_m=target.vertical_spacing_m,
        investigation_columns=columns,
        geo_surfaces=geo_surfaces,
        litho_snap_tolerance_m=target.litho_snap_tolerance_m,
        honor_radius_m=target.honor_radius_m,
    )
    meshes = [m for m in extract_body_solids(grid) if m.vertices and m.triangles]
    tris = sum(len(m.triangles) for m in meshes)
    elapsed = time.perf_counter() - started

    print(
        f"      grid          recorded {target.grid_nx}x{target.grid_ny}x{target.grid_nz}"
        f"   rebuilt {len(grid.gx)}x{len(grid.gy)}x{len(grid.gz)}"
    )
    print(f"      bodies        recorded {target.bodies_built}   rebuilt {len(meshes)}")
    print(f"      triangles     recorded {target.triangles:,}   rebuilt {tris:,}")
    print(f"      mesh SHA-256  {_mesh_checksum(meshes)}")
    print(f"      rebuilt in    {elapsed:.1f}s\n")

    same = (
        (target.grid_nx, target.grid_ny, target.grid_nz)
        == (len(grid.gx), len(grid.gy), len(grid.gz))
        and target.bodies_built == len(meshes)
        and target.triangles == tris
    )
    print(
        "  REPRODUCED: the builder returns this generation's own output.\n"
        if same
        else "  DIVERGED: the builder no longer reproduces this generation — "
        "either the algorithm changed or an input outside the payload did.\n"
    )


if __name__ == "__main__":
    asyncio.run(main())

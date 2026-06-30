"""Re-materialise the dev geotech model using the current codebase.

Dev utility: runs SubdivideAllBodies → DivideBoreholes against the DEV DB
(not the integration DB).  Call this after any geotech-subdivision code
change to bring the persisted geotech model up to date with the new logic
before running the CS1 real-data gate.

Usage::

    uv run python scripts/rematerialise_dev_geotech.py

The script mutates the dev DB — it deletes and re-creates all geotech
litho_layer rows, geotech correlation edges, and geotech BodyOrm rows for
the litho model below.  The dev geotech model row itself is kept; only its
content is replaced.  Never touches any litho model data.

Constants
---------
LITHO_MODEL_ID : str
    UUID of the lithostratigraphic model in the dev DB whose geotech child
    model is being re-materialised.
PROJECT_ID : str
    UUID of the owning project (required scope guard).
"""

from __future__ import annotations

import asyncio
import logging
from uuid import UUID

# ---------------------------------------------------------------------------
# Dev-DB constants (test.strix project in the dev DB on localhost:5433).
# ---------------------------------------------------------------------------
LITHO_MODEL_ID: str = "019e934c-70fd-7d11-a44a-b2073f4063a2"
PROJECT_ID: str = "019e932e-30bb-7967-8dee-e6a4f1b25378"


async def _main() -> None:
    """Run SubdivideAllBodies then DivideBoreholes against the dev DB.

    Opens one async session per use case (each use case commits itself).
    Prints a structured summary of counts after each step.
    """
    # Import after asyncio is running so the SQLAlchemy engine is not
    # initialised before the event loop is available.
    from groundmodel.application.divide_boreholes import DivideBoreholes
    from groundmodel.application.subdivide_all_bodies import SubdivideAllBodies
    from groundmodel.infrastructure.db.session import AsyncSessionFactory

    project_id = UUID(PROJECT_ID)
    litho_model_id = UUID(LITHO_MODEL_ID)

    print(f"Re-materialising geotech model for litho_model={litho_model_id}")
    print(f"  project={project_id}")
    print()

    # Step 1 — SubdivideAllBodies (CPT classification + model-wide reset + edges).
    print("--- Step 1: SubdivideAllBodies ---")
    async with AsyncSessionFactory() as session:
        result = await SubdivideAllBodies(session).execute(
            project_id=project_id,
            litho_model_id=litho_model_id,
        )

    print(f"  geotech_model_id : {result.geotech_model_id}")
    print(f"  layers           : {result.layer_count}")
    print(f"  bodies           : {result.body_count}")
    print(f"  split_bodies     : {result.split_body_count}")
    print(f"  one_class_bodies : {result.one_class_body_count}")
    print(f"  borehole_only    : {result.borehole_only_count}")
    print(f"  sections         : {result.section_count}")
    print(f"  formations_new   : {len(result.created_formation_ids)}")
    print()

    # Step 2 — DivideBoreholes (litho-confined borehole fill + sample assignment).
    print("--- Step 2: DivideBoreholes ---")
    async with AsyncSessionFactory() as session:
        bh_result = await DivideBoreholes(session).execute(
            project_id=project_id,
            litho_model_id=litho_model_id,
        )

    print(f"  geotech_model_id   : {bh_result.geotech_model_id}")
    print(f"  divided_boreholes  : {bh_result.divided_borehole_count}")
    print(f"  single_band_bh     : {bh_result.single_band_borehole_count}")
    print(f"  borehole_layers    : {bh_result.layer_count}")
    print(f"  formations_new     : {len(bh_result.created_formation_ids)}")
    print()
    print("Done — dev geotech model is up to date.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING)
    asyncio.run(_main())

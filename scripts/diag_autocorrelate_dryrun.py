"""THROWAWAY DIAG — run the REAL AutoCorrelateGeotechEdges use case dry.

``session.commit`` is monkeypatched to ``session.flush`` and the transaction is
rolled back at the end, so the run exercises the genuine code path end to end
(loaders, bridging, aligner, restatement predicate, ORM emission) with ZERO
persistence.  Reports the accepted/proposed split the CURRENT code produces on
the CURRENT dev model.

Run:  uv run python scripts/diag_autocorrelate_dryrun.py
"""

from __future__ import annotations

import asyncio
import os
from uuid import UUID

os.environ.setdefault(
    "DATABASE_URL", "postgresql+asyncpg://groundmodel:groundmodel@localhost:5433/groundmodel"
)

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine  # noqa: E402

from groundmodel.application.auto_correlate_geotech_edges import (  # noqa: E402
    AutoCorrelateGeotechEdges,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (  # noqa: E402
    GeologicalModelOrm,
)

GEOTECH_MODEL = UUID("019fdd79-48c1-742e-b0fa-45a82f0f49ed")


async def main() -> None:
    engine = create_async_engine(os.environ["DATABASE_URL"])
    async with AsyncSession(engine) as session:
        model = await session.get(GeologicalModelOrm, GEOTECH_MODEL)
        assert model is not None
        project_id = model.app_project_id

        # Dry run: the use case commits internally — neuter it.
        session.commit = session.flush  # type: ignore[method-assign]

        use_case = AutoCorrelateGeotechEdges(session)
        result = await use_case.execute(project_id=project_id, model_id=GEOTECH_MODEL)
        print(
            f"DRY RUN result: proposed={result.edges_proposed} "
            f"accepted={result.edges_accepted} "
            f"skipped_existing={result.edges_skipped_existing} "
            f"sections={result.sections_processed} "
            f"no_lcs={result.skipped_no_lcs} empty_stack={result.skipped_empty_stack}"
        )
        await session.rollback()
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())

"""Use case: import CPTs from DOV within a WGS84 bounding box."""

from __future__ import annotations

from uuid import UUID

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.import_cpt import ImportCpt
from groundmodel.application.import_cpt_dov_result import ImportCptDovResult
from groundmodel.infrastructure.parsers.cpt.dov.dov_client import DovClient
from groundmodel.infrastructure.parsers.cpt.dov.dov_parser import DovParser
from groundmodel.shared.exceptions import DuplicateCptError
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class ImportCptDov(GroundModelLogger):
    """Use case: query DOV WFS for a bbox, download CPT XMLs, and persist them.

    Reuses ImportCpt.persist() so all validation, duplicate detection, and ORM
    mapping logic is shared with the GEF import path.

    Parameters
    ----------
    session : AsyncSession
        Database session; each CPT is committed individually so a single parse
        failure does not roll back already-imported records.
    """

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(__name__)
        self._import = ImportCpt(session)

    async def execute(
        self,
        west: float,
        south: float,
        east: float,
        north: float,
        app_project_id: UUID | None = None,
    ) -> ImportCptDovResult:
        """Fetch and persist all CPTs within the WGS84 bounding box.

        Parameters
        ----------
        west, south, east, north : float
            Bounding box corners in WGS84 decimal degrees.
        app_project_id : UUID | None
            Project scope for storage and duplicate detection.

        Returns
        -------
        ImportCptDovResult
            Summary of imported, duplicate, and failed counts plus CPT IDs.
        """
        self.info(f"DOV import bbox: W={west:.4f} S={south:.4f} E={east:.4f} N={north:.4f}")

        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as http:
            items = await DovClient(http).fetch_bbox(west, south, east, north)

        parser = DovParser()
        imported = duplicates = failed = 0
        cpt_ids: list[UUID] = []

        for name, xml_bytes in items:
            try:
                result = parser.parse(xml_bytes, name)
                res = await self._import.persist(result, name, app_project_id)
                imported += 1
                cpt_ids.append(res.cpt_id)
            except DuplicateCptError as exc:
                duplicates += 1
                cpt_ids.append(exc.existing_id)
            except Exception as exc:
                self.warning(f"DOV: skipping '{name}': {exc}")
                failed += 1

        self.success(
            f"DOV import done: {imported} imported, {duplicates} duplicates, {failed} failed"
        )
        return ImportCptDovResult(
            imported=imported,
            duplicates=duplicates,
            failed=failed,
            cpt_ids=cpt_ids,
        )

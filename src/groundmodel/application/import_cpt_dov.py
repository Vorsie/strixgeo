"""Use case: import CPTs from DOV within a WGS84 bounding box."""

from __future__ import annotations

from uuid import UUID

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.import_cpt import ImportCpt
from groundmodel.application.import_cpt_dov_result import ImportCptDovResult
from groundmodel.infrastructure.db.repositories.cpt_repository import CptRepository
from groundmodel.infrastructure.parsers.cpt.dov.dov_client import DovClient
from groundmodel.infrastructure.parsers.cpt.dov.dov_parser import DovParser
from groundmodel.shared.exceptions import ParseError
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
        self._session = session
        self._import = ImportCpt(session)
        self._repo = CptRepository(session)

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
        self.info(
            f"DOV import started: bbox W={west:.4f} S={south:.4f} E={east:.4f} N={north:.4f}  "
            f"project_id={app_project_id}"
        )

        try:
            # follow_redirects=True is required: the DOV XML endpoint
            # /data/sondering/{id}.xml 302-redirects to /xdov/proxy/export/sondering/{id}.
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(60.0, connect=10.0),
                follow_redirects=True,
            ) as http:
                items = await DovClient(http).fetch_bbox(west, south, east, north)
        except httpx.HTTPStatusError as exc:
            self.error(
                f"DOV WFS request failed with HTTP {exc.response.status_code}: {exc}  "
                f"response body: {exc.response.text[:300]!r}"
            )
            raise
        except httpx.RequestError as exc:
            self.error(f"DOV network error during WFS/download phase: {type(exc).__name__}: {exc}")
            raise

        total = len(items)
        self.info(f"DOV import: {total} CPTs to process")

        if total == 0:
            self.info("DOV import: no CPTs found in bbox — nothing to persist")
            return ImportCptDovResult(imported=0, duplicates=0, failed=0, cpt_ids=[])

        # Phase 1 — parse all XMLs (CPU-bound, no DB).
        parser = DovParser()
        parsed: list[tuple[str, object]] = []  # list of (name, GEFParseResult)
        failed = 0
        for i, (name, xml_bytes) in enumerate(items, 1):
            try:
                result = parser.parse(xml_bytes, name)
                if result.has_errors:
                    self.warning(
                        f"DOV import [{i}/{total}]: '{name}' parsed with errors — "
                        + ", ".join(f"{iss.code}: {iss.message}" for iss in result.issues)
                    )
                parsed.append((name, result))
            except ParseError as exc:
                failed += 1
                self.error(f"DOV import [{i}/{total}]: parse error for '{name}': {exc}")
            except Exception as exc:
                failed += 1
                self.error(
                    f"DOV import [{i}/{total}]: unexpected parse error for '{name}': "
                    f"{type(exc).__name__}: {exc}"
                )

        # Phase 2 — batch dedup: one IN-query for all incoming test_ids.
        # All DOV CPTs share project_id="DOV"; gather every test_id and lookup once.
        test_ids = [r.header.test_id for _, r in parsed if r.header.test_id]
        existing = (
            await self._repo.find_existing_test_ids("DOV", test_ids, app_project_id)
            if test_ids
            else {}
        )
        self.debug(f"DOV import: dedup found {len(existing)} of {len(test_ids)} already in project")

        # Phase 3 — persist non-duplicates without committing per-CPT.
        imported = 0
        duplicates = 0
        cpt_ids: list[UUID] = []

        for i, (name, result) in enumerate(parsed, 1):
            existing_id = existing.get(result.header.test_id)
            if existing_id is not None:
                duplicates += 1
                cpt_ids.append(existing_id)
                self.debug(
                    f"DOV import [{i}/{len(parsed)}]: '{name}' already exists ({existing_id})"
                )
                continue

            try:
                res = await self._import.persist(
                    result,
                    name,
                    app_project_id,
                    commit=False,
                    skip_duplicate_check=True,
                )
                imported += 1
                cpt_ids.append(res.cpt_id)
                self.debug(f"DOV import [{i}/{len(parsed)}]: '{name}' → {res.cpt_id}")
            except Exception as exc:
                failed += 1
                self.error(
                    f"DOV import [{i}/{len(parsed)}]: persist failed for '{name}': "
                    f"{type(exc).__name__}: {exc}"
                )

        # Phase 4 — single commit for the entire batch.
        if imported > 0:
            await self._session.commit()
            self.debug(f"DOV import: committed batch of {imported} CPTs")

        self.success(
            f"DOV import done: {imported} imported, {duplicates} duplicates, "
            f"{failed} failed  (total={total})"
        )
        return ImportCptDovResult(
            imported=imported,
            duplicates=duplicates,
            failed=failed,
            cpt_ids=cpt_ids,
        )

"""Async data access for the raw lab-series family (project-scoped)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer, selectinload

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.lab_series_specimen_orm import LabSeriesSpecimenOrm
from groundmodel.infrastructure.db.models.lab_series_stage_orm import LabSeriesStageOrm
from groundmodel.infrastructure.db.models.lab_series_test_orm import LabSeriesTestOrm
from groundmodel.infrastructure.db.models.sample_orm import SampleOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


def _full_tree() -> list[Any]:
    """Loader options for a test's whole tree (channels with their arrays)."""
    return [
        selectinload(LabSeriesTestOrm.specimens)
        .selectinload(LabSeriesSpecimenOrm.stages)
        .selectinload(LabSeriesStageOrm.channels),
        selectinload(LabSeriesTestOrm.lab_results),
    ]


class LabSeriesRepository(GroundModelLogger):
    """Read / write lab-series tests; every query is fenced to one project.

    The project scope runs through ``sample → borehole.app_project_id`` (the
    lab tables carry no project column of their own), fused into the WHERE
    clause so a foreign id simply finds nothing (the debt #4 IDOR pattern).
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def list_borehole_names(self, project_id: UUID) -> list[tuple[str, str]]:
        """Return ``(id, name)`` of every borehole in the project, by name.

        Parameters
        ----------
        project_id : UUID
            The app project.

        Returns
        -------
        list[tuple[str, str]]
            Borehole ids (as strings) and names.
        """
        rows = await self._session.execute(
            select(BoreholeOrm.id, BoreholeOrm.name)
            .where(BoreholeOrm.app_project_id == project_id)
            .order_by(BoreholeOrm.name)
        )
        return [(str(r.id), r.name) for r in rows]

    async def get_borehole(self, borehole_id: UUID, project_id: UUID) -> BoreholeOrm | None:
        """Return a borehole of the project (no children), or ``None``."""
        row: BoreholeOrm | None = await self._session.scalar(
            select(BoreholeOrm).where(
                BoreholeOrm.id == borehole_id, BoreholeOrm.app_project_id == project_id
            )
        )
        return row

    async def list_samples(self, borehole_id: UUID) -> list[SampleOrm]:
        """Return the samples of one borehole, top down."""
        rows = await self._session.scalars(
            select(SampleOrm)
            .where(SampleOrm.borehole_id == borehole_id)
            .order_by(SampleOrm.depth_top_m, SampleOrm.id)
        )
        return list(rows)

    async def get_sample(self, sample_id: UUID, project_id: UUID) -> SampleOrm | None:
        """Return a sample whose borehole is in the project, or ``None``."""
        sample: SampleOrm | None = await self._session.scalar(
            select(SampleOrm)
            .join(BoreholeOrm, BoreholeOrm.id == SampleOrm.borehole_id)
            .where(SampleOrm.id == sample_id, BoreholeOrm.app_project_id == project_id)
        )
        return sample

    async def find_by_identity(
        self,
        project_id: UUID,
        *,
        kind: str,
        test_type_token: str | None,
        lab_job_number: str | None,
        lab_sample_number: str | None,
    ) -> LabSeriesTestOrm | None:
        """Return the stored test with the same lab identity in the project.

        Parameters
        ----------
        project_id : UUID
            The app project.
        kind, test_type_token, lab_job_number, lab_sample_number
            The re-import key (``lab_series_identity``). ``None`` matches
            ``NULL`` (an oedometer has no test-type token).

        Returns
        -------
        LabSeriesTestOrm or None
            The stored test with its specimens and stages (arrays deferred),
            or ``None``.
        """
        stmt = (
            select(LabSeriesTestOrm)
            .join(SampleOrm, SampleOrm.id == LabSeriesTestOrm.sample_id)
            .join(BoreholeOrm, BoreholeOrm.id == SampleOrm.borehole_id)
            .where(
                BoreholeOrm.app_project_id == project_id,
                LabSeriesTestOrm.kind == kind,
                LabSeriesTestOrm.test_type_token.is_not_distinct_from(test_type_token),
                LabSeriesTestOrm.lab_job_number.is_not_distinct_from(lab_job_number),
                LabSeriesTestOrm.lab_sample_number.is_not_distinct_from(lab_sample_number),
            )
            .order_by(LabSeriesTestOrm.id)
            .limit(1)
        )
        found: LabSeriesTestOrm | None = await self._session.scalar(stmt)
        return found

    async def list_full_for_sample(
        self, sample_id: UUID, project_id: UUID
    ) -> list[LabSeriesTestOrm]:
        """Return every test of a sample with its whole tree (for the viewer)."""
        rows = await self._session.scalars(
            select(LabSeriesTestOrm)
            .join(SampleOrm, SampleOrm.id == LabSeriesTestOrm.sample_id)
            .join(BoreholeOrm, BoreholeOrm.id == SampleOrm.borehole_id)
            .where(
                LabSeriesTestOrm.sample_id == sample_id,
                BoreholeOrm.app_project_id == project_id,
            )
            .options(*_full_tree())
            .order_by(LabSeriesTestOrm.id)
        )
        return list(rows)

    async def list_summaries_for_borehole(
        self, borehole_id: UUID, project_id: UUID
    ) -> list[tuple[LabSeriesTestOrm, SampleOrm]]:
        """Return every test on a borehole with its sample, WITHOUT the arrays.

        Specimens and stages are loaded (for the counts); the heavy per-reading
        arrays (timestamps, point numbers) are deferred and channels are not
        loaded at all — the list needs counts, not readings.

        Parameters
        ----------
        borehole_id : UUID
            The borehole.
        project_id : UUID
            The app project (scope fence).

        Returns
        -------
        list[tuple[LabSeriesTestOrm, SampleOrm]]
            Tests ordered by sample depth, then id.
        """
        rows = await self._session.execute(
            select(LabSeriesTestOrm, SampleOrm)
            .join(SampleOrm, SampleOrm.id == LabSeriesTestOrm.sample_id)
            .join(BoreholeOrm, BoreholeOrm.id == SampleOrm.borehole_id)
            .where(SampleOrm.borehole_id == borehole_id, BoreholeOrm.app_project_id == project_id)
            .options(
                selectinload(LabSeriesTestOrm.specimens)
                .selectinload(LabSeriesSpecimenOrm.stages)
                .options(
                    defer(LabSeriesStageOrm.reading_timestamps),
                    defer(LabSeriesStageOrm.point_numbers),
                )
            )
            .order_by(SampleOrm.depth_top_m, LabSeriesTestOrm.id)
        )
        return [(t, s) for t, s in rows]

    async def count_readings(self, test_id: UUID) -> tuple[int, int]:
        """Return ``(n_specimens, n_readings)`` of a stored test."""
        specimens = list(
            await self._session.scalars(
                select(LabSeriesSpecimenOrm.n_points).where(LabSeriesSpecimenOrm.test_id == test_id)
            )
        )
        return len(specimens), int(sum(specimens))

    async def delete_test(self, test_id: UUID) -> None:
        """Delete a test row; ON DELETE CASCADE drops its whole tree."""
        await self._session.execute(delete(LabSeriesTestOrm).where(LabSeriesTestOrm.id == test_id))
        self.debug(f"lab-series test {test_id} deleted (tree cascades)")

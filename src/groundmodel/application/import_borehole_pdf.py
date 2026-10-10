"""Use case: import the ticked boreholes of a triaged borehole-log PDF report.

The PDF twin of ``ImportBoreholeFile`` (a DOV XML file): the same ORM
builders, the same consented refresh, the same report shape. Each ticked
borehole is shaped by ``DigitisedBoreholeAdapter`` (header, ONE description
track with the printed text verbatim and no codes, the sample bars as drawn,
the water level) and stored with ``borehole.import_provenance`` stamped
``pdf-digitised``. Identity: the printed project code (``"PDF"`` when none) +
the printed borehole name.

Refused BEFORE anything is written (``BoreholePdfImportRefusedError``, the API
answers 422): a borehole the triage did not offer, a coordinate system outside
the supported list, an assumed CRS or water unit the user did not confirm
(owner rulings 2026-10-08, 3 and 4: "never silent"), two prints of one
borehole ticked together (ruling 5: the user withholds one, never merged).

Duplicates follow the CPT re-import rule: a borehole already in the project is
refreshed IN PLACE (same id) only with ``confirm_refresh``; without it
``BoreholeRefreshConfirmationRequiredError`` carries the old-vs-new diff and
NOTHING is written. A borehole the fresh read cannot place (no position, no
ground level) never replaces a stored one (``BoreholeRefreshRefusedError``).
A refresh keeps a manual elevation and a description track the engineer
edited by hand (his coding is the point of the track editor).

One commit per import: either every ticked borehole lands, or none does.
"""

from __future__ import annotations

import time
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.borehole_import_constants import (
    CRS_SCOPE_REPORT,
    FLAG_EDITED_TRACK_KEPT,
    NOT_IMPORTED_CODE,
    REFRESHED_HEADER_COLUMNS,
    REFUSED_CRS_UNSUPPORTED,
    REFUSED_NOT_OFFERED,
    REFUSED_REPEAT,
    REFUSED_UNCONFIRMED,
    SUPPORTED_BOREHOLE_PDF_EPSGS,
)
from groundmodel.application.borehole_pdf_import_request import BoreholePdfImportRequest
from groundmodel.application.dov_borehole_orm_builders import (
    build_borehole_orm,
    build_observation_layer_orms,
    build_observation_orm,
    build_sample_orm,
    refresh_file_samples,
)
from groundmodel.application.import_borehole_file_result import ImportBoreholeFileResult
from groundmodel.application.imported_boring import ImportedBoring
from groundmodel.application.stale_investigation_caches import StaleInvestigationCaches
from groundmodel.domain.value_objects.elevation_source import ElevationSource
from groundmodel.domain.value_objects.observation_type import ObservationType
from groundmodel.domain.value_objects.track_source import TrackSource
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.infrastructure.db.repositories.borehole_repository import (
    BoreholeRepository,
    borehole_full_tree_options,
)
from groundmodel.infrastructure.parsers.borehole.pdf.borehole_pdf_constants import (
    ISSUE_CRS_ASSUMED,
    ISSUE_WATER_UNIT_ASSUMED,
)
from groundmodel.infrastructure.parsers.borehole.pdf.cached_borehole_pdf_report import (
    CachedBoreholePdfReport,
)
from groundmodel.infrastructure.parsers.borehole.pdf.digitised_borehole import DigitisedBorehole
from groundmodel.infrastructure.parsers.borehole.pdf.digitised_borehole_adapter import (
    DigitisedBoreholeAdapter,
)
from groundmodel.infrastructure.parsers.borehole.pdf.pdf_borehole_import_entry import (
    PdfBoreholeImportEntry,
)
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_store import PdfReportStore
from groundmodel.infrastructure.parsers.validation.validation_issue import make_issue
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel
from groundmodel.shared.exceptions import (
    BoreholePdfImportRefusedError,
    BoreholeRefreshConfirmationRequiredError,
    BoreholeRefreshRefusedError,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger
from groundmodel.shared.timing import ms_since

_PDF_SOURCE = TrackSource.PDF_DIGITISED.value
_LITHO = ObservationType.LITHOLOGICAL_DESCRIPTION.value


class ImportBoreholePdf(GroundModelLogger):
    """Store the ticked boreholes of a triaged PDF borehole-log report.

    Parameters
    ----------
    session : AsyncSession
        Database session; committed once per import on success.
    store : PdfReportStore
        The borehole report store holding the triage.
    """

    def __init__(
        self, session: AsyncSession, store: PdfReportStore[CachedBoreholePdfReport]
    ) -> None:
        """Initialise with an active ``AsyncSession`` and the report store."""
        super().__init__(__name__)
        self._session = session
        self._store = store
        self._repo = BoreholeRepository(session)
        self._adapter = DigitisedBoreholeAdapter()

    async def execute(
        self,
        project_id: UUID,
        file_sha: str,
        requests: list[BoreholePdfImportRequest],
        *,
        confirm_refresh: bool = False,
    ) -> ImportBoreholeFileResult:
        """Import the requested boreholes of report ``file_sha`` into ``project_id``.

        Parameters
        ----------
        project_id : UUID
            The project to import into.
        file_sha : str
            SHA-256 hex of the triaged report.
        requests : list of BoreholePdfImportRequest
            The ticked boreholes with the user's confirmations.
        confirm_refresh : bool
            The user saw the diff and asked for the replacement of the
            boreholes already in the project.

        Returns
        -------
        ImportBoreholeFileResult
            One ``ImportedBoring`` per requested borehole, in request order.

        Raises
        ------
        CptPdfReportNotFoundError
            When the report is not triaged in this process.
        BoreholePdfImportRefusedError
            When a request cannot be honoured as asked (nothing written).
        BoreholeRefreshRefusedError
            When a borehole already in the project has a fresh read that
            cannot be stored.
        BoreholeRefreshConfirmationRequiredError
            When boreholes are already in the project and ``confirm_refresh``
            is False (nothing written).
        """
        t_total = time.perf_counter()
        report = self._store.require(project_id, file_sha)
        self.info(
            f"PDF borehole import: {len(requests)} borehole(s) of report {file_sha[:12]} "
            f"into project {project_id} (confirm_refresh={confirm_refresh})"
        )
        parsed = self._check_requests(report, requests)
        report_crs = next(
            (r for r in requests if r.crs_epsg is not None and r.crs_scope == CRS_SCOPE_REPORT),
            None,
        )
        entries = [self._entry(parsed[r.key], r, report_crs, report.file_name) for r in requests]
        self._check_repeats(entries)

        existing_ids: dict[tuple[str, str], UUID] = {}
        for source_project in sorted({e.project_id for e in entries}):
            found = await self._repo.find_existing_test_ids(
                source_project,
                [e.test_id for e in entries if e.project_id == source_project],
                project_id,
            )
            existing_ids.update({(source_project, t): i for t, i in found.items()})
        duplicates = [e for e in entries if (e.project_id, e.test_id) in existing_ids]
        self.info(
            f"PDF borehole import: {len(entries)} borehole(s), "
            f"{len(duplicates)} already in the project"
        )

        # The CPT rule's order: refuse an unusable read BEFORE asking for
        # consent; no confirmation may replace a good borehole with nothing.
        for entry in duplicates:
            if entry.blocked:
                self.warning(f"PDF borehole refresh refused for {entry.key}: nothing to store")
                raise BoreholeRefreshRefusedError(
                    "parse_errors",
                    f"The report's borehole {entry.name!r} has no position or no ground level, "
                    "so it cannot replace the stored borehole. Nothing was imported.",
                )
        stored = (
            await self._load_existing([existing_ids[(e.project_id, e.test_id)] for e in duplicates])
            if duplicates
            else {}
        )
        if duplicates and not confirm_refresh:
            diffs = [
                _diff(stored[existing_ids[(e.project_id, e.test_id)]], e)
                for e in duplicates
                if existing_ids[(e.project_id, e.test_id)] in stored
            ]
            self.info(f"PDF borehole import awaiting confirmation: {len(diffs)} refresh(es)")
            raise BoreholeRefreshConfirmationRequiredError(diffs)

        result = ImportBoreholeFileResult()
        written = 0
        for i, entry in enumerate(entries, 1):
            existing_id = existing_ids.get((entry.project_id, entry.test_id))
            if existing_id is not None and existing_id in stored:
                await self._refresh(stored[existing_id], entry)
                result.boreholes.append(
                    ImportedBoring(
                        borehole_id=existing_id,
                        name=entry.name,
                        test_id=entry.test_id,
                        issues=entry.issues,
                        refreshed=True,
                    )
                )
                written += 1
                self.debug(f"PDF borehole [{i}/{len(entries)}]: refreshed {existing_id}")
                continue
            outcome = await self._insert(entry, project_id)
            written += int(outcome.imported)
            result.boreholes.append(outcome)
            self.debug(
                f"PDF borehole [{i}/{len(entries)}]: "
                f"{'imported ' + str(outcome.borehole_id) if outcome.imported else 'skipped'}"
            )
        if written:
            await self._session.commit()
        n_refreshed = sum(1 for b in result.boreholes if b.refreshed)
        self.success(
            f"PDF borehole import done in {ms_since(t_total)} ms: "
            f"{written - n_refreshed} new, {n_refreshed} refreshed, "
            f"{sum(1 for b in result.boreholes if not b.imported)} skipped"
        )
        return result

    # ------------------------------------------------------------------
    # Checks (all before any write)
    # ------------------------------------------------------------------

    def _check_requests(
        self, report: CachedBoreholePdfReport, requests: list[BoreholePdfImportRequest]
    ) -> dict[str, DigitisedBorehole]:
        """Refuse keys not offered, unsupported systems and unconfirmed assumptions."""
        missing = [r.key for r in requests if r.key not in report.boreholes]
        if missing:
            self.warning(f"PDF borehole import refused: {len(missing)} key(s) not offered")
            raise BoreholePdfImportRefusedError(
                REFUSED_NOT_OFFERED,
                f"{', '.join(missing)}: not one of this report's parsed boreholes",
                [{"key": k, "name": k} for k in missing],
            )
        parsed = {r.key: report.boreholes[r.key] for r in requests}
        unsupported = [
            r
            for r in requests
            if r.crs_epsg is not None and r.crs_epsg not in SUPPORTED_BOREHOLE_PDF_EPSGS
        ]
        if unsupported:
            self.warning(f"PDF borehole import refused: unsupported EPSG {unsupported[0].crs_epsg}")
            raise BoreholePdfImportRefusedError(
                REFUSED_CRS_UNSUPPORTED,
                f"EPSG {unsupported[0].crs_epsg} is not a supported coordinate system "
                f"(supported: {', '.join(str(e) for e in SUPPORTED_BOREHOLE_PDF_EPSGS)})",
                [{"key": r.key, "name": parsed[r.key].header.name} for r in unsupported],
            )
        report_crs = any(
            r.crs_epsg is not None and r.crs_scope == CRS_SCOPE_REPORT for r in requests
        )
        unconfirmed: list[dict[str, object]] = []
        for request in requests:
            codes = {i.code for i in parsed[request.key].issues}
            open_codes: list[str] = []
            if ISSUE_CRS_ASSUMED in codes and request.crs_epsg is None and not report_crs:
                open_codes.append(ISSUE_CRS_ASSUMED)
            if ISSUE_WATER_UNIT_ASSUMED in codes and not request.water_unit_confirmed:
                open_codes.append(ISSUE_WATER_UNIT_ASSUMED)
            if open_codes:
                unconfirmed.append(
                    {
                        "key": request.key,
                        "name": parsed[request.key].header.name,
                        "codes": open_codes,
                    }
                )
        if unconfirmed:
            self.warning(
                f"PDF borehole import refused: {len(unconfirmed)} borehole(s) with an "
                "unconfirmed assumption"
            )
            raise BoreholePdfImportRefusedError(
                REFUSED_UNCONFIRMED,
                ", ".join(str(u["name"]) for u in unconfirmed)
                + ": an assumed coordinate system or water-level unit was not confirmed",
                unconfirmed,
            )
        return parsed

    def _check_repeats(self, entries: list[PdfBoreholeImportEntry]) -> None:
        """Refuse two ticked prints that would be stored as one borehole (ruling 5)."""
        seen: dict[tuple[str, str], str] = {}
        clashes: list[dict[str, object]] = []
        for entry in entries:
            identity = (entry.project_id, entry.test_id)
            if identity in seen:
                clashes.append({"key": entry.key, "name": entry.name, "other": seen[identity]})
            seen.setdefault(identity, entry.key)
        if clashes:
            self.warning(f"PDF borehole import refused: {len(clashes)} repeat print(s) ticked")
            raise BoreholePdfImportRefusedError(
                REFUSED_REPEAT,
                ", ".join(str(c["name"]) for c in clashes)
                + ": printed more than once in the report; tick one print only",
                clashes,
            )

    def _entry(
        self,
        borehole: DigitisedBorehole,
        request: BoreholePdfImportRequest,
        report_crs: BoreholePdfImportRequest | None,
        file_name: str,
    ) -> PdfBoreholeImportEntry:
        """Shape one borehole with the system and the confirmations that apply to it."""
        confirmed_by = request if request.crs_epsg is not None else report_crs
        epsg = borehole.header.epsg
        crs: dict[str, object] | None = None
        if borehole.header.crs_assumed and confirmed_by is not None:
            # The printed X/Y stay; the system is the one the user confirmed.
            epsg = confirmed_by.crs_epsg
            crs = {"epsg": confirmed_by.crs_epsg, "scope": confirmed_by.crs_scope}
        confirmations = {
            "crs": crs,
            "water_unit_confirmed": bool(request.water_unit_confirmed),
        }
        self.debug(f"PDF borehole {request.key} of {file_name!r}: epsg {epsg}, {confirmations}")
        return self._adapter.adapt(borehole, epsg=epsg, confirmations=confirmations)

    # ------------------------------------------------------------------
    # Writes
    # ------------------------------------------------------------------

    async def _insert(self, entry: PdfBoreholeImportEntry, app_project_id: UUID) -> ImportedBoring:
        """Persist a NEW borehole (no flush); skip it when nothing can be stored."""
        if entry.blocked or entry.borehole is None:
            entry.issues.append(
                make_issue(
                    ValidationLevel.ERROR,
                    NOT_IMPORTED_CODE,
                    f"{entry.name}: not imported, the borehole has no usable position or "
                    "ground level",
                )
            )
            self.warning(f"PDF borehole {entry.key}: skipped (nothing to store)")
            return ImportedBoring(
                borehole_id=None,
                name=entry.name,
                test_id=entry.test_id,
                issues=entry.issues,
                imported=False,
            )
        orm = build_borehole_orm(
            entry.borehole.borehole,
            entry.borehole,
            borehole_id=entry.borehole_key,
            test_id=entry.test_id,
            app_project_id=app_project_id,
            project_id=entry.project_id,
            elevation_source=ElevationSource.PDF,
        )
        orm.import_provenance = entry.provenance
        await self._repo.save(orm, flush=False)
        if entry.observation is not None:
            track = build_observation_orm(entry.observation, None, borehole_id=orm.id)
            if track is not None:
                track.source = _PDF_SOURCE
                self._session.add(track)
        for sample in entry.samples:
            row = build_sample_orm(sample, orm.id)
            row.sample_label = entry.sample_labels.get(sample.sample_key)
            self._session.add(row)
        return ImportedBoring(
            borehole_id=orm.id, name=entry.name, test_id=entry.test_id, issues=entry.issues
        )

    async def _refresh(self, existing: BoreholeOrm, entry: PdfBoreholeImportEntry) -> None:
        """Overwrite a stored borehole from the report, keeping its id.

        Header columns take the fresh value when it has one; the elevation
        unless the engineer set it by hand; the provenance is replaced. The
        report's description track is replaced IN PLACE (same observation id)
        unless the engineer edited it, which is kept with a notice. Samples
        match by number + top depth (updated in place) or are added.
        """
        t_refresh = time.perf_counter()
        assert entry.borehole is not None  # blocked entries were refused above
        fresh = entry.borehole.borehole
        for column in REFRESHED_HEADER_COLUMNS:
            value = getattr(fresh, column)
            if value is not None:
                setattr(existing, column, value)
        if existing.elevation_source == ElevationSource.MANUAL.value:
            self.info(
                f"PDF borehole refresh {existing.id}: keeping the manual elevation "
                f"{existing.elevation_m} m (report says {fresh.elevation_m} m)"
            )
        elif fresh.elevation_m is not None:
            existing.elevation_m = fresh.elevation_m
            existing.z_epsg = fresh.z_epsg
            existing.elevation_source = ElevationSource.PDF.value
        existing.import_provenance = entry.provenance

        tracks = [
            o
            for o in existing.observations
            if o.source == _PDF_SOURCE and o.observation_type == _LITHO
        ]
        track_outcome = self._refresh_track(existing, tracks, entry)

        before = {id(s) for s in existing.samples}
        written = refresh_file_samples(existing, entry.samples)
        for sample, row in zip(entry.samples, written, strict=True):
            row.sample_label = entry.sample_labels.get(sample.sample_key)
        n_refreshed = sum(1 for row in written if id(row) in before)

        stale = await StaleInvestigationCaches(self._session).execute(borehole_id=existing.id)
        self.info(
            f"PDF borehole refresh {existing.id}: track {track_outcome}, {n_refreshed} "
            f"sample(s) refreshed, {len(written) - n_refreshed} added, {stale.surfaces} "
            f"surface(s) + {stale.solids} solid(s) staled in {ms_since(t_refresh)} ms"
        )

    def _refresh_track(
        self,
        existing: BoreholeOrm,
        tracks: list[ObservationOrm],
        entry: PdfBoreholeImportEntry,
    ) -> str:
        """Replace the report's description track; keep it when edited by hand."""
        if entry.observation is None:
            return "kept (the fresh read has no layers)"
        if any(t.edited_manually_at is not None for t in tracks):
            entry.issues.append(
                make_issue(
                    ValidationLevel.INFO,
                    FLAG_EDITED_TRACK_KEPT,
                    f"{entry.name}: the description track was edited by hand; it was kept and "
                    "the report's description was not written over it",
                )
            )
            return "kept (edited by hand)"
        if tracks:
            track = tracks[0]
            track.observation_date = entry.observation.observation_date
            track.layers = build_observation_layer_orms(entry.observation)
            return "replaced"
        track_orm = build_observation_orm(entry.observation, None, borehole_id=existing.id)
        if track_orm is None:
            return "kept (the fresh read has no layers)"
        track_orm.source = _PDF_SOURCE
        existing.observations.append(track_orm)
        return "added"

    async def _load_existing(self, ids: list[UUID]) -> dict[UUID, BoreholeOrm]:
        """Load the stored boreholes a refresh touches, with every child eager-loaded."""
        rows = await self._session.execute(
            select(BoreholeOrm)
            .where(BoreholeOrm.id.in_(ids))
            .options(*borehole_full_tree_options())
        )
        return {orm.id: orm for orm in rows.scalars().unique()}


def _diff(existing: BoreholeOrm, entry: PdfBoreholeImportEntry) -> dict[str, object]:
    """Build the old-vs-new diff one borehole shows in the confirmation dialog.

    The keys of the XML file import's diff, so the desktop's
    ``BoreholeRefreshConfirmDialog`` reads both.
    """
    old_layers = [len(o.layers) for o in existing.observations if o.observation_type == _LITHO]
    fresh = entry.borehole.borehole if entry.borehole is not None else None
    return {
        "borehole_id": str(existing.id),
        "name": entry.name,
        "test_id": entry.test_id,
        "old_total_depth_m": existing.total_depth_m,
        "new_total_depth_m": fresh.total_depth_m if fresh is not None else None,
        "old_n_litho_layers": max(old_layers) if old_layers else 0,
        "new_n_litho_layers": entry.n_layers,
        "n_errors": sum(1 for i in entry.issues if i.level == ValidationLevel.ERROR),
        "n_warnings": sum(1 for i in entry.issues if i.level == ValidationLevel.WARNING),
    }

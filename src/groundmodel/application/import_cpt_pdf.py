"""ImportCptPdf: store the soundings the user ticked in a triaged PDF report."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import TypeVar
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.digitise_cpt_pdf_sounding import DigitiseCptPdfSounding
from groundmodel.application.import_cpt import ImportCpt
from groundmodel.application.import_cpt_result import ImportCptResult
from groundmodel.application.pdf_sounding_import_outcome import PdfSoundingImportOutcome
from groundmodel.application.pdf_sounding_import_request import PdfSoundingImportRequest
from groundmodel.domain.services.cpt_display_name import cpt_display_name
from groundmodel.infrastructure.parsers.cpt.gef.gef_parse_result import GEFParseResult
from groundmodel.infrastructure.parsers.cpt.pdf.cached_pdf_report import CachedPdfReport
from groundmodel.infrastructure.parsers.cpt.pdf.digitised_sounding_adapter import (
    DigitisedSoundingAdapter,
)
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import PDF_FALLBACK_PROJECT_ID
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_import_header import PdfImportHeader
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_identity import PdfReportIdentity
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_store import PdfReportStore
from groundmodel.infrastructure.parsers.cpt.pdf.report_sounding import ReportSounding
from groundmodel.shared.exceptions import (
    CptRefreshConfirmationRequiredError,
    CptRefreshRefusedError,
    ParseError,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

_T = TypeVar("_T")

#: The ``ImportCpt.persist`` shape this use case needs (tests pass a fake).
Persist = Callable[..., Awaitable[ImportCptResult]]


class ImportCptPdf(GroundModelLogger):
    """Use case: import ticked soundings of a triaged report, one CPT each.

    Each sounding is read through the calibration the user settled on,
    adapted to a ``GEFParseResult`` and handed to ``ImportCpt.persist`` -- the
    one door every CPT source goes through, so the coordinate guard, the
    duplicate key (campaign code + sounding id) and the refresh CONSENT are
    the GEF import's own. A sounding already in the project is never
    overwritten without ``confirm_refresh``; its outcome carries the
    old-vs-new diff instead, and the dialog asks one sounding at a time.

    Each sounding commits on its own: a failure halfway leaves the soundings
    before it imported and says which one failed.

    Parameters
    ----------
    session : AsyncSession
        The request's session.
    store : PdfReportStore
        Holds the triaged report.
    persist : callable or None
        ``ImportCpt(session).persist`` unless given (tests pass a fake).
    """

    def __init__(
        self,
        session: AsyncSession,
        store: PdfReportStore[CachedPdfReport],
        persist: Persist | None = None,
    ) -> None:
        super().__init__(__name__)
        self._session = session
        self._store = store
        self._persist: Persist = persist or ImportCpt(session).persist
        self._digitise = DigitiseCptPdfSounding(store)
        self._adapter = DigitisedSoundingAdapter()

    async def execute(
        self,
        project_id: UUID,
        file_sha: str,
        requests: list[PdfSoundingImportRequest],
        confirm_refresh: bool,
    ) -> list[PdfSoundingImportOutcome]:
        """Import the requested soundings; return one outcome each, in order.

        Parameters
        ----------
        project_id : UUID
            The project to import into.
        file_sha : str
            SHA-256 hex of the triaged report.
        requests : list of PdfSoundingImportRequest
            The ticked soundings and the user's edits.
        confirm_refresh : bool
            The user consented to replacing these soundings where they already
            exist (the dialog re-posts only the ones he agreed to).

        Returns
        -------
        list of PdfSoundingImportOutcome
            Per sounding: imported / refreshed / confirmation_required /
            refused / failed.

        Raises
        ------
        CptPdfReportNotFoundError
            When the report is not triaged in this process.
        """
        report = self._store.require(project_id, file_sha)
        total = len(requests)
        self.info(
            "PDF import: %d sounding(s) of report %s into project %s (confirm_refresh=%s)",
            total,
            file_sha[:12],
            project_id,
            confirm_refresh,
        )
        outcomes: list[PdfSoundingImportOutcome] = []
        for i, request in enumerate(requests, start=1):
            outcome = await self._import_one(project_id, report, request, confirm_refresh)
            self.info("[%d/%d] sounding %s: %s", i, total, request.key, outcome.status)
            outcomes.append(outcome)
        counts = {
            s: sum(1 for o in outcomes if o.status == s) for s in {o.status for o in outcomes}
        }
        self.success("PDF import done: %s", counts)
        return outcomes

    async def _import_one(
        self,
        project_id: UUID,
        report: CachedPdfReport,
        request: PdfSoundingImportRequest,
        confirm_refresh: bool,
    ) -> PdfSoundingImportOutcome:
        """Import one sounding and translate every refusal into an outcome."""
        listed = report.digest.sounding(request.key)
        if listed is None:
            # Desk-study reprints and repeated sheets are never listed, so
            # asking for one by id imports nothing (owner answer 2).
            return PdfSoundingImportOutcome(
                key=request.key,
                status="refused",
                name=request.key,
                code="pdf_sounding_not_offered",
                message=f"{request.key} is not one of this report's own soundings",
            )
        try:
            result = await asyncio.to_thread(self._parse, project_id, report, listed, request)
        except (ValueError, KeyError) as exc:
            self.warning("sounding %s not read: %s", request.key, exc)
            return PdfSoundingImportOutcome(
                key=request.key,
                status="failed",
                name=listed.sounding_id or request.key,
                code="pdf_sounding_unreadable",
                message=str(exc),
            )
        name = _display_name(result.header.project_id, result.header.test_id)
        if any(i.code == "PDF_NO_XY" for i in result.issues):
            return PdfSoundingImportOutcome(
                key=request.key,
                status="refused",
                name=name,
                issues=result.issues,
                code="pdf_no_xy",
                message=f"{name}: the sheet prints no position; type X and Y to import it",
            )
        try:
            saved = await self._persist(result, name, project_id, confirm_refresh=confirm_refresh)
        except CptRefreshConfirmationRequiredError as exc:
            return PdfSoundingImportOutcome(
                key=request.key,
                status="confirmation_required",
                name=name,
                cpt_id=exc.existing_id,
                issues=result.issues,
                code="cpt_refresh_confirmation_required",
                message=str(exc),
                diff={
                    "name": exc.name,
                    "old_max_depth_m": exc.old_max_depth_m,
                    "new_max_depth_m": exc.new_max_depth_m,
                    "old_n_rows": exc.old_n_rows,
                    "new_n_rows": exc.new_n_rows,
                    "n_errors": exc.n_errors,
                    "n_warnings": exc.n_warnings,
                },
            )
        except CptRefreshRefusedError as exc:
            await self._session.rollback()
            return PdfSoundingImportOutcome(
                key=request.key,
                status="refused",
                name=name,
                issues=result.issues,
                code="cpt_refresh_refused",
                message=str(exc),
            )
        except ParseError as exc:
            await self._session.rollback()
            return PdfSoundingImportOutcome(
                key=request.key,
                status="failed",
                name=name,
                issues=result.issues,
                code="pdf_import_refused",
                message=str(exc),
            )
        return PdfSoundingImportOutcome(
            key=request.key,
            status="refreshed" if saved.refreshed else "imported",
            name=name,
            cpt_id=saved.cpt_id,
            issues=result.issues,
        )

    def _parse(
        self,
        project_id: UUID,
        report: CachedPdfReport,
        listed: ReportSounding,
        request: PdfSoundingImportRequest,
    ) -> GEFParseResult:
        """Read the sounding through its calibration and adapt it (worker thread)."""
        sounding = self._digitise.sounding(
            project_id,
            report.digest.file_sha,
            request.key,
            request.calibrations,
            request.ground_level_m,
        )
        header = _header(listed, request, report.digest.report_code)
        identity = PdfReportIdentity(
            file_name=report.file_name,
            file_sha=report.digest.file_sha,
            ocr_available=report.digest.ocr_available,
        )
        return self._adapter.to_parse_result(sounding, header, identity)


def _display_name(project_id: str, test_id: str) -> str:
    """Return the name the CPT is shown under ("23.15-002-S110").

    The "PDF" stand-in project id names no project, so it never prefixes a
    sounding number.
    """
    return cpt_display_name("" if project_id == PDF_FALLBACK_PROJECT_ID else project_id, test_id)


def _pick(name: str, typed: _T | None, printed: _T | None, sources: dict[str, str]) -> _T | None:
    """Return the typed value when there is one, else the printed one; note which."""
    if typed is not None:
        sources[name] = "user"
        return typed
    if printed is not None:
        sources[name] = "sheet"
    return printed


def _header(
    listed: ReportSounding, request: PdfSoundingImportRequest, report_code: str | None
) -> PdfImportHeader:
    """Combine the sheet's header with what the user typed (typed values win).

    Every field is taken on its own: a typed value replaces the printed one
    (owner finding 2026-10-08: a sheet that prints a wrong Y is corrected by
    typing only the Y), an untyped field keeps what the sheet printed, and
    ``sources`` names the origin of each. A position needs both X and Y: when
    only half of one results (the sheet printed none and the user typed one
    coordinate), the sounding has no position at all.
    """
    sources: dict[str, str] = {}
    typed_project = (request.project_number or "").strip() or None
    if typed_project is not None:
        sources["project_id"] = "user"
    x = _pick("x", request.x, listed.x, sources)
    y = _pick("y", request.y, listed.y, sources)
    epsg = _pick("epsg", request.epsg, listed.epsg, sources)
    if x is None or y is None:
        # Half a position is no position.
        x = y = epsg = None
        for name in ("x", "y", "epsg"):
            sources.pop(name, None)
    header = PdfImportHeader(
        # The ids a GEF of the same sounding carries (owner ruling 2026-10-04):
        # the sheet's project number, so a later GEF import is matched as the
        # same CPT. A typed number (the dialog's "Projectnummer", ruling
        # 2026-10-05 a) wins; the campaign code stands in when neither exists.
        test_id=listed.sounding_id or listed.key,
        project_id=typed_project or listed.project_id or report_code or PDF_FALLBACK_PROJECT_ID,
        x=x,
        y=y,
        epsg=epsg,
        ground_level_m=_pick(
            "ground_level_m", request.ground_level_m, listed.ground_level_m, sources
        ),
        z_epsg=listed.z_epsg,
        test_date=_pick("test_date", request.test_date, listed.test_date, sources),
        sources=sources,
    )
    if sources.get("ground_level_m") == "sheet" and listed.ground_level_source is not None:
        # Not printed as such: derived from the sheet (a printed table's level
        # + depth); the provenance says from what.
        sources["ground_level_m"] = listed.ground_level_source
    return header

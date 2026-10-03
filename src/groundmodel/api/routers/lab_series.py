"""Raw lab-series routes: preview + import a lab export, list and read the tests.

* ``POST /lab-series/preview`` — parse one file, propose the borehole and the
  sample, write nothing.
* ``POST /lab-series/import`` — store the readings on the confirmed (or a new)
  sample; 201 new, 200 refreshed / unchanged, 409 until a refresh is
  consented, 422 when the file may not replace stored data.
* ``GET /lab-series?project_id&borehole_id`` — the borehole's tests with
  counts (no readings) for the Lab tests list.
* ``GET /samples/{sample_id}/lab-series?project_id`` — every test of a sample
  with every channel, for the viewer.

Every route is project-scoped (the scope runs sample → borehole → project).
"""

from __future__ import annotations

from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Response, UploadFile, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.api.routers._helpers import spool_upload
from groundmodel.api.schemas.lab_series.lab_series_channel_response import (
    LabSeriesChannelResponse,
)
from groundmodel.api.schemas.lab_series.lab_series_import_response import (
    LabSeriesImportResponse,
)
from groundmodel.api.schemas.lab_series.lab_series_lab_result_response import (
    LabSeriesLabResultResponse,
)
from groundmodel.api.schemas.lab_series.lab_series_preview_response import (
    LabSeriesPreviewResponse,
)
from groundmodel.api.schemas.lab_series.lab_series_specimen_response import (
    LabSeriesSpecimenResponse,
)
from groundmodel.api.schemas.lab_series.lab_series_stage_response import (
    LabSeriesStageResponse,
)
from groundmodel.api.schemas.lab_series.lab_series_test_response import LabSeriesTestResponse
from groundmodel.api.schemas.lab_series.lab_series_test_summary_response import (
    LabSeriesTestSummaryResponse,
)
from groundmodel.application.import_lab_series_file import ImportLabSeriesFile
from groundmodel.application.lab_series_constants import (
    LAB_SERIES_MAX_UPLOAD_BYTES,
    LAB_SERIES_UPLOAD_SUFFIXES,
)
from groundmodel.infrastructure.db.models.lab_series_test_orm import LabSeriesTestOrm
from groundmodel.infrastructure.db.repositories.lab_series_repository import (
    LabSeriesRepository,
)
from groundmodel.infrastructure.db.session import get_session
from groundmodel.shared.exceptions import (
    LabBoreholeConflictError,
    LabFileFormatNotRecognisedError,
    LabSeriesImportRefusedError,
    LabSeriesRefreshConfirmationRequiredError,
    LabSeriesRefreshRefusedError,
    NotFoundError,
    ParseError,
)
from groundmodel.shared.logging.logger_factory import LoggerFactory

# Routers are functions, not classes: the documented fallback is one
# module-level logger via LoggerFactory (as in cpt.py).
logger = LoggerFactory.get_logger(__name__)

router = APIRouter(tags=["lab-series"])


@router.post("/lab-series/preview", response_model=LabSeriesPreviewResponse)
async def preview_lab_series(
    file: UploadFile,
    project_id: UUID = Form(...),
    borehole_id: UUID | None = Form(None),
    session: AsyncSession = Depends(get_session),
) -> LabSeriesPreviewResponse:
    """Parse one lab file and propose where it goes — nothing is written.

    Parameters
    ----------
    file : UploadFile
        A raw lab export (``.txt`` / ``.csv`` / ``.dat``; the kind is read
        from the content).
    project_id : UUID
        The app project.
    borehole_id : UUID or None
        The borehole the user picked, to list ITS samples; ``None`` = propose.
    session : AsyncSession
        Injected database session.

    Returns
    -------
    LabSeriesPreviewResponse
        Identity, borehole and sample proposals, existing-test state, findings.

    Raises
    ------
    HTTPException
        400 unreadable file, or ``lab_file_format_not_recognised`` for a
        format Strix does not read; 404 borehole not in the project;
        409 ``lab_borehole_conflict`` when the borehole write clashed with a
        stored row (session rolled back); 413 upload too large.
    """
    logger.info(f"POST /lab-series/preview: file={file.filename!r} project={project_id}")
    path = await _spool(file)
    try:
        preview = await ImportLabSeriesFile(session).preview(
            path, project_id, file_name=file.filename or path.name, borehole_id=borehole_id
        )
    except LabFileFormatNotRecognisedError as exc:
        raise _format_not_recognised(exc) from exc
    except ParseError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except LabBoreholeConflictError as exc:
        raise await _borehole_conflict(session, exc.borehole_name, str(exc)) from exc
    except IntegrityError as exc:
        # Backstop (owner dogfeed 2026-10-03): a clash the use case did not
        # name must still not reach the generic 500 handler.
        name = file.filename or path.name
        raise await _borehole_conflict(
            session,
            None,
            f"{name}: the borehole for this file was stored by another request at the "
            "same moment. Open the preview again.",
            orig=exc.orig,
        ) from exc
    finally:
        path.unlink(missing_ok=True)
    return LabSeriesPreviewResponse(**preview.__dict__)


@router.post(
    "/lab-series/import",
    response_model=LabSeriesImportResponse,
    status_code=status.HTTP_201_CREATED,
)
async def import_lab_series(
    file: UploadFile,
    response: Response,
    project_id: UUID = Form(...),
    borehole_id: UUID = Form(...),
    sample_id: UUID | None = Form(None),
    create_sample: bool = Form(False),
    sample_depth_top_m: float | None = Form(None),
    sample_depth_base_m: float | None = Form(None),
    confirm_refresh: bool = Form(False),
    session: AsyncSession = Depends(get_session),
) -> LabSeriesImportResponse:
    """Store a lab file's readings on the confirmed (or a new) sample.

    Parameters
    ----------
    file : UploadFile
        A raw lab export.
    response : Response
        Injected so a refresh / no-op answers 200 instead of 201.
    project_id, borehole_id : UUID
        The app project and the confirmed borehole.
    sample_id : UUID or None
        The existing sample to attach to.
    create_sample : bool
        Create a new sample instead (lab interval unless overridden).
    sample_depth_top_m, sample_depth_base_m : float or None
        The new sample's interval when the user entered one.
    confirm_refresh : bool
        The user agreed to replace a stored test with the same identity.
    session : AsyncSession
        Injected database session.

    Returns
    -------
    LabSeriesImportResponse
        The stored test and what happened.

    Raises
    ------
    HTTPException
        400 unreadable file, or ``lab_file_format_not_recognised``;
        404 borehole / sample not in the project;
        409 refresh awaits confirmation (nothing written); 413 too large;
        422 sample choice refused or refresh refused (ERROR findings).
    """
    logger.info(
        f"POST /lab-series/import: file={file.filename!r} project={project_id} "
        f"borehole={borehole_id} sample={sample_id} create={create_sample} "
        f"confirm={confirm_refresh}"
    )
    path = await _spool(file)
    try:
        result = await ImportLabSeriesFile(session).execute(
            path,
            project_id,
            borehole_id=borehole_id,
            file_name=file.filename or path.name,
            sample_id=sample_id,
            create_sample=create_sample,
            sample_depth_top_m=sample_depth_top_m,
            sample_depth_base_m=sample_depth_base_m,
            confirm_refresh=confirm_refresh,
        )
    except LabFileFormatNotRecognisedError as exc:
        raise _format_not_recognised(exc) from exc
    except ParseError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except LabSeriesRefreshConfirmationRequiredError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "lab_series_refresh_confirmation_required",
                "test_id": str(exc.existing_id),
                "message": str(exc),
                **exc.diff,
            },
        ) from exc
    except LabSeriesRefreshRefusedError as exc:
        logger.warning(f"POST /lab-series/import: refresh refused ({exc.reason}) — {exc}")
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "lab_series_refresh_refused",
                "reason": exc.reason,
                "message": str(exc),
            },
        ) from exc
    except LabSeriesImportRefusedError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": exc.code, "message": str(exc)},
        ) from exc
    finally:
        path.unlink(missing_ok=True)

    if result.refreshed or result.unchanged:
        response.status_code = status.HTTP_200_OK
    return LabSeriesImportResponse(**result.__dict__)


@router.get("/lab-series", response_model=list[LabSeriesTestSummaryResponse])
async def list_lab_series_for_borehole(
    project_id: UUID = Query(...),
    borehole_id: UUID = Query(...),
    session: AsyncSession = Depends(get_session),
) -> list[LabSeriesTestSummaryResponse]:
    """List a borehole's lab-series tests with counts (no readings).

    Parameters
    ----------
    project_id, borehole_id : UUID
        Scope and borehole.
    session : AsyncSession
        Injected database session.

    Returns
    -------
    list[LabSeriesTestSummaryResponse]
        Tests ordered by sample depth; empty for a foreign / unknown borehole.
    """
    rows = await LabSeriesRepository(session).list_summaries_for_borehole(borehole_id, project_id)
    logger.debug(f"GET /lab-series: borehole {borehole_id} → {len(rows)} test(s)")
    out: list[LabSeriesTestSummaryResponse] = []
    for test, sample in rows:
        levels = [i.get("level") for i in test.import_issues or []]
        out.append(
            LabSeriesTestSummaryResponse(
                id=test.id,
                sample_id=sample.id,
                sample_depth_top_m=sample.depth_top_m,
                sample_depth_base_m=sample.depth_base_m,
                sample_number=sample.sample_number,
                kind=test.kind,
                test_type_token=test.test_type_token,
                lab_sample_number=test.lab_sample_number,
                source_file_name=test.source_file_name,
                n_specimens=test.n_specimens,
                n_stages=sum(len(sp.stages) for sp in test.specimens),
                n_readings=sum(sp.n_points for sp in test.specimens),
                n_warnings=levels.count("warning"),
                n_errors=levels.count("error"),
            )
        )
    return out


@router.get("/samples/{sample_id}/lab-series", response_model=list[LabSeriesTestResponse])
async def get_sample_lab_series(
    sample_id: UUID,
    project_id: UUID = Query(...),
    session: AsyncSession = Depends(get_session),
) -> list[LabSeriesTestResponse]:
    """Every lab-series test of a sample, with every channel's values.

    Parameters
    ----------
    sample_id : UUID
        The sample.
    project_id : UUID
        Scope fence: a sample of another project answers 404.
    session : AsyncSession
        Injected database session.

    Returns
    -------
    list[LabSeriesTestResponse]
        The tests (possibly empty for a sample without lab-series tests).

    Raises
    ------
    HTTPException
        404 when the sample is not in the project.
    """
    repo = LabSeriesRepository(session)
    if await repo.get_sample(sample_id, project_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sample not found")
    tests = await repo.list_full_for_sample(sample_id, project_id)
    logger.debug(f"GET /samples/{sample_id}/lab-series → {len(tests)} test(s)")
    return [_test_response(t) for t in tests]


# ---------------------------------------------------------------------------
# Module-private helpers
# ---------------------------------------------------------------------------


async def _spool(file: UploadFile) -> Path:
    """Check the extension and stream the upload to a temp file."""
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in LAB_SERIES_UPLOAD_SUFFIXES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Unsupported file type '{suffix}'. Supported: "
                f"{', '.join(sorted(LAB_SERIES_UPLOAD_SUFFIXES))}"
            ),
        )
    return await spool_upload(
        file, suffix=suffix, max_bytes=LAB_SERIES_MAX_UPLOAD_BYTES, label="Lab file"
    )


async def _borehole_conflict(
    session: AsyncSession, borehole_name: str | None, message: str, *, orig: object = None
) -> HTTPException:
    """409 ``lab_borehole_conflict`` after rolling the request's session back.

    Parameters
    ----------
    session : AsyncSession
        The request's session (left usable for the dependency's teardown).
    borehole_name : str or None
        The clashing borehole when the use case named it.
    message : str
        The human-readable answer.
    orig : object
        The driver error behind a raw ``IntegrityError`` (logged only).

    Returns
    -------
    HTTPException
        The 409 to raise.
    """
    await session.rollback()
    logger.warning(
        f"POST /lab-series/preview: 409 lab_borehole_conflict "
        f"(borehole={borehole_name!r}, cause={orig!r}) — {message}"
    )
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "code": LabBoreholeConflictError.CODE,
            "borehole_name": borehole_name,
            "message": message,
        },
    )


def _format_not_recognised(exc: LabFileFormatNotRecognisedError) -> HTTPException:
    """400 with the stable code the desktop translates (owner ruling 2026-09-30)."""
    logger.warning(f"lab file {exc.file_name!r}: format not recognised")
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail={"code": exc.CODE, "message": str(exc), "file_name": exc.file_name},
    )


def _test_response(test: LabSeriesTestOrm) -> LabSeriesTestResponse:
    """Map one ORM tree onto the response (channel arrays under ``values``)."""
    return LabSeriesTestResponse(
        id=test.id,
        sample_id=test.sample_id,
        kind=test.kind,
        test_type_token=test.test_type_token,
        standard_token=test.standard_token,
        lab_job_number=test.lab_job_number,
        lab_sample_number=test.lab_sample_number,
        lab_borehole_name=test.lab_borehole_name,
        lab_sequence_number=test.lab_sequence_number,
        sampling_depth_top_m=test.sampling_depth_top_m,
        sampling_depth_base_m=test.sampling_depth_base_m,
        visual_description=test.visual_description,
        test_start_date=test.test_start_date,
        source_format=test.source_format,
        source_file_name=test.source_file_name,
        source_native_file=test.source_native_file,
        source_program_version=test.source_program_version,
        source_header=test.source_header or {},
        import_issues=test.import_issues or [],
        n_specimens=test.n_specimens,
        specimens=[
            LabSeriesSpecimenResponse(
                specimen_label=sp.specimen_label,
                initial_height_mm=sp.initial_height_mm,
                initial_diameter_mm=sp.initial_diameter_mm,
                initial_wet_mass_g=sp.initial_wet_mass_g,
                dry_mass_g=sp.dry_mass_g,
                initial_water_content_pct=sp.initial_water_content_pct,
                grain_density_t_m3=sp.grain_density_t_m3,
                grain_density_note=sp.grain_density_note,
                specimen_depth_top_m=sp.specimen_depth_top_m,
                specimen_depth_base_m=sp.specimen_depth_base_m,
                strain_rate_mm_per_min=sp.strain_rate_mm_per_min,
                consolidation_stress_kpa=sp.consolidation_stress_kpa,
                consolidation_volume_change_cm3=sp.consolidation_volume_change_cm3,
                failure_description=sp.failure_description,
                apparatus_id=sp.apparatus_id,
                lever_ratio=sp.lever_ratio,
                dial_coefficient_mm_per_unit=sp.dial_coefficient_mm_per_unit,
                mounting_date=sp.mounting_date,
                source_header=sp.source_header or {},
                n_points=sp.n_points,
                stages=[
                    LabSeriesStageResponse(
                        stage_index=st.stage_index,
                        stage_kind=st.stage_kind,
                        direction_token=st.direction_token,
                        hanger_load_kg=st.hanger_load_kg,
                        target_stress_kpa=st.target_stress_kpa,
                        height_at_start_mm=st.height_at_start_mm,
                        lab_stage_settlement_mm=st.lab_stage_settlement_mm,
                        lab_coefficient_label=st.lab_coefficient_label,
                        lab_coefficient=st.lab_coefficient,
                        started_at=st.started_at,
                        reading_timestamps=st.reading_timestamps,
                        point_numbers=st.point_numbers,
                        rezero_indices=st.rezero_indices or [],
                        n_readings=st.n_readings,
                        channels=[
                            LabSeriesChannelResponse(
                                channel_key=ch.channel_key,
                                source_label=ch.source_label,
                                unit=ch.unit,
                                provenance=ch.provenance,
                                values=ch.series_values,
                                formula=ch.formula,
                                derivation_inputs=ch.derivation_inputs,
                            )
                            for ch in st.channels
                        ],
                    )
                    for st in sp.stages
                ],
            )
            for sp in test.specimens
        ],
        lab_results=[
            LabSeriesLabResultResponse(
                specimen_label=r.specimen_label,
                stage_index=r.stage_index,
                parameter=r.parameter,
                value_numeric=r.value_numeric,
                value_text=r.value_text,
                unit=r.unit,
                provenance=r.provenance,
            )
            for r in test.lab_results
        ],
    )

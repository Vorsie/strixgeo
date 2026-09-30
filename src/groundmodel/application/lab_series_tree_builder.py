"""Turn a parsed raw lab export into a ``LabSeriesTestOrm`` tree (pure, no DB).

One builder for the three exports: the incremental-loading oedometer control listing and
the newer module's raw dump (both :class:`OedometerListingResult`) and the
triaxial per-point dump (:class:`TriaxialDumpResult`). The tree is transient;
the import use case attaches it to a sample and adds it to the session.

What the builder stores (owner rules 2026-09-28 / 29):

* every reading as a channel value — nothing thinned, nothing repaired; the
  re-zero duplicate stays but is marked (``rezero_indices``);
* measured columns as ``measured``, the lab software's per-reading columns as
  ``lab_derived``, the lab's summary values as ``lab_reported`` rows;
* ONE Strix computation: the oedometer vertical strain delta_h / h0
  (``derived``, formula and h0 recorded) — the owner asked for it.
"""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

from uuid6 import uuid7

from groundmodel.application.lab_series_constants import (
    OED_CHANNELS,
    OED_LAB_SUMMARY_FIELDS,
    STAGE_KIND_LOAD_STEP,
    STAGE_KIND_SHEAR,
    TX_BEFORE_AFTER_HEADER_LABEL,
    TX_BEFORE_AFTER_LABELS,
    TX_CHANNEL_UNITS,
    TX_DEFAULT_PHASES,
    TX_SINGLE_TEXT_LABELS,
    TX_UNCLASSIFIED_KEY_PREFIX,
    TX_UNCLASSIFIED_PROVENANCE,
)
from groundmodel.domain.models.lab.lab_series_kind import LabSeriesKind
from groundmodel.domain.models.lab.series_provenance import SeriesProvenance
from groundmodel.domain.services.oedometer_vertical_strain import vertical_strain
from groundmodel.domain.services.oedometer_vertical_strain_constants import (
    VERTICAL_STRAIN_CHANNEL_KEY,
    VERTICAL_STRAIN_FORMULA,
    VERTICAL_STRAIN_UNIT,
)
from groundmodel.infrastructure.db.models.lab_series_channel_orm import LabSeriesChannelOrm
from groundmodel.infrastructure.db.models.lab_series_lab_result_orm import (
    LabSeriesLabResultOrm,
)
from groundmodel.infrastructure.db.models.lab_series_specimen_orm import LabSeriesSpecimenOrm
from groundmodel.infrastructure.db.models.lab_series_stage_orm import LabSeriesStageOrm
from groundmodel.infrastructure.db.models.lab_series_test_orm import LabSeriesTestOrm
from groundmodel.infrastructure.parsers.lab.raw_export.lab_export_constants import (
    LAB_EXPORT_FORMAT_TX_DUMP,
)
from groundmodel.infrastructure.parsers.lab.raw_export.lab_export_text import parse_lab_value_unit
from groundmodel.infrastructure.parsers.lab.raw_export.oedometer_listing_result import (
    OedometerListingResult,
)
from groundmodel.infrastructure.parsers.lab.raw_export.oedometer_stage import OedometerStage
from groundmodel.infrastructure.parsers.lab.raw_export.triaxial_constants import (
    TX_LAB_DERIVED_CHANNELS,
    TX_MEASURED_CHANNELS,
)
from groundmodel.infrastructure.parsers.lab.raw_export.triaxial_dump_result import (
    TriaxialDumpResult,
)
from groundmodel.infrastructure.parsers.lab.raw_export.triaxial_specimen import TriaxialSpecimen
from groundmodel.infrastructure.parsers.validation.validation_issue import ValidationIssue

LabExportResult = OedometerListingResult | TriaxialDumpResult

# Canonical key → the dump's column label (reverse of the parser's maps).
_TX_LABEL_BY_KEY: dict[str, str] = {
    **{k: label for label, k in TX_MEASURED_CHANNELS.items()},
    **{k: label for label, k in TX_LAB_DERIVED_CHANNELS.items()},
}


def lab_series_identity(result: LabExportResult) -> tuple[str, str | None, str | None, str | None]:
    """Return the re-import key of a parsed export.

    Parameters
    ----------
    result : OedometerListingResult or TriaxialDumpResult
        A parsed export.

    Returns
    -------
    tuple
        ``(kind, test_type_token, lab_job_number, lab_sample_number)``. Two
        imports with the same key are the same test (refresh, not duplicate).
    """
    if isinstance(result, TriaxialDumpResult):
        return (
            LabSeriesKind.TRIAXIAL.value,
            result.test_type,
            result.job_number,
            result.sample_number,
        )
    h = result.header
    return (LabSeriesKind.OEDOMETER.value, None, h.job_number, h.sample_number)


def issues_to_json(issues: list[ValidationIssue]) -> list[dict[str, Any]]:
    """Freeze parser findings as plain dicts (``level`` as its string value).

    Parameters
    ----------
    issues : list[ValidationIssue]
        Parser findings.

    Returns
    -------
    list[dict[str, Any]]
        ``[{level, code, message, rows}]`` in source order.
    """
    return [
        {"level": i.level.value, "code": i.code, "message": i.message, "rows": list(i.rows)}
        for i in issues
    ]


def build_lab_series_test(
    result: LabExportResult, *, source_file_name: str, source_sha256: str
) -> LabSeriesTestOrm:
    """Build the transient ORM tree of one parsed export (``sample_id`` unset).

    Parameters
    ----------
    result : OedometerListingResult or TriaxialDumpResult
        The parsed export.
    source_file_name : str
        The uploaded file's name.
    source_sha256 : str
        Hex SHA-256 of the file bytes (the idempotency stamp).

    Returns
    -------
    LabSeriesTestOrm
        Test with specimens → stages → channels and lab results attached.

    Raises
    ------
    TypeError
        When ``result`` is neither supported result type.
    """
    if isinstance(result, OedometerListingResult):
        return _oedometer_test(result, source_file_name, source_sha256)
    if isinstance(result, TriaxialDumpResult):
        return _triaxial_test(result, source_file_name, source_sha256)
    raise TypeError(f"unsupported lab export result: {type(result).__name__}")


# ---------------------------------------------------------------------------
# Oedometer
# ---------------------------------------------------------------------------


def _oedometer_test(
    result: OedometerListingResult, file_name: str, sha256: str
) -> LabSeriesTestOrm:
    """Build an oedometer test: one specimen, one stage per load step."""
    h = result.header
    first_stamp = next((s.timestamps[0] for s in result.stages if s.timestamps), None)
    test = LabSeriesTestOrm(
        id=uuid7(),
        kind=LabSeriesKind.OEDOMETER.value,
        test_type_token=None,
        lab_job_number=h.job_number,
        lab_sample_number=h.sample_number,
        lab_borehole_name=h.borehole_name,
        lab_sequence_number=h.sequence_number,
        sampling_depth_top_m=h.depth_top_m,
        sampling_depth_base_m=h.depth_base_m,
        visual_description=h.visual_description,
        test_start_date=first_stamp.date() if first_stamp else None,
        source_format=result.source_format,
        source_file_name=file_name,
        source_sha256=sha256,
        source_native_file=h.source_filename,
        source_program_version=h.program_version,
        source_header=dict(h.raw),
        import_issues=issues_to_json(result.issues),
        n_specimens=1,
    )
    stages = [
        _oedometer_stage(stage, result.source_format, h.initial_height_mm)
        for stage in result.stages
    ]
    specimen = LabSeriesSpecimenOrm(
        id=uuid7(),
        specimen_label=None,
        sort_order=0,
        initial_height_mm=h.initial_height_mm,
        initial_diameter_mm=h.diameter_mm,
        initial_wet_mass_g=h.wet_mass_g,
        initial_water_content_pct=h.water_content_pct,
        grain_density_t_m3=h.grain_density_t_m3,
        grain_density_note=h.grain_density_note,
        apparatus_id=h.apparatus_number,
        lever_ratio=h.lever_ratio,
        dial_coefficient_mm_per_unit=h.dial_coefficient_mm_per_unit,
        mounting_date=h.mounting_date,
        source_header={},
        n_points=sum(s.n_readings for s in stages),
    )
    specimen.stages = stages
    test.specimens = [specimen]
    test.lab_results = _oedometer_lab_results(result)
    return test


def _oedometer_stage(
    stage: OedometerStage, source_format: str, h0_mm: float | None
) -> LabSeriesStageOrm:
    """One load step with its measured channels and the derived strain."""
    meta = OED_CHANNELS[source_format]
    series: dict[str, list[float | None]] = {
        "elapsed_min": stage.elapsed_min,
        "dial_reading": stage.dial_readings,
        "settlement_mm": stage.settlement_mm,
        "total_settlement_mm": stage.total_settlement_mm,
        **stage.extra_channels,
    }
    channels = [
        _channel(key, meta[key], values, order)
        for order, (key, values) in enumerate(series.items())
        if key in meta
    ]
    if h0_mm is not None and h0_mm > 0:
        channels.append(
            LabSeriesChannelOrm(
                id=uuid7(),
                channel_key=VERTICAL_STRAIN_CHANNEL_KEY,
                source_label="delta_h / h0",
                unit=VERTICAL_STRAIN_UNIT,
                provenance=SeriesProvenance.DERIVED.value,
                series_values=vertical_strain(stage.total_settlement_mm, h0_mm),
                formula=VERTICAL_STRAIN_FORMULA,
                derivation_inputs={"h0_mm": h0_mm, "delta_h_channel": "total_settlement_mm"},
                sort_order=len(channels),
            )
        )
    row = LabSeriesStageOrm(
        id=uuid7(),
        stage_index=stage.stage_number,
        stage_kind=STAGE_KIND_LOAD_STEP,
        # The newer module writes no direction token: store NULL, not "".
        direction_token=stage.direction or None,
        hanger_load_kg=stage.hanger_load_kg,
        target_stress_kpa=stage.stress_kpa,
        height_at_start_mm=stage.height_at_start_mm,
        lab_stage_settlement_mm=stage.stage_settlement_mm,
        lab_coefficient_label=stage.lab_coefficient_label,
        lab_coefficient=stage.lab_coefficient,
        started_at=stage.timestamps[0] if stage.timestamps else None,
        reading_timestamps=list(stage.timestamps),
        point_numbers=None,
        rezero_indices=list(stage.rezero_indices),
        n_readings=len(stage.elapsed_min),
    )
    row.channels = channels
    return row


def _oedometer_lab_results(result: OedometerListingResult) -> list[LabSeriesLabResultOrm]:
    """The lab's per-stage summary table as lab-reported rows."""
    rows: list[LabSeriesLabResultOrm] = []
    for summary in result.lab_summary:
        values = asdict(summary)
        for field_name, label, unit in OED_LAB_SUMMARY_FIELDS:
            rows.append(
                _lab_result(
                    label,
                    numeric=values[field_name],
                    unit=unit,
                    stage_index=summary.stage_number,
                    order=len(rows),
                )
            )
    return rows


# ---------------------------------------------------------------------------
# Triaxial
# ---------------------------------------------------------------------------


def _triaxial_test(result: TriaxialDumpResult, file_name: str, sha256: str) -> LabSeriesTestOrm:
    """Build a triaxial test: one specimen per sub-specimen, one shear stage each."""
    test = LabSeriesTestOrm(
        id=uuid7(),
        kind=LabSeriesKind.TRIAXIAL.value,
        test_type_token=result.test_type,
        lab_job_number=result.job_number,
        lab_sample_number=result.sample_number,
        lab_borehole_name=result.borehole_name,
        lab_sequence_number=result.sequence_number,
        sampling_depth_top_m=result.depth_top_m,
        sampling_depth_base_m=result.depth_base_m,
        visual_description=result.visual_description,
        test_start_date=None,
        source_format=LAB_EXPORT_FORMAT_TX_DUMP,
        source_file_name=file_name,
        source_sha256=sha256,
        source_native_file=None,
        source_program_version=None,
        source_header={k: list(v) for k, v in result.raw.items()},
        import_issues=issues_to_json(result.issues),
        n_specimens=len(result.specimens),
    )
    test.specimens = [_triaxial_specimen(s, order) for order, s in enumerate(result.specimens)]
    results: list[LabSeriesLabResultOrm] = []
    for s in result.specimens:
        results.extend(_triaxial_lab_results(s, first_order=len(results)))
    test.lab_results = results
    return test


def _triaxial_specimen(s: TriaxialSpecimen, order: int) -> LabSeriesSpecimenOrm:
    """One sub-specimen with its single shear stage."""
    channels: list[LabSeriesChannelOrm] = []
    for group, provenance in (
        (s.measured, SeriesProvenance.MEASURED.value),
        (s.lab_derived, SeriesProvenance.LAB_DERIVED.value),
    ):
        for key, values in group.items():
            meta = (_TX_LABEL_BY_KEY.get(key, key), TX_CHANNEL_UNITS.get(key, ""), provenance)
            channels.append(_channel(key, meta, values, len(channels)))
    for label, values in s.unclassified.items():
        meta = (label, "", TX_UNCLASSIFIED_PROVENANCE)
        channels.append(
            _channel(f"{TX_UNCLASSIFIED_KEY_PREFIX}{label}", meta, values, len(channels))
        )
    stage = LabSeriesStageOrm(
        id=uuid7(),
        stage_index=1,
        stage_kind=STAGE_KIND_SHEAR,
        direction_token=None,
        reading_timestamps=None,
        point_numbers=list(s.point_numbers),
        rezero_indices=[],
        n_readings=len(s.point_numbers),
    )
    stage.channels = channels
    specimen = LabSeriesSpecimenOrm(
        id=uuid7(),
        specimen_label=s.specimen_id,
        sort_order=order,
        initial_height_mm=s.initial_height_mm,
        initial_diameter_mm=s.initial_diameter_mm,
        initial_wet_mass_g=s.initial_wet_mass_g,
        dry_mass_g=s.dry_mass_g,
        grain_density_t_m3=s.grain_density_t_m3,
        strain_rate_mm_per_min=s.strain_rate_mm_per_min,
        consolidation_stress_kpa=s.consolidation_stress_kpa,
        consolidation_volume_change_cm3=s.consolidation_volume_change_cm3,
        failure_description=s.failure_description,
        apparatus_id=s.press_id,
        calibration={k: {"a": a, "b": b} for k, (a, b) in s.calibration.items()} or None,
        source_header={k: list(v) for k, v in s.raw.items()},
        n_points=len(s.point_numbers),
    )
    specimen.stages = [stage]
    return specimen


def _triaxial_lab_results(s: TriaxialSpecimen, *, first_order: int) -> list[LabSeriesLabResultOrm]:
    """The specimen's before / after table and failure text, lab-reported."""
    phases = tuple(s.raw.get(TX_BEFORE_AFTER_HEADER_LABEL) or TX_DEFAULT_PHASES)
    rows: list[LabSeriesLabResultOrm] = []
    for label in TX_BEFORE_AFTER_LABELS:
        for phase, cell in zip(phases, s.raw.get(label) or [], strict=False):
            number, unit = parse_lab_value_unit(cell)
            rows.append(
                _lab_result(
                    f"{label} ({phase})",
                    numeric=number,
                    text=None if number is not None else cell,
                    unit=unit,
                    specimen_label=s.specimen_id,
                    order=first_order + len(rows),
                )
            )
    for label in TX_SINGLE_TEXT_LABELS:
        cells = s.raw.get(label) or []
        if cells:
            rows.append(
                _lab_result(
                    label,
                    text=cells[0],
                    specimen_label=s.specimen_id,
                    order=first_order + len(rows),
                )
            )
    return rows


# ---------------------------------------------------------------------------
# Row factories
# ---------------------------------------------------------------------------


def _channel(
    key: str, meta: tuple[str, str, str], values: list[float | None], order: int
) -> LabSeriesChannelOrm:
    """One channel row: (lab label, unit, provenance) + the values."""
    label, unit, provenance = meta
    return LabSeriesChannelOrm(
        id=uuid7(),
        channel_key=key,
        source_label=label,
        unit=unit or None,
        provenance=provenance,
        series_values=list(values),
        sort_order=order,
    )


def _lab_result(
    parameter: str,
    *,
    numeric: float | None = None,
    text: str | None = None,
    unit: str | None = None,
    specimen_label: str | None = None,
    stage_index: int | None = None,
    order: int,
) -> LabSeriesLabResultOrm:
    """One lab-reported row (provenance fixed: the lab's own statement)."""
    return LabSeriesLabResultOrm(
        id=uuid7(),
        specimen_label=specimen_label,
        stage_index=stage_index,
        parameter=parameter,
        value_numeric=numeric,
        value_text=text,
        unit=unit,
        provenance=SeriesProvenance.LAB_REPORTED.value,
        sort_order=order,
    )

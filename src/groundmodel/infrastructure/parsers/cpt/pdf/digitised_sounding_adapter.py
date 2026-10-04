"""DigitisedSoundingAdapter: a digitised sounding as the parse result CPT importers persist."""

from __future__ import annotations

from typing import Any

import polars as pl

from groundmodel.domain.value_objects.derived_value_source import DerivedValueSource
from groundmodel.domain.value_objects.elevation_source import ElevationSource
from groundmodel.infrastructure.parsers.cpt.gef.cpt_type import CPTType
from groundmodel.infrastructure.parsers.cpt.gef.gef_constants import PRE_DRILL_APPLIED_TOLERANCE_M
from groundmodel.infrastructure.parsers.cpt.gef.gef_header import GEFHeader
from groundmodel.infrastructure.parsers.cpt.gef.gef_parse_result import GEFParseResult
from groundmodel.infrastructure.parsers.cpt.pdf.depth_reference import DepthReference
from groundmodel.infrastructure.parsers.cpt.pdf.digitised_sounding import DigitisedSounding
from groundmodel.infrastructure.parsers.cpt.pdf.graph_kind import GraphKind
from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import (
    DEPTH_SOURCE_ELEVATION,
    DEPTH_SOURCE_PLOTTED,
    DIGITISER_VERSION,
    PDF_PROVENANCE_SOURCE,
    STORED_COLUMN_BY_KIND,
)
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_import_header import PdfImportHeader
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_report_identity import PdfReportIdentity
from groundmodel.infrastructure.parsers.cpt.pdf.sheet_header_helpers import sheet_date_iso
from groundmodel.infrastructure.parsers.cpt.pdf.stored_series_helpers import (
    clipped_column,
    clipped_intervals,
    stored_table,
)
from groundmodel.infrastructure.parsers.validation.validation_issue import ValidationIssue
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class DigitisedSoundingAdapter(GroundModelLogger):
    """Turn a digitised sounding into a ``GEFParseResult`` for ``ImportCpt.persist``.

    ``ImportCpt.persist`` is the one door every CPT source goes through
    (coordinate guard, duplicate + refresh consent, ORM mapping), so the
    digitiser speaks its language: a header, a typed frame, validation issues,
    and an ``import_provenance`` dict saying exactly how the numbers were read.

    Owner rulings 2026-09-30 applied here: a clipped point stays at the axis
    maximum with a flag and the printed arrow value is kept as a note (never
    interpolated); an elevation-axis depth is stamped "derived from plotted
    elevation"; vector vertices are stored as they are, raster traces on the
    0.02 m grid.

    Owner ruling "a" (2026-10-04): a drilled stretch stays a gap. The stored
    series holds no row inside it (a stored row needs a qc, and the series
    repair on load drops any row without one), its stretches are listed in
    one ``PDF_DRILLED_INTERVALS`` issue and in ``drilled_intervals_m``, and
    the chart breaks its lines there. A curve that starts below the surface
    records that depth as ``pre_drill_m`` in the provenance only (the GEF
    twin is ``#MEASUREMENTVAR= 13``): on CAMZ-001/005 it matches the GEF on
    20 of 25 soundings, but a curve whose first metres are drawn off the
    panel (qc at or below zero) also starts deep, so it is not written to the
    CPT's pre-drill column.
    """

    def __init__(self) -> None:
        super().__init__(__name__)

    def to_parse_result(
        self,
        sounding: DigitisedSounding,
        header: PdfImportHeader,
        report: PdfReportIdentity,
    ) -> GEFParseResult:
        """Return the parse result of one digitised sounding.

        Parameters
        ----------
        sounding : DigitisedSounding
            The sounding (continuation sheets merged).
        header : PdfImportHeader
            Name, position, ground level and date (sheet values or typed).
        report : PdfReportIdentity
            The report file, for the provenance.

        Returns
        -------
        GEFParseResult
            Header, frame (``depth_m``, ``qc_mpa`` and the other curves read),
            issues (``PDF_CLIPPED_POINTS``, ``PDF_DEPTH_FROM_ELEVATION``,
            ``PDF_NO_XY``, ``PDF_OCR_UNAVAILABLE``, ``PDF_DRILLED_INTERVALS``),
            ``rf_source``, ``elevation_source = PDF`` and ``import_provenance``.

        Raises
        ------
        ValueError
            When the sounding has no qc curve.
        """
        self.debug("adapting sounding %s (pages %s)", header.test_id, list(sounding.page_numbers))
        table, sampling, above_ground = stored_table(sounding)
        issues: list[ValidationIssue] = []
        clipped = self._clipped(table, issues)
        elevation = any(
            c.depth_reference is DepthReference.ELEVATION for c in sounding.calibrations
        )
        if elevation:
            issues.append(
                ValidationIssue(
                    level=ValidationLevel.INFO,
                    code="PDF_DEPTH_FROM_ELEVATION",
                    message=(
                        "the sheet plots elevation: depth = printed ground level "
                        f"({header.ground_level_m} m) - plotted elevation"
                    ),
                )
            )
        if header.x is None or header.y is None or header.epsg is None:
            issues.append(
                ValidationIssue(
                    level=ValidationLevel.ERROR,
                    code="PDF_NO_XY",
                    message="the sheet prints no position: type X and Y to place this sounding",
                )
            )
        drilled = self._drilled(sounding, issues)
        pre_drill = _pre_drill(table)
        raster = any(c.source is GraphKind.RASTER for c in sounding.curves.values())
        if not report.ocr_available and raster:
            issues.append(
                ValidationIssue(
                    level=ValidationLevel.INFO,
                    code="PDF_OCR_UNAVAILABLE",
                    message="read without OCR: the axis values were typed or taken from the grid",
                )
            )

        rf_source: DerivedValueSource | None = None
        if "rf_pct" in table.columns:
            rf_source = DerivedValueSource.MEASURED
        elif "fs_mpa" in table.columns:
            # The sheet plots no Rf: derive it like the GEF parser does, and
            # say so (Data Integrity rule 2: derived is not pass-through).
            table = table.with_columns(
                pl.when(pl.col("qc_mpa") > 0)
                .then(pl.col("fs_mpa") / pl.col("qc_mpa") * 100.0)
                .otherwise(None)
                .alias("rf_pct")
            )
            rf_source = DerivedValueSource.COMPUTED

        data = table.select(
            [
                "depth_m",
                *[c for c in ("qc_mpa", "fs_mpa", "rf_pct", "u2_mpa") if c in table.columns],
            ]
        )
        result = GEFParseResult(
            header=GEFHeader(
                project_id=header.project_id,
                test_id=header.test_id,
                file_date=sheet_date_iso(header.test_date) or (header.test_date or ""),
                report_code=report.file_name[:100],
                x=header.x,
                y=header.y,
                z=header.ground_level_m,
                epsg=header.epsg,
                z_epsg=header.z_epsg,
            ),
            cpt_type=_cpt_type(set(sounding.curves)),
            data=data,
            issues=issues,
            rf_source=rf_source,
            elevation_source=(
                ElevationSource.PDF if header.ground_level_m is not None else ElevationSource.NONE
            ),
            import_provenance={
                **self._provenance(
                    sounding, header, report, sampling, elevation, clipped, rf_source
                ),
                "points_above_ground_dropped": above_ground,
                "drilled_intervals_m": drilled,
                "pre_drill_m": pre_drill,
            },
        )
        self.debug(
            "sounding %s: %d drilled interval(s), pre-drill %.3f m",
            header.test_id,
            len(drilled),
            pre_drill,
        )
        self.debug(
            "sounding %s: %d rows, %s, %d issue(s)",
            header.test_id,
            len(data),
            result.cpt_type.value,
            len(issues),
        )
        return result

    @staticmethod
    def _clipped(table: pl.DataFrame, issues: list[ValidationIssue]) -> dict[str, Any]:
        """Count the clipped points per curve and add one issue per clipped curve."""
        out: dict[str, Any] = {}
        depth = table["depth_m"].to_list()
        for kind, name in STORED_COLUMN_BY_KIND.items():
            flag_name = clipped_column(name)
            if flag_name not in table.columns:
                continue
            flags = [bool(f) for f in table[flag_name].fill_null(False).to_list()]
            count = sum(flags)
            if not count:
                continue
            values = [v for v, f in zip(table[name].to_list(), flags, strict=True) if f]
            axis_max = round(max(v for v in values if v is not None), 3)
            out[kind.value] = {
                "count": count,
                "axis_max": axis_max,
                "intervals_m": clipped_intervals(depth, flags),
            }
            issues.append(
                ValidationIssue(
                    level=ValidationLevel.WARNING,
                    code="PDF_CLIPPED_POINTS",
                    message=(
                        f"{count} {kind.value} point(s) drawn on the axis maximum "
                        f"({axis_max:g}): the true value is at least that; kept at the "
                        "maximum and flagged, never interpolated"
                    ),
                    rows=[i for i, f in enumerate(flags) if f],
                )
            )
        return out

    @staticmethod
    def _drilled(sounding: DigitisedSounding, issues: list[ValidationIssue]) -> list[list[float]]:
        """Return the drilled stretches as ``[top, base]`` pairs; one INFO issue lists them."""
        drilled = [[top, base] for top, base in sounding.drilled_intervals()]
        if drilled:
            listed = ", ".join(f"{top:.2f}-{base:.2f} m" for top, base in drilled)
            issues.append(
                ValidationIssue(
                    level=ValidationLevel.INFO,
                    code="PDF_DRILLED_INTERVALS",
                    message=(
                        f"{len(drilled)} drilled interval(s) without measurement ({listed}): "
                        "left empty, never interpolated"
                    ),
                    params={"intervals": drilled},
                )
            )
        return drilled

    @staticmethod
    def _provenance(
        sounding: DigitisedSounding,
        header: PdfImportHeader,
        report: PdfReportIdentity,
        sampling: str,
        elevation: bool,
        clipped: dict[str, Any],
        rf_source: DerivedValueSource | None,
    ) -> dict[str, Any]:
        """Return the JSON provenance stored on the CPT."""
        return {
            "source": PDF_PROVENANCE_SOURCE,
            "digitiser_version": DIGITISER_VERSION,
            "report_file_name": report.file_name,
            "report_sha256": report.file_sha,
            "pages": list(sounding.page_numbers),
            "graph_kind": (
                GraphKind.RASTER.value
                if any(c.source is GraphKind.RASTER for c in sounding.curves.values())
                else GraphKind.VECTOR.value
            ),
            "series_sampling": sampling,
            "depth_source": DEPTH_SOURCE_ELEVATION if elevation else DEPTH_SOURCE_PLOTTED,
            "rf_source": rf_source.value if rf_source else None,
            "clipped": clipped,
            "printed_values": [[round(d, 3), text] for d, text in sounding.annotations],
            "header_sources": dict(header.sources),
            "printed_test_date": header.test_date,
            "calibrations": [c.to_dict() for c in sounding.calibrations],
            "ocr_available": report.ocr_available,
        }


def _pre_drill(table: pl.DataFrame) -> float:
    """Return the depth of the first stored scan when it lies below the surface, else 0.

    The same tolerance as the GEF pre-drill check: a first scan within
    ``PRE_DRILL_APPLIED_TOLERANCE_M`` of the surface is the surface.
    """
    if table.is_empty():
        return 0.0
    first = float(table["depth_m"].min())  # type: ignore[arg-type]
    return round(first, 3) if first > PRE_DRILL_APPLIED_TOLERANCE_M else 0.0


def _cpt_type(kinds: set[PanelKind]) -> CPTType:
    """Return the CPT type the read curves show (qc alone is not claimed as a type)."""
    if PanelKind.U2 in kinds:
        return CPTType.CPTU
    if PanelKind.FS in kinds:
        return CPTType.CPTE
    return CPTType.UNKNOWN

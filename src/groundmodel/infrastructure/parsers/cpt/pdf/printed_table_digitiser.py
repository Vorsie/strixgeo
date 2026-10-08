"""PrintedTableDigitiser: a printed-table sounding as the DigitisedSounding every import reads."""

from __future__ import annotations

import statistics
from typing import Any

import numpy as np

from groundmodel.infrastructure.parsers.cpt.gef.cpt_type import CPTType
from groundmodel.infrastructure.parsers.cpt.pdf.digitised_curve import DigitisedCurve
from groundmodel.infrastructure.parsers.cpt.pdf.digitised_sounding import DigitisedSounding
from groundmodel.infrastructure.parsers.cpt.pdf.graph_kind import GraphKind
from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind
from groundmodel.infrastructure.parsers.cpt.pdf.printed_table_constants import (
    PRE_DRILL_FLOOR_QC_MPA,
    PRINTED_TABLE_SOURCE_KIND,
    STANDARD_MECHANICAL_CONE_AREA_CM2,
)
from groundmodel.infrastructure.parsers.cpt.pdf.printed_table_helpers import (
    half_unit,
    printed_step,
    rf_outside_rounding,
    table_chain,
)
from groundmodel.infrastructure.parsers.cpt.pdf.printed_table_row import PrintedTableRow
from groundmodel.infrastructure.parsers.cpt.pdf.printed_table_sounding import PrintedTableSounding
from groundmodel.infrastructure.parsers.cpt.pdf.table_column_role import TableColumnRole
from groundmodel.infrastructure.parsers.validation.validation_issue import ValidationIssue
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# The table columns that become stored curves, and the curve each feeds.
_STORED_ROLES: dict[TableColumnRole, PanelKind] = {
    TableColumnRole.QC: PanelKind.QC,
    TableColumnRole.FS: PanelKind.FS,
    TableColumnRole.RF: PanelKind.RF,
}

# Measured columns the CPT has no stored column for: listed, not stored.
_NOT_STORED_ROLES = (TableColumnRole.INCLINATION, TableColumnRole.TOTAL_FORCE)

# Ground level and level checks are reported to the centimetre the tables print.
_LEVEL_DECIMALS = 2

# Two printed numbers (a qc, a cone area) are the same value within float noise.
_SAME_VALUE = 1e-9


class PrintedTableDigitiser(GroundModelLogger):
    """Turn the printed rows of a sounding into curves, exactly as printed.

    Owner 2026-10-08: "the import takes the EXACT printed values from the
    tables". Every row becomes a scan; qc, fs and Rf are the printed numbers
    (a blank cell stays empty). Nothing is resampled or interpolated: a
    missing block of rows, or a printed stretch without measurement between
    two rows, starts a new stroke so the stored series leaves it a gap (owner
    ruling "a", 2026-10-04). The calculated columns (φ', C) are never read
    into a curve; their presence is recorded. A printed level that does not
    equal the ground level minus the depth is flagged, never corrected.

    Owner rulings 2026-10-09: a printed Rf its own printed fs and qc cannot
    give is flagged AND dropped (the Rf cell empty, qc and fs as printed);
    rows printing the floor qc 0,01 MPa directly after the printed pre-drill
    are no reading (every cell empty, the rows kept, no drilled gap); the
    total resistance Qt (kN) of a CPT-M table is stored as ``q_total_mpa``
    like the GEF importer's quantity 128, unless the sheet names a cone area
    other than the standard 10 cm² (flagged, never converted).
    """

    def __init__(self) -> None:
        super().__init__(__name__)

    def to_sounding(
        self, table: PrintedTableSounding, epsg: int | None, z_epsg: int | None
    ) -> DigitisedSounding:
        """Return the sounding's curves and its printed-table provenance.

        Parameters
        ----------
        table : PrintedTableSounding
            The joined table sheets of one sounding.
        epsg, z_epsg : int or None
            The systems the report names (recorded in the provenance).

        Returns
        -------
        DigitisedSounding
            Curves with ``source = GraphKind.TABLE``, no calibrations, the
            printed pre-drill and CPT type, the reading's issues and the
            ``table_provenance`` dict.
        """
        header = table.header
        rows = list(table.rows)
        depths = [r.depth_m for r in rows]
        step = printed_step(depths)
        chain = table_chain(depths, header.no_measurement_intervals_m, step)
        depth = np.asarray(depths, dtype=float)
        floor = _pre_drill_floor_rows(rows, header.pre_drill_m)
        effective_pre_drill = rows[floor].depth_m if floor < len(rows) else None
        rf_flagged = _rf_mismatches(rows)
        q_total_kept = _q_total_kept(table)
        stored_roles = dict(_STORED_ROLES)
        if q_total_kept:
            stored_roles[TableColumnRole.TOTAL_RESISTANCE] = PanelKind.Q_TOTAL
        curves: dict[PanelKind, DigitisedCurve] = {}
        for role, kind in stored_roles.items():
            if not table.columns_with(role):
                continue
            values = np.asarray(
                [np.nan if (v := r.value(role)) is None else v for r in rows], dtype=float
            )
            # The floor rows after the pre-drill are no reading: every cell
            # empty, the rows kept (owner 2026-10-09).
            values[:floor] = np.nan
            if role is TableColumnRole.RF:
                # A printed Rf its own row contradicts is dropped; qc and fs
                # stay as printed (owner 2026-10-09, "laat die maar vallen").
                values[rf_flagged] = np.nan
            curves[kind] = DigitisedCurve(
                kind=kind,
                depth_m=depth,
                value=values,
                clipped=np.zeros(len(rows), dtype=bool),
                source=GraphKind.TABLE,
                chain=chain,
            )
        issues: list[ValidationIssue] = []
        ground, first, mismatches = _levels(rows)
        rf_flags = [rows[i].depth_m for i in rf_flagged]
        floor_depths = [r.depth_m for r in rows[:floor]]
        not_stored = _not_stored_columns(table, q_total_kept)
        self._issues(table, rf_flags, mismatches, not_stored, issues)
        if floor_depths:
            issues.append(_floor_rows_issue(floor_depths, header.pre_drill_m, effective_pre_drill))
        area_issue = _cone_area_issue(table, q_total_kept)
        if area_issue is not None:
            issues.append(area_issue)
        provenance: dict[str, Any] = {
            "source_kind": PRINTED_TABLE_SOURCE_KIND,
            **header.to_dict(),
            "printed_columns": list(table.columns),
            "derived_columns_ignored": table.columns_with(TableColumnRole.DERIVED),
            "columns_not_stored": not_stored,
            # The CPT-M total resistance column stored as q_total_mpa (kN kept
            # as-is, the GEF quantity 128 rule); None when none is stored.
            "q_total_column": (
                table.columns_with(TableColumnRole.TOTAL_RESISTANCE)[0] if q_total_kept else None
            ),
            "rows": len(rows),
            "step_m": step,
            "ground_level_m": ground,
            "ground_level_source": "printed level + printed depth (median over the rows)",
            "first_row": first,
            "level_mismatches": mismatches,
            "rf_mismatch_depths_m": rf_flags,
            # The printed Rf each dropped cell held, [depth, Rf]: the stored
            # cell is empty, the printed number is kept here.
            "rf_dropped": [
                [rows[i].depth_m, rows[i].value(TableColumnRole.RF)] for i in rf_flagged
            ],
            # Rows printing the floor qc directly after the printed pre-drill:
            # no reading (owner 2026-10-09). The printed pre-drill stays
            # ``pre_drill_m``; the first real row is the effective one.
            "pre_drill_floor_rows_m": floor_depths,
            "effective_pre_drill_m": effective_pre_drill,
            "rows_rejected": [dict(r) for r in table.rejected],
            "duplicate_rows": table.duplicate_rows,
            "data_pages": list(table.data_pages),
            "graph_pages": list(table.graph_pages),
            "calculation_pages_ignored": list(table.calculation_pages),
            "epsg": epsg,
            "z_epsg": z_epsg,
        }
        self.info(
            "%s: %d row(s), step %s m, ground %s m, %d Rf dropped / %d level mismatch(es), "
            "%d rejected, %d floor row(s) after the pre-drill, q_total %s",
            header.sounding_id,
            len(rows),
            step,
            ground,
            len(rf_flags),
            len(mismatches),
            len(table.rejected),
            len(floor_depths),
            "stored" if q_total_kept else "not stored",
        )
        return DigitisedSounding(
            sounding_id=header.sounding_id,
            page_numbers=table.page_numbers,
            calibrations=(),
            curves=curves,
            printed_pre_drill_m=header.pre_drill_m,
            effective_pre_drill_m=effective_pre_drill,
            printed_cpt_type=header.cpt_type,
            table_provenance=provenance,
            issues=tuple(issues),
        )

    def _issues(
        self,
        table: PrintedTableSounding,
        rf_flags: list[float],
        mismatches: list[list[float]],
        not_stored: list[str],
        issues: list[ValidationIssue],
    ) -> None:
        """Add one issue per check that found something, and one for the columns left out."""
        if rf_flags:
            issues.append(
                ValidationIssue(
                    level=ValidationLevel.WARNING,
                    code="PDF_TABLE_RF_MISMATCH",
                    message=(
                        f"{len(rf_flags)} printed Rf value(s) differ from the printed "
                        "fs / qc x 100 beyond the printed rounding: dropped, the Rf cell "
                        "left empty (qc and fs as printed)"
                    ),
                    params={"count": len(rf_flags), "depths_m": rf_flags},
                )
            )
        if mismatches:
            issues.append(
                ValidationIssue(
                    level=ValidationLevel.WARNING,
                    code="PDF_TABLE_LEVEL_MISMATCH",
                    message=(
                        f"{len(mismatches)} printed level(s) differ from ground level - depth "
                        "beyond the printed rounding: depth kept as printed"
                    ),
                    params={"count": len(mismatches), "rows": mismatches},
                )
            )
        if table.rejected:
            issues.append(
                ValidationIssue(
                    level=ValidationLevel.WARNING,
                    code="PDF_TABLE_ROWS_REJECTED",
                    message=(
                        f"{len(table.rejected)} printed row(s) not read: "
                        + "; ".join(f"p. {r['page']} '{r['text']}'" for r in table.rejected)
                    ),
                    params={
                        "count": len(table.rejected),
                        "rows": [dict(r) for r in table.rejected],
                    },
                )
            )
        derived = table.columns_with(TableColumnRole.DERIVED)
        if derived or not_stored:
            issues.append(
                ValidationIssue(
                    level=ValidationLevel.INFO,
                    code="PDF_TABLE_COLUMNS_NOT_IMPORTED",
                    message=(
                        "printed columns not imported: "
                        + ", ".join(
                            [f"{c} (calculated)" for c in derived]
                            + [f"{c} (no stored column)" for c in not_stored]
                        )
                    ),
                    # ``columns``: every printed name, so the app writes the
                    # sentence in its own language around them.
                    params={
                        "derived": derived,
                        "not_stored": not_stored,
                        "columns": derived + not_stored,
                    },
                )
            )


def _levels(
    rows: list[PrintedTableRow],
) -> tuple[float | None, dict[str, float] | None, list[list[float]]]:
    """Return the ground level (level + depth), the first row, and the rows that disagree.

    Every row prints its depth below ground and its level against the datum,
    so level + depth is the ground level on every row, to the printed
    rounding. The median over the rows is the ground level; a row off by more
    than the two values' rounding is listed ``[depth, level]``.
    """
    pairs = [
        (r, level, r.decimals_of(TableColumnRole.LEVEL))
        for r in rows
        if (level := r.value(TableColumnRole.LEVEL)) is not None
    ]
    if not pairs:
        return None, None, []
    ground = statistics.median(r.depth_m + level for r, level, _ in pairs)
    mismatches: list[list[float]] = []
    for row, level, decimals in pairs:
        tolerance = half_unit(decimals) + half_unit(row.decimals_of(TableColumnRole.DEPTH)) + 1e-9
        if abs(row.depth_m + level - ground) > tolerance:
            mismatches.append([row.depth_m, level])
    first_row, first_level, _ = pairs[0]
    return (
        round(ground, _LEVEL_DECIMALS),
        {"depth_m": first_row.depth_m, "level_m": first_level},
        mismatches,
    )


def _pre_drill_floor_rows(rows: list[PrintedTableRow], pre_drill_m: float | None) -> int:
    """Return how many leading rows print the floor qc directly after a printed pre-drill.

    Owner 2026-10-09: rows printing qc 0,01 MPa DIRECTLY AFTER the pre-drill
    are no reading ("they prolly drilled a bit too deep"). Only the run that
    starts at the first printed row counts, and only below a PRINTED pre-drill:
    a table that starts at the surface prints its first row as measured (the
    Rf ruling keeps that row's qc and fs). A run with no real row below it is
    not emptied (there would be no curve left to start).

    Parameters
    ----------
    rows : list of PrintedTableRow
        The rows, by depth.
    pre_drill_m : float or None
        The printed pre-drill depth; None = the sheet prints none.

    Returns
    -------
    int
        The number of floor rows at the top (0 when none).
    """
    if pre_drill_m is None:
        return 0
    count = 0
    for row in rows:
        qc = row.value(TableColumnRole.QC)
        if qc is None or abs(qc - PRE_DRILL_FLOOR_QC_MPA) > _SAME_VALUE:
            break
        count += 1
    return count if count < len(rows) else 0


def _q_total_kept(table: PrintedTableSounding) -> bool:
    """Return whether the table's total resistance Qt is stored as ``q_total_mpa``.

    Owner 2026-10-09: Qt (kN) of a CPT-M table is stored like the GEF
    importer's quantity 128, the kN value kept as-is (the standard 10 cm²
    cone makes kN == MPa). Only a CPTM sounding (CPTM => q_total_mpa, CPTU =>
    qt_mpa, never both), and not when the sheet names another cone area
    (that is flagged, never converted).
    """
    if table.header.cpt_type != CPTType.CPTM.value:
        return False
    if not table.columns_with(TableColumnRole.TOTAL_RESISTANCE):
        return False
    area = table.header.cone_area_cm2
    return area is None or abs(area - STANDARD_MECHANICAL_CONE_AREA_CM2) <= _SAME_VALUE


def _not_stored_columns(table: PrintedTableSounding, q_total_kept: bool) -> list[str]:
    """Return the measured columns the CPT does not store, left to right."""
    roles = list(_NOT_STORED_ROLES)
    if not q_total_kept:
        roles.append(TableColumnRole.TOTAL_RESISTANCE)
    return table.columns_with(*roles)


def _floor_rows_issue(
    depths: list[float], pre_drill_m: float | None, effective_m: float | None
) -> ValidationIssue:
    """Return the INFO issue naming the floor rows emptied after the pre-drill."""
    return ValidationIssue(
        level=ValidationLevel.INFO,
        code="PDF_TABLE_PRE_DRILL_FLOOR_ROWS",
        message=(
            f"{len(depths)} row(s) printing qc {PRE_DRILL_FLOOR_QC_MPA:g} MPa directly after "
            f"the printed pre-drill ({pre_drill_m:g} m): no reading, left empty; the curve "
            f"starts at {effective_m:.2f} m"
        ),
        params={
            "count": len(depths),
            "depths_m": depths,
            "pre_drill_m": pre_drill_m,
            "depth": effective_m,
        },
    )


def _cone_area_issue(table: PrintedTableSounding, q_total_kept: bool) -> ValidationIssue | None:
    """Return the warning for a CPT-M Qt left empty because the sheet names another cone area."""
    header = table.header
    columns = table.columns_with(TableColumnRole.TOTAL_RESISTANCE)
    if q_total_kept or not columns or header.cpt_type != CPTType.CPTM.value:
        return None
    area = header.cone_area_cm2
    return ValidationIssue(
        level=ValidationLevel.WARNING,
        code="PDF_TABLE_QTOTAL_CONE_AREA",
        message=(
            f"the sheet names a {area:g} cm² cone: {columns[0]} (kN) equals MPa only for the "
            f"standard {STANDARD_MECHANICAL_CONE_AREA_CM2:g} cm² cone, so q_total is left "
            "empty, never converted"
        ),
        params={"area_cm2": area, "column": columns[0]},
    )


def _rf_mismatches(rows: list[PrintedTableRow]) -> list[int]:
    """Return the indices of the rows whose printed Rf its own printed fs and qc cannot give."""
    flagged: list[int] = []
    for index, row in enumerate(rows):
        qc = row.value(TableColumnRole.QC)
        fs = row.value(TableColumnRole.FS)
        rf = row.value(TableColumnRole.RF)
        if qc is None or fs is None or rf is None:
            continue
        if rf_outside_rounding(
            qc,
            row.decimals_of(TableColumnRole.QC),
            fs,
            row.decimals_of(TableColumnRole.FS),
            rf,
            row.decimals_of(TableColumnRole.RF),
        ):
            flagged.append(index)
    return flagged

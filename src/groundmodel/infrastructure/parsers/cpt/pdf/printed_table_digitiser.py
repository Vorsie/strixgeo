"""PrintedTableDigitiser: a printed-table sounding as the DigitisedSounding every import reads."""

from __future__ import annotations

import statistics
from typing import Any

import numpy as np

from groundmodel.infrastructure.parsers.cpt.pdf.digitised_curve import DigitisedCurve
from groundmodel.infrastructure.parsers.cpt.pdf.digitised_sounding import DigitisedSounding
from groundmodel.infrastructure.parsers.cpt.pdf.graph_kind import GraphKind
from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind
from groundmodel.infrastructure.parsers.cpt.pdf.printed_table_constants import (
    PRINTED_TABLE_SOURCE_KIND,
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


class PrintedTableDigitiser(GroundModelLogger):
    """Turn the printed rows of a sounding into curves, exactly as printed.

    Owner 2026-10-08: "the import takes the EXACT printed values from the
    tables". Every row becomes a scan; qc, fs and Rf are the printed numbers
    (a blank cell stays empty). Nothing is resampled or interpolated: a
    missing block of rows, or a printed stretch without measurement between
    two rows, starts a new stroke so the stored series leaves it a gap (owner
    ruling "a", 2026-10-04). The calculated columns (φ', C) are never read
    into a curve; their presence is recorded. Two checks flag, never correct:
    a printed Rf its own printed fs and qc cannot give, and a printed level
    that does not equal the ground level minus the depth.
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
        curves: dict[PanelKind, DigitisedCurve] = {}
        for role, kind in _STORED_ROLES.items():
            if not table.columns_with(role):
                continue
            values = np.asarray(
                [np.nan if (v := r.value(role)) is None else v for r in rows], dtype=float
            )
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
        rf_flags = _rf_mismatches(rows)
        self._issues(table, rf_flags, mismatches, issues)
        provenance: dict[str, Any] = {
            "source_kind": PRINTED_TABLE_SOURCE_KIND,
            **header.to_dict(),
            "printed_columns": list(table.columns),
            "derived_columns_ignored": table.columns_with(TableColumnRole.DERIVED),
            "columns_not_stored": table.columns_with(*_NOT_STORED_ROLES),
            "rows": len(rows),
            "step_m": step,
            "ground_level_m": ground,
            "ground_level_source": "printed level + printed depth (median over the rows)",
            "first_row": first,
            "level_mismatches": mismatches,
            "rf_mismatch_depths_m": rf_flags,
            "rows_rejected": [dict(r) for r in table.rejected],
            "duplicate_rows": table.duplicate_rows,
            "data_pages": list(table.data_pages),
            "graph_pages": list(table.graph_pages),
            "calculation_pages_ignored": list(table.calculation_pages),
            "epsg": epsg,
            "z_epsg": z_epsg,
        }
        self.info(
            "%s: %d row(s), step %s m, ground %s m, %d Rf / %d level mismatch(es), %d rejected",
            header.sounding_id,
            len(rows),
            step,
            ground,
            len(rf_flags),
            len(mismatches),
            len(table.rejected),
        )
        return DigitisedSounding(
            sounding_id=header.sounding_id,
            page_numbers=table.page_numbers,
            calibrations=(),
            curves=curves,
            printed_pre_drill_m=header.pre_drill_m,
            printed_cpt_type=header.cpt_type,
            table_provenance=provenance,
            issues=tuple(issues),
        )

    def _issues(
        self,
        table: PrintedTableSounding,
        rf_flags: list[float],
        mismatches: list[list[float]],
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
                        "fs / qc x 100 beyond the printed rounding: kept as printed"
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
        not_stored = table.columns_with(*_NOT_STORED_ROLES)
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
                    params={"derived": derived, "not_stored": not_stored},
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


def _rf_mismatches(rows: list[PrintedTableRow]) -> list[float]:
    """Return the depths whose printed Rf its own printed fs and qc cannot give."""
    flagged: list[float] = []
    for row in rows:
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
            flagged.append(row.depth_m)
    return flagged

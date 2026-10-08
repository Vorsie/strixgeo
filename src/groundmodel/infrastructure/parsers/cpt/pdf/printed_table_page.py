"""PrintedTablePage: what one sheet of a printed-table report holds."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from groundmodel.infrastructure.parsers.cpt.pdf.printed_sheet_header import PrintedSheetHeader
from groundmodel.infrastructure.parsers.cpt.pdf.printed_table_row import PrintedTableRow
from groundmodel.infrastructure.parsers.cpt.pdf.table_column_role import TableColumnRole


@dataclass(frozen=True)
class PrintedTablePage:
    """One sheet carrying a printed-table sheet header.

    Parameters
    ----------
    page_number : int
        1-based page number.
    header : PrintedSheetHeader
        The sheet header.
    kind : str
        ``PAGE_KIND_DATA`` (a table of measured values), ``PAGE_KIND_GRAPH``
        (the graph picture), ``PAGE_KIND_CALCULATION`` (a table holding a
        column the profile does not know: calculated output) or
        ``PAGE_KIND_HEADER_ONLY``.
    columns : tuple of str
        The column headers as printed, left to right (data and calculation
        pages).
    roles : dict
        Column header -> role (known columns only).
    rows : tuple of PrintedTableRow
        The rows read (data pages).
    rejected : tuple of dict
        Rows left out: ``{"page", "text", "reason"}``.
    unknown_columns : tuple of str
        Column headers the profile does not know (a calculation table).
    """

    page_number: int
    header: PrintedSheetHeader
    kind: str
    columns: tuple[str, ...] = field(default_factory=tuple)
    roles: dict[str, TableColumnRole] = field(default_factory=dict)
    rows: tuple[PrintedTableRow, ...] = field(default_factory=tuple)
    rejected: tuple[dict[str, Any], ...] = field(default_factory=tuple)
    unknown_columns: tuple[str, ...] = field(default_factory=tuple)

    @property
    def key(self) -> tuple[str, str]:
        """Return ``(report number, sounding id)``: the sounding this sheet belongs to."""
        return self.header.report_number, self.header.sounding_id

"""PrintedTableSounding: one sounding of a printed-table report, every sheet joined."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from groundmodel.infrastructure.parsers.cpt.pdf.printed_sheet_header import PrintedSheetHeader
from groundmodel.infrastructure.parsers.cpt.pdf.printed_table_row import PrintedTableRow
from groundmodel.infrastructure.parsers.cpt.pdf.table_column_role import TableColumnRole


@dataclass(frozen=True)
class PrintedTableSounding:
    """The rows of one sounding read from its table sheets, plus where they came from.

    Parameters
    ----------
    header : PrintedSheetHeader
        The header of its first data sheet.
    columns : tuple of str
        The column headers as printed (first data sheet).
    roles : dict
        Column header -> role.
    rows : tuple of PrintedTableRow
        Every row, by depth (a row printed twice is kept once).
    data_pages : tuple of int
        The table sheets (with an empty continuation sheet that follows one).
    graph_pages : tuple of int
        The graph sheets of the same sounding (the picture: the visual twin).
    calculation_pages : tuple of int
        Calculation tables of the same sounding, never read.
    rejected : tuple of dict
        Rows left out: ``{"page", "text", "reason"}``.
    duplicate_rows : int
        Rows printed again at a depth already read (the first is kept).
    """

    header: PrintedSheetHeader
    columns: tuple[str, ...]
    roles: dict[str, TableColumnRole]
    rows: tuple[PrintedTableRow, ...]
    data_pages: tuple[int, ...]
    graph_pages: tuple[int, ...] = field(default_factory=tuple)
    calculation_pages: tuple[int, ...] = field(default_factory=tuple)
    rejected: tuple[dict[str, Any], ...] = field(default_factory=tuple)
    duplicate_rows: int = 0

    @property
    def page_numbers(self) -> tuple[int, ...]:
        """Return the graph and table sheets of the sounding, page order."""
        return tuple(sorted(set(self.graph_pages) | set(self.data_pages)))

    def columns_with(self, *roles: TableColumnRole) -> list[str]:
        """Return the printed column names holding any of ``roles``, left to right.

        Parameters
        ----------
        *roles : TableColumnRole
            The roles wanted.

        Returns
        -------
        list of str
            The printed names.
        """
        return [name for name in self.columns if self.roles.get(name) in roles]

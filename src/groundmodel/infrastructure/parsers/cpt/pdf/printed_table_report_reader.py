"""PrintedTableReportReader: find the soundings a report prints as numeric tables."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

import pymupdf

from groundmodel.infrastructure.parsers.cpt.pdf.printed_table_constants import (
    BUILT_IN_PRINTED_TABLE_PROFILES,
    PAGE_KIND_CALCULATION,
    PAGE_KIND_DATA,
    PAGE_KIND_GRAPH,
    PAGE_KIND_HEADER_ONLY,
)
from groundmodel.infrastructure.parsers.cpt.pdf.printed_table_page import PrintedTablePage
from groundmodel.infrastructure.parsers.cpt.pdf.printed_table_page_reader import (
    PrintedTablePageReader,
)
from groundmodel.infrastructure.parsers.cpt.pdf.printed_table_profile import PrintedTableProfile
from groundmodel.infrastructure.parsers.cpt.pdf.printed_table_report import PrintedTableReport
from groundmodel.infrastructure.parsers.cpt.pdf.printed_table_row import PrintedTableRow
from groundmodel.infrastructure.parsers.cpt.pdf.printed_table_sounding import PrintedTableSounding
from groundmodel.infrastructure.parsers.cpt.pdf.sheet_header_helpers import (
    horizontal_epsg,
    vertical_epsg,
)
from groundmodel.shared.exceptions import TriageCancelled
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Two printed depths closer than this are the same row (m): the tables print
# centimetres.
_SAME_ROW_M = 0.001


@dataclass
class _Group:
    """The sheets of one sounding while the report is walked."""

    data: list[PrintedTablePage] = field(default_factory=list)
    empty: list[int] = field(default_factory=list)
    graphs: list[int] = field(default_factory=list)
    calculations: list[int] = field(default_factory=list)


class PrintedTableReportReader(GroundModelLogger):
    """Walk every page, read the printed-table sheets, join them per sounding.

    A sheet is joined to its sounding by its "<report> - <id>" header. The
    sounding's table sheets give the rows; its graph sheets (the picture) are
    kept as its visual twin, never digitised when the table exists (owner
    2026-10-08: "the printed table wins"); calculation tables are listed and
    left. The report names its coordinate system once, in the text (the
    sheets print "GPS X / GPS Y" only): taken when exactly one system is
    named, else the position is left for the user (never guessed).

    Parameters
    ----------
    profiles : sequence of PrintedTableProfile
        Printed-table profiles, tried in order.
    """

    def __init__(
        self, profiles: Sequence[PrintedTableProfile] = BUILT_IN_PRINTED_TABLE_PROFILES
    ) -> None:
        super().__init__(__name__)
        self._profiles = tuple(profiles)

    def read(
        self, doc: pymupdf.Document, should_stop: Callable[[], bool] | None = None
    ) -> PrintedTableReport:
        """Return the printed-table soundings of ``doc`` (empty when it has none).

        Parameters
        ----------
        doc : pymupdf.Document
            The report.
        should_stop : callable or None
            Checked before every page; True stops (the user cancelled).

        Returns
        -------
        PrintedTableReport
            The soundings, the named systems and the profile used.

        Raises
        ------
        TriageCancelled
            When ``should_stop`` answered True.
        """
        texts: list[str] = []
        for index in range(doc.page_count):
            if should_stop is not None and should_stop():
                raise TriageCancelled(index, doc.page_count)
            texts.append(doc[index].get_text())
        for profile in self._profiles:
            reader = PrintedTablePageReader(profile)
            sheets = [
                sheet
                for index, text in enumerate(texts)
                if profile.sheet_id.search(text)
                and (sheet := reader.read(doc[index], text)) is not None
            ]
            if not any(s.kind == PAGE_KIND_DATA for s in sheets):
                continue
            soundings = self._soundings(sheets)
            epsg = _named_once(texts, horizontal_epsg)
            z_epsg = _named_once(texts, vertical_epsg)
            self.success(
                "printed tables (%s): %d sounding(s) on %d sheet(s); system %s, datum %s",
                profile.name,
                len(soundings),
                len(sheets),
                epsg,
                z_epsg,
            )
            return PrintedTableReport(
                soundings=tuple(soundings), epsg=epsg, z_epsg=z_epsg, profile_name=profile.name
            )
        self.debug("printed tables: none in %d pages", doc.page_count)
        return PrintedTableReport()

    def _soundings(self, sheets: list[PrintedTablePage]) -> list[PrintedTableSounding]:
        """Group the sheets per sounding and join each sounding's table rows."""
        groups: dict[tuple[str, str], _Group] = {}
        previous: PrintedTablePage | None = None
        for sheet in sheets:
            group = groups.setdefault(sheet.key, _Group())
            if sheet.kind == PAGE_KIND_DATA:
                group.data.append(sheet)
            elif sheet.kind == PAGE_KIND_GRAPH:
                group.graphs.append(sheet.page_number)
            elif sheet.kind == PAGE_KIND_CALCULATION:
                group.calculations.append(sheet.page_number)
            elif (
                sheet.kind == PAGE_KIND_HEADER_ONLY
                and previous is not None
                and previous.kind == PAGE_KIND_DATA
                and previous.key == sheet.key
                and previous.page_number == sheet.page_number - 1
            ):
                # The table ran out exactly at a page end: an empty
                # continuation sheet of the same sounding.
                group.empty.append(sheet.page_number)
            previous = sheet
        out: list[PrintedTableSounding] = []
        total = sum(1 for g in groups.values() if g.data)
        for (report, sounding_id), group in groups.items():
            if not group.data:
                if group.graphs:
                    self.info(
                        "%s - %s: graph sheet(s) %s without a table: left to the graph reader",
                        report,
                        sounding_id,
                        group.graphs,
                    )
                continue
            joined = _join(group)
            self.info(
                "[%d/%d] %s - %s: %d row(s) %.2f-%.2f m on sheets %s, graph %s, %d rejected",
                len(out) + 1,
                total,
                report,
                sounding_id,
                len(joined.rows),
                joined.rows[0].depth_m if joined.rows else float("nan"),
                joined.rows[-1].depth_m if joined.rows else float("nan"),
                list(joined.data_pages),
                list(joined.graph_pages),
                len(joined.rejected),
            )
            if joined.calculation_pages:
                self.info(
                    "%s - %s: calculation table(s) on page(s) %s not read (calculated values)",
                    report,
                    sounding_id,
                    list(joined.calculation_pages),
                )
            out.append(joined)
        return sorted(out, key=lambda s: s.data_pages[0])


def _join(group: _Group) -> PrintedTableSounding:
    """Return one sounding from its table sheets (rows by depth, a reprinted row once)."""
    first = group.data[0]
    rows: list[PrintedTableRow] = []
    duplicates = 0
    for row in sorted((r for s in group.data for r in s.rows), key=lambda r: r.depth_m):
        if rows and abs(row.depth_m - rows[-1].depth_m) < _SAME_ROW_M:
            duplicates += 1
            continue
        rows.append(row)
    return PrintedTableSounding(
        header=first.header,
        columns=first.columns,
        roles=dict(first.roles),
        rows=tuple(rows),
        data_pages=tuple(sorted({s.page_number for s in group.data} | set(group.empty))),
        graph_pages=tuple(group.graphs),
        calculation_pages=tuple(group.calculations),
        rejected=tuple(r for s in group.data for r in s.rejected),
        duplicate_rows=duplicates,
    )


def _named_once(texts: list[str], name: Callable[[str], int | None]) -> int | None:
    """Return the EPSG the report names, when it names exactly one."""
    named = {epsg for text in texts if (epsg := name(text)) is not None}
    return named.pop() if len(named) == 1 else None

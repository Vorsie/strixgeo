"""PrintedTablePageReader: read one sheet of a printed-table report."""

from __future__ import annotations

import re
from typing import Any

import pymupdf

from groundmodel.infrastructure.parsers.cpt.pdf.page_word import PageWord
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import LINE_TOLERANCE_PT
from groundmodel.infrastructure.parsers.cpt.pdf.printed_sheet_header import PrintedSheetHeader
from groundmodel.infrastructure.parsers.cpt.pdf.printed_table_constants import (
    COLUMN_ALIGN_TOLERANCE_PT,
    COLUMN_PHRASE_GAP_PT,
    GRAPH_PICTURE_MIN_COVERAGE,
    PAGE_KIND_CALCULATION,
    PAGE_KIND_DATA,
    PAGE_KIND_GRAPH,
    PAGE_KIND_HEADER_ONLY,
)
from groundmodel.infrastructure.parsers.cpt.pdf.printed_table_helpers import (
    normalise_column_header,
    parse_printed_number,
)
from groundmodel.infrastructure.parsers.cpt.pdf.printed_table_page import PrintedTablePage
from groundmodel.infrastructure.parsers.cpt.pdf.printed_table_profile import PrintedTableProfile
from groundmodel.infrastructure.parsers.cpt.pdf.printed_table_row import PrintedTableRow
from groundmodel.infrastructure.parsers.cpt.pdf.table_column_role import TableColumnRole
from groundmodel.infrastructure.parsers.cpt.pdf.word_geometry import group_lines, phrases
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class PrintedTablePageReader(GroundModelLogger):
    """Read the sheet header and, on a data sheet, every printed row.

    A sheet belongs to the printed-table family when its text names
    "<report> - <sounding id>" (the profile's ``sheet_id``). Below the header
    a data sheet prints one line of column headers ("D TAW qc Fs Rf, % ...")
    and then one line per row, every number right-aligned under its header:
    each cell goes to the column whose header ends where the cell ends. A
    sheet without a column header but with a large picture is the graph
    sheet; a column header naming a column the profile does not know is a
    calculation table (bearing capacity), never data.

    Parameters
    ----------
    profile : PrintedTableProfile
        The family's conventions.
    """

    def __init__(self, profile: PrintedTableProfile) -> None:
        super().__init__(__name__)
        self._profile = profile

    def read(self, page: pymupdf.Page, text: str | None = None) -> PrintedTablePage | None:
        """Return the sheet read from ``page``, or None when it carries no sheet header.

        Parameters
        ----------
        page : pymupdf.Page
            The page.
        text : str or None
            The page's text layer when the caller already has it.

        Returns
        -------
        PrintedTablePage or None
            The sheet; None when the page names no "<report> - <id>".
        """
        text = page.get_text() if text is None else text
        sheet = self._profile.sheet_id.search(text)
        if sheet is None:
            return None
        number = page.number + 1
        words = [PageWord(*w[:5]) for w in page.get_text("words")]
        lines = group_lines(words, LINE_TOLERANCE_PT)
        found = self._column_header(lines)
        if found is None:
            top = _picture_top(page)
            kind = PAGE_KIND_GRAPH if top is not None else PAGE_KIND_HEADER_ONLY
            header_words = [w for w in words if top is None or w.y1 <= top]
            header = self._header(sheet.group("report"), sheet.group("id"), header_words, text)
            self.debug("page %d: %s sheet of %s", number, kind, header.sounding_id)
            return PrintedTablePage(page_number=number, header=header, kind=kind)
        index, columns = found
        header_row_top = min(w.y0 for w in lines[index])
        header_words = [w for w in words if w.y1 <= header_row_top]
        header = self._header(sheet.group("report"), sheet.group("id"), header_words, text)
        names = tuple(c.text for c in columns)
        roles = {
            c.text: role
            for c in columns
            if (role := self._profile.role_of(normalise_column_header(c.text))) is not None
        }
        unknown = tuple(name for name in names if name not in roles)
        if unknown or not self._profile.required_roles <= set(roles.values()):
            self.debug(
                "page %d: table of %s with columns %s not measured data (unknown %s)",
                number,
                header.sounding_id,
                list(names),
                list(unknown),
            )
            return PrintedTablePage(
                page_number=number,
                header=header,
                kind=PAGE_KIND_CALCULATION,
                columns=names,
                roles=roles,
                unknown_columns=unknown,
            )
        rows, rejected = self._rows(number, lines[index + 1 :], columns, roles)
        self.debug(
            "page %d: %s data sheet, %d row(s), %d rejected",
            number,
            header.sounding_id,
            len(rows),
            len(rejected),
        )
        return PrintedTablePage(
            page_number=number,
            header=header,
            kind=PAGE_KIND_DATA,
            columns=names,
            roles=roles,
            rows=tuple(rows),
            rejected=tuple(rejected),
        )

    def _column_header(self, lines: list[list[PageWord]]) -> tuple[int, list[PageWord]] | None:
        """Return the index and phrases of the column-header line, if the page has one.

        The column header is a line of short phrases, none a number, the first
        of which is the depth column, followed by at least one numeric row.
        """
        for i, line in enumerate(lines[:-1]):
            columns = phrases(line, gap=COLUMN_PHRASE_GAP_PT)
            if len(columns) < 2 or any(parse_printed_number(c.text) for c in columns):
                continue
            first = self._profile.role_of(normalise_column_header(columns[0].text))
            if first is not TableColumnRole.DEPTH:
                continue
            following = lines[i + 1]
            if following and parse_printed_number(following[0].text) is not None:
                return i, columns
        return None

    def _rows(
        self,
        page_number: int,
        lines: list[list[PageWord]],
        columns: list[PageWord],
        roles: dict[str, TableColumnRole],
    ) -> tuple[list[PrintedTableRow], list[dict[str, Any]]]:
        """Read the rows below the column header until the first non-numeric line."""
        rows: list[PrintedTableRow] = []
        rejected: list[dict[str, Any]] = []
        depth_name = next(n for n, r in roles.items() if r is TableColumnRole.DEPTH)
        depth_right = next(c.x1 for c in columns if c.text == depth_name)
        for line in lines:
            text = " ".join(w.text for w in line)
            if parse_printed_number(line[0].text) is None:
                if abs(line[0].x1 - depth_right) > COLUMN_ALIGN_TOLERANCE_PT:
                    break  # the footer ("Pagina 44 / 143"): the table has ended
                # A garbled depth cell: that row only is left out.
                garbled = f"{depth_name} '{line[0].text}' is not a number"
                self.warning("page %d: row '%s' left out: %s", page_number, text, garbled)
                rejected.append({"page": page_number, "text": text, "reason": garbled})
                continue
            cells, why = _cells(line, columns)
            parsed: dict[str, float | None] = {}
            decimals: dict[str, int] = {}
            for name in roles:
                cell = cells.get(name)
                if cell is None:
                    parsed[name] = None
                    continue
                number = parse_printed_number(cell)
                if number is None:
                    why = why or f"{name} '{cell}' is not a number"
                    continue
                parsed[name], decimals[name] = number
            depth = parsed.get(depth_name)
            qc = next((parsed.get(n) for n, r in roles.items() if r is TableColumnRole.QC), None)
            if why is None and (depth is None or qc is None):
                why = "no depth" if depth is None else "no qc"
            if why is not None or depth is None:
                self.warning("page %d: row '%s' left out: %s", page_number, text, why)
                rejected.append({"page": page_number, "text": text, "reason": why})
                continue
            rows.append(
                PrintedTableRow(
                    page_number=page_number,
                    depth_m=depth,
                    values=parsed,
                    decimals=decimals,
                    roles=dict(roles),
                    text=text,
                )
            )
        return rows, rejected

    def _header(
        self, report: str, sounding: str, words: list[PageWord], text: str
    ) -> PrintedSheetHeader:
        """Read the header fields from the words above the table (or the picture)."""
        p = self._profile
        lines = group_lines(words)
        block = "\n".join(" ".join(w.text for w in line) for line in lines)
        source = block or text
        test_type = p.test_type.search(source)
        standard = p.standard.search(source)
        cone = p.cone.search(source)
        date = p.test_date.search(source)
        position = p.position.search(source)
        groundwater = p.groundwater.search(source)
        remark = _remark(lines, p.remark_label)
        pre_drill = p.pre_drill.search(remark) if remark else None
        unmeasured = tuple(
            (_number(m.group("top")), _number(m.group("base")))
            for m in (p.no_measurement.finditer(remark) if remark else ())
        )
        kind = cone.group("kind") if cone else None
        return PrintedSheetHeader(
            report_number=report,
            sounding_id=sounding,
            test_type=test_type.group("type").upper() if test_type else None,
            standard=standard.group("part") if standard else None,
            application_class=standard.group("klass") if standard else None,
            cpt_type=p.cpt_type_by_cone.get(kind) if kind else None,
            cone=kind,
            test_date=date.group("date") if date else None,
            x=_number(position.group("x")) if position else None,
            y=_number(position.group("y")) if position else None,
            groundwater=groundwater.group("text").strip() if groundwater else None,
            remark=" ".join(remark.split()) if remark else None,
            pre_drill_m=_number(pre_drill.group("depth")) if pre_drill else None,
            no_measurement_intervals_m=unmeasured,
        )


def _remark(lines: list[list[PageWord]], label: re.Pattern[str]) -> str | None:
    """Return the remark block: the labelled line and the lines indented under it.

    The remark ends at the first line that starts left of the label (the
    table title "De terreingegevens ..." starts at the page margin).
    """
    for i, line in enumerate(lines):
        joined = " ".join(w.text for w in line)
        found = label.search(joined)
        if found is None:
            continue
        start = line[0].x0
        parts = [joined[found.start() :]]
        for nxt in lines[i + 1 :]:
            if nxt[0].x0 < start - LINE_TOLERANCE_PT:
                break
            parts.append(" ".join(w.text for w in nxt))
        return "\n".join(parts).strip()
    return None


def _number(text: str) -> float:
    """Return a printed number with a decimal comma as a float."""
    return float(text.replace(",", "."))


def _cells(line: list[PageWord], columns: list[PageWord]) -> tuple[dict[str, str], str | None]:
    """Return each column's cell text on one printed row, and why the row is malformed.

    A cell belongs to the column whose header ends where the cell ends
    (right-aligned numbers). A word under no column, or two words under one
    column, makes the row malformed.
    """
    cells: dict[str, str] = {}
    for word in line:
        nearest = min(columns, key=lambda c: abs(c.x1 - word.x1))
        if abs(nearest.x1 - word.x1) > COLUMN_ALIGN_TOLERANCE_PT:
            return cells, f"'{word.text}' is under no column"
        if nearest.text in cells:
            return cells, f"two cells under {nearest.text}"
        cells[nearest.text] = word.text
    return cells, None


def _picture_top(page: pymupdf.Page) -> float | None:
    """Return the top of the page's graph picture (an image covering a large share), if any."""
    area = float(page.rect.width * page.rect.height) or 1.0
    for info in page.get_image_info():
        box = pymupdf.Rect(info["bbox"]) & page.rect
        if not box.is_empty and box.width * box.height / area >= GRAPH_PICTURE_MIN_COVERAGE:
            return float(box.y0)
    return None

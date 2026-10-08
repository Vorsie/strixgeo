"""PrintedTableReport: the printed-table soundings found in a report."""

from __future__ import annotations

from dataclasses import dataclass, field

from groundmodel.infrastructure.parsers.cpt.pdf.printed_table_sounding import PrintedTableSounding


@dataclass(frozen=True)
class PrintedTableReport:
    """Every sounding a report prints as a table, and what the report says about them.

    Parameters
    ----------
    soundings : tuple of PrintedTableSounding
        Page order of their first table sheet.
    epsg : int or None
        The horizontal system the report names (the sheets print "GPS X/Y"
        only); None when it names none or more than one (never guessed).
    z_epsg : int or None
        The vertical datum the report names (TAW).
    profile_name : str
        The printed-table profile that matched.
    """

    soundings: tuple[PrintedTableSounding, ...] = field(default_factory=tuple)
    epsg: int | None = None
    z_epsg: int | None = None
    profile_name: str = ""

    @property
    def claimed_pages(self) -> frozenset[int]:
        """Return every page a printed-table sounding reads or shows (graph and table)."""
        return frozenset(p for s in self.soundings for p in s.page_numbers)

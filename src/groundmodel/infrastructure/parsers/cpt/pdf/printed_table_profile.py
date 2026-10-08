"""PrintedTableProfile: the conventions of one family of printed CPT tables."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from groundmodel.infrastructure.parsers.cpt.pdf.table_column_role import TableColumnRole


@dataclass(frozen=True)
class PrintedTableProfile:
    """How a report prints a sounding as a numeric table (the "printed table" family).

    Owner test 2026-10-08: some reports print each sounding twice, as a graph
    sheet (one pasted picture) and as a table of the measured values a row
    per 0.20 m. The table holds the exact values, so it is read instead of
    the picture. Everything report-family specific lives here, as for the
    graph-sheet :class:`LayoutProfile`: a new family needs a profile, not code.

    Parameters
    ----------
    name : str
        Registry key ("printed-table"); listed in the digest's profiles.
    sheet_id : re.Pattern
        The sheet header naming the report and the sounding, with the named
        groups ``report`` and ``id`` ("Z1234567 - CPTE001").
    column_roles : dict
        Normalised column header (see ``normalise_column_header``) -> role.
    required_roles : frozenset of TableColumnRole
        Roles a data table must have (depth and qc).
    test_type : re.Pattern
        The ISO 22476 test type ("proef type TE1"), group ``type``.
    standard : re.Pattern
        The ISO 22476 part and application class, groups ``part`` / ``klass``.
    cone : re.Pattern
        The cone line ("CPT-E 15 cm²"), group ``kind`` = E / M / U.
    cpt_type_by_cone : dict
        Cone letter -> the GEF CPT classification it is ("E" -> "CPTE").
    cone_area : re.Pattern or None
        The cone area the cone line names ("CPT-E 15 cm²"), group ``area``
        (cm²); None when the family prints none.
    test_date : re.Pattern
        The test date, group ``date``.
    position : re.Pattern
        The printed position, groups ``x`` and ``y``.
    groundwater : re.Pattern
        The groundwater remark, group ``text`` (kept verbatim).
    remark_label : re.Pattern
        The label that starts the free remark block.
    pre_drill : re.Pattern
        The pre-drill remark (owner vocabulary: voorboring = from the surface
        to the first value), group ``depth`` (m).
    no_measurement : re.Pattern
        A stretch pushed without measurement inside the sounding, groups
        ``top`` and ``base`` (m).
    """

    name: str
    sheet_id: re.Pattern[str]
    column_roles: dict[str, TableColumnRole]
    test_type: re.Pattern[str]
    standard: re.Pattern[str]
    cone: re.Pattern[str]
    cpt_type_by_cone: dict[str, str]
    test_date: re.Pattern[str]
    position: re.Pattern[str]
    groundwater: re.Pattern[str]
    remark_label: re.Pattern[str]
    pre_drill: re.Pattern[str]
    no_measurement: re.Pattern[str]
    required_roles: frozenset[TableColumnRole] = field(
        default_factory=lambda: frozenset({TableColumnRole.DEPTH, TableColumnRole.QC})
    )
    cone_area: re.Pattern[str] | None = None

    def role_of(self, normalised_header: str) -> TableColumnRole | None:
        """Return the role of a normalised column header, or None when unknown.

        Parameters
        ----------
        normalised_header : str
            The header as ``normalise_column_header`` returns it.

        Returns
        -------
        TableColumnRole or None
            The role; None for a column this profile does not know.
        """
        return self.column_roles.get(normalised_header)

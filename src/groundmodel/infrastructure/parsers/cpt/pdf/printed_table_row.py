"""PrintedTableRow: one row of a printed CPT table, as printed."""

from __future__ import annotations

from dataclasses import dataclass, field

from groundmodel.infrastructure.parsers.cpt.pdf.table_column_role import TableColumnRole


@dataclass(frozen=True)
class PrintedTableRow:
    """The cells of one printed row.

    Parameters
    ----------
    page_number : int
        1-based page the row is printed on.
    depth_m : float
        The printed depth (m below ground level).
    values : dict
        Column name as printed -> value; None for a blank cell.
    decimals : dict
        Column name -> decimals printed (for the rounding-aware checks).
    roles : dict
        Column name -> its role.
    text : str
        The row as printed, cells joined by spaces.
    """

    page_number: int
    depth_m: float
    values: dict[str, float | None]
    decimals: dict[str, int] = field(default_factory=dict)
    roles: dict[str, TableColumnRole] = field(default_factory=dict)
    text: str = ""

    def value(self, role: TableColumnRole) -> float | None:
        """Return the value of the (first) column with ``role``, or None.

        Parameters
        ----------
        role : TableColumnRole
            The role wanted.

        Returns
        -------
        float or None
            The printed value; None when blank or when the table has no such
            column.
        """
        for name, r in self.roles.items():
            if r is role:
                return self.values.get(name)
        return None

    def decimals_of(self, role: TableColumnRole) -> int:
        """Return how many decimals the (first) column with ``role`` printed (0 when none)."""
        for name, r in self.roles.items():
            if r is role:
                return self.decimals.get(name, 0)
        return 0

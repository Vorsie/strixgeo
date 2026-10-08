"""BoreholeLayoutProfile: what one company's borehole-log layout prints, and where."""

from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass(frozen=True)
class BoreholeLayoutProfile:
    """The label words and units of one borehole-log layout.

    A new layout needs a profile, not new code (the CPT digitiser's rule).
    Detection runs on a page's whole text: every ``required`` pattern must
    match. The header fields are read as "label: value" on one printed line.

    Parameters
    ----------
    name : str
        Stable profile id, stored on the provenance ("boorstaat").
    required : tuple of re.Pattern
        Patterns that must all match the page text for the profile to apply.
    header_fields : tuple of (str, re.Pattern)
        Field name -> its printed label. Names used: ``name``, ``x``, ``y``,
        ``ground_level``, ``water``, ``date``, ``driller``, ``project_code``,
        ``project_name``, ``remark``, ``page_of``.
    level_pattern : re.Pattern or None
        A printed level label (``"-78"`` in cm, ``"-22.49"`` in m); None for a
        triage-only profile that does not read rows.
    level_unit_m : float
        Metres per level unit (0.01 for cm TAW, 1.0 for m TAW).
    axis_unit_m : float
        Metres per depth-axis label unit.
    identification_pattern : re.Pattern or None
        Captures the identification standard the sheet names
        ("Identificatie volgens NEN-EN-ISO 14688" -> "NEN-EN-ISO 14688").
    sample_mark_meaning : dict
        Sample-bar fill -> the sample type the layout's printed legend gives
        it ({"open": "geroerd", "filled": "ongeroerd"}); empty when the legend
        was not checked, so no type is invented.
    parses_rows : bool
        False for a triage-only profile (classifies and names, reads no rows).
    """

    name: str
    required: tuple[re.Pattern[str], ...]
    header_fields: tuple[tuple[str, re.Pattern[str]], ...]
    level_pattern: re.Pattern[str] | None
    level_unit_m: float = 0.01
    axis_unit_m: float = 0.01
    identification_pattern: re.Pattern[str] | None = None
    sample_mark_meaning: dict[str, str] = field(default_factory=dict)
    parses_rows: bool = True

    def matches(self, page_text: str) -> bool:
        """Return whether the page text carries every required pattern.

        Parameters
        ----------
        page_text : str
            The page's words joined by spaces.

        Returns
        -------
        bool
            True when the profile applies.
        """
        return all(p.search(page_text) for p in self.required)

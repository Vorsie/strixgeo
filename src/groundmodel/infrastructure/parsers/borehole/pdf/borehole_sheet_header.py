"""BoreholeSheetHeader: the "label: value" fields one sheet prints, raw."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from groundmodel.infrastructure.parsers.cpt.pdf.page_word import PageWord


@dataclass(frozen=True)
class BoreholeSheetHeader:
    """The header fields of one sheet as printed (no unit conversion here).

    Parameters
    ----------
    fields : dict
        Field name -> ``(label, value)``: the label text as printed (it names
        the unit and the coordinate system) and the value text after it.
    label_boxes : dict
        Field name -> the label's box, so the sheet reader can stop the
        description column above the footer fields.
    identification_standard : str or None
        The identification standard the sheet names ("NEN-EN-ISO 14688").
    """

    fields: dict[str, tuple[str, str]] = field(default_factory=dict)
    label_boxes: dict[str, PageWord] = field(default_factory=dict)
    identification_standard: str | None = None

    def value(self, name: str) -> str | None:
        """Return a field's printed value, or None when the sheet prints none.

        Parameters
        ----------
        name : str
            Field name (``"name"``, ``"x"``, ...).

        Returns
        -------
        str or None
            The value; None when absent or empty.
        """
        entry = self.fields.get(name)
        return entry[1] if entry and entry[1] else None

    def label(self, name: str) -> str | None:
        """Return a field's printed label, or None when the sheet prints none.

        Parameters
        ----------
        name : str
            Field name.

        Returns
        -------
        str or None
            The label text.
        """
        entry = self.fields.get(name)
        return entry[0] if entry else None

    def to_dict(self) -> dict[str, Any]:
        """Return the raw fields as a JSON-ready dict."""
        return {
            "fields": {k: {"label": v[0], "value": v[1]} for k, v in self.fields.items()},
            "identification_standard": self.identification_standard,
        }

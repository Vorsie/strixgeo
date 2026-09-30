"""Response schema for one value the lab reported (read-only, never an input)."""

from __future__ import annotations

from pydantic import BaseModel


class LabSeriesLabResultResponse(BaseModel):
    """A lab-reported summary value (owner 2026-09-29: listed, never used).

    Parameters
    ----------
    specimen_label : str or None
        The lab's specimen letter; ``None`` for the oedometer.
    stage_index : int or None
        The lab's stage number (0 = initial state); ``None`` for a
        specimen-level value.
    parameter : str
        The lab's label verbatim (``e``, ``Cc``, ``Watergehalte (voor de proef)``).
    value_numeric : float or None
        The number, when the lab wrote one.
    value_text : str or None
        The text, when the value is not a number (failure description).
    unit : str or None
        Unit as printed.
    provenance : str
        Always ``lab_reported``.
    """

    specimen_label: str | None = None
    stage_index: int | None = None
    parameter: str
    value_numeric: float | None = None
    value_text: str | None = None
    unit: str | None = None
    provenance: str

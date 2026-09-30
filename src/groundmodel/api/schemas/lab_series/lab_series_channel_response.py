"""Response schema for one lab-series channel (one value per reading)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class LabSeriesChannelResponse(BaseModel):
    """One named reading series of a stage.

    Parameters
    ----------
    channel_key : str
        Canonical key (``settlement_mm``, ``force_n``, ``vertical_strain`` ...).
    source_label : str or None
        The lab's column heading verbatim (Dutch), or the Strix name of a
        derived channel.
    unit : str or None
        Unit of the values.
    provenance : str
        ``measured`` | ``lab_derived`` | ``derived``. A ``derived`` channel
        carries ``formula`` and ``derivation_inputs``.
    values : list[float or None]
        One value per reading of the stage; ``null`` = unreadable cell.
    formula : str or None
        How a derived channel was computed.
    derivation_inputs : dict or None
        The inputs of the derivation (e.g. ``{"h0_mm": 19.96}``).
    """

    channel_key: str
    source_label: str | None = None
    unit: str | None = None
    provenance: str
    values: list[float | None]
    formula: str | None = None
    derivation_inputs: dict[str, Any] | None = None

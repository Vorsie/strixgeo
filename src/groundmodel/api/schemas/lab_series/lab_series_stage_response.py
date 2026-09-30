"""Response schema for one lab-series stage (load step / shear phase)."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from groundmodel.api.schemas.lab_series.lab_series_channel_response import (
    LabSeriesChannelResponse,
)


class LabSeriesStageResponse(BaseModel):
    """One stage with its reading axis and its channels.

    Parameters
    ----------
    stage_index : int
        1-based, test order (the lab's stage number for an oedometer).
    stage_kind : str
        ``load_step`` (oedometer) | ``shear`` (triaxial).
    direction_token : str or None
        ``Belasting`` / ``Ontlasting`` verbatim, when the export has one.
    hanger_load_kg, target_stress_kpa, height_at_start_mm : float or None
        Stage values as the export lists them (pass-through).
    lab_stage_settlement_mm, lab_coefficient : float or None
        The lab's stage values (lab-derived).
    lab_coefficient_label : str or None
        ``C`` or ``A`` as printed.
    started_at : datetime or None
        First reading of the stage (oedometer).
    reading_timestamps : list[datetime] or None
        Absolute time of every reading (oedometer).
    point_numbers : list[int] or None
        The lab's point numbers (triaxial: the only axis the dump carries).
    rezero_indices : list[int]
        Readings repeating a timestamp at a dial re-zero: a viewer skips them.
    n_readings : int
        Readings in the stage (the duplicate included).
    channels : list[LabSeriesChannelResponse]
        The stage's channels.
    """

    stage_index: int
    stage_kind: str
    direction_token: str | None = None
    hanger_load_kg: float | None = None
    target_stress_kpa: float | None = None
    height_at_start_mm: float | None = None
    lab_stage_settlement_mm: float | None = None
    lab_coefficient_label: str | None = None
    lab_coefficient: float | None = None
    started_at: datetime | None = None
    reading_timestamps: list[datetime] | None = None
    point_numbers: list[int] | None = None
    rezero_indices: list[int] = []
    n_readings: int
    channels: list[LabSeriesChannelResponse] = []

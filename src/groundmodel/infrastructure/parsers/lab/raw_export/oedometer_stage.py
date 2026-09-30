"""One load step of an oedometer test with every reading the lab logged."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class OedometerStage:
    """One load step ("trap") and its raw readings, as parallel lists.

    Parameters
    ----------
    stage_number : int
        The lab's stage number, 1-based, in test order.
    direction : str
        The lab's direction token, verbatim: ``"Belasting"`` (loading) or
        ``"Ontlasting"`` (unloading). Reloading is not a separate token.
    hanger_load_kg : float or None
        Dead load on the lever hanger, kg.
    stress_kpa : float or None
        Vertical stress on the specimen as the lab listed it, kPa.
    timestamps : list[datetime]
        Absolute time of each reading (local lab time, no zone).
    dial_readings : list[float or None]
        Raw dial-gauge reading per reading, in gauge units. NOT always
        continuous: a gauge re-zero shows as a jump at a repeated timestamp.
    elapsed_min : list[float or None]
        Minutes since the start of the stage, as listed.
    settlement_mm : list[float or None]
        Settlement since the start of the stage, mm (compression positive).
    total_settlement_mm : list[float or None]
        Settlement since the start of the test, mm.
    height_at_start_mm : float or None
        Specimen height at the stage start ("hi,0"), mm.
    stage_settlement_mm : float or None
        Settlement at the end of the stage per the footer, mm.
    lab_coefficient_label : str or None
        ``"C"`` (compression) or ``"A"`` (swelling) as printed; ``None`` for
        stage 1, which prints none.
    lab_coefficient : float or None
        The lab's C or A value for the stage (lab-derived, pass-through).
    rezero_indices : list[int]
        0-based indices of readings that REPEAT the previous reading's
        timestamp at a dial-gauge re-zero. The reading is kept as read (the
        raw record stays whole) but a consumer that plots or counts readings
        skips these indices, so no series counts the moment twice.
    extra_channels : dict[str, list[float or None]]
        Format-specific per-reading columns beyond the five above, keyed by
        canonical channel key (the newer oedometer module logs the load on
        the hanger and the time since the test start per reading). Same
        length as ``elapsed_min``.
    """

    stage_number: int
    direction: str
    hanger_load_kg: float | None
    stress_kpa: float | None
    timestamps: list[datetime] = field(default_factory=list)
    dial_readings: list[float | None] = field(default_factory=list)
    elapsed_min: list[float | None] = field(default_factory=list)
    settlement_mm: list[float | None] = field(default_factory=list)
    total_settlement_mm: list[float | None] = field(default_factory=list)
    height_at_start_mm: float | None = None
    stage_settlement_mm: float | None = None
    lab_coefficient_label: str | None = None
    lab_coefficient: float | None = None
    rezero_indices: list[int] = field(default_factory=list)
    extra_channels: dict[str, list[float | None]] = field(default_factory=dict)

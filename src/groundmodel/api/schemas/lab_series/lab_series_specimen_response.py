"""Response schema for one lab-series specimen."""

from __future__ import annotations

from datetime import date
from typing import Any

from pydantic import BaseModel

from groundmodel.api.schemas.lab_series.lab_series_stage_response import (
    LabSeriesStageResponse,
)


class LabSeriesSpecimenResponse(BaseModel):
    """One specimen (triaxial a / b / c, or the oedometer's one) with its stages.

    Every value is the lab's, pass-through; ``None`` where the export does not
    carry it. ``source_header`` holds every header label verbatim.
    """

    specimen_label: str | None = None
    initial_height_mm: float | None = None
    initial_diameter_mm: float | None = None
    initial_wet_mass_g: float | None = None
    dry_mass_g: float | None = None
    initial_water_content_pct: float | None = None
    grain_density_t_m3: float | None = None
    grain_density_note: str | None = None
    specimen_depth_top_m: float | None = None
    specimen_depth_base_m: float | None = None
    strain_rate_mm_per_min: float | None = None
    consolidation_stress_kpa: float | None = None
    consolidation_volume_change_cm3: float | None = None
    failure_description: str | None = None
    apparatus_id: str | None = None
    lever_ratio: float | None = None
    dial_coefficient_mm_per_unit: float | None = None
    mounting_date: date | None = None
    source_header: dict[str, Any] = {}
    n_points: int = 0
    stages: list[LabSeriesStageResponse] = []

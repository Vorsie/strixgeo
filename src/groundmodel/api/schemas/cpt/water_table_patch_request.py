"""Request schema for the engineer-set CPT water table."""

from __future__ import annotations

from pydantic import BaseModel, Field


class WaterTablePatchRequest(BaseModel):
    """Engineer-entered depth to groundwater for one CPT.

    Sent by the Parameters stage's per-CPT inspector when the engineer clicks
    the water-table line and types a value (owner ruling, dogfeed 2026-08-03).
    The whole Robertson normalisation hangs off this number, so it is stamped
    ``WaterDepthSource.ENGINEER`` and a later re-import of the same file will
    NOT overwrite it.

    Parameters
    ----------
    water_depth_m : float | None
        Depth to groundwater BELOW GROUND SURFACE in metres, positive down.
        ``None`` clears the engineer's value: the file's depth is RESTORED
        when the first override snapshotted one
        (``domain.services.water_table_rollback``), otherwise the CPT returns
        to "nothing recorded" and consumers fall back to the project-wide
        assumption and label it as assumed.

        The range guard (0 to 500 m) rejects a negative depth (a water table
        above the collar is expressed as 0 here — the stress profile's
        "water at or above ground surface" branch) and a depth deeper than any
        CPT ever pushed, which can only be a typo.
    """

    water_depth_m: float | None = Field(default=None, ge=0.0, le=500.0)

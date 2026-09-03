"""Request schema for the engineer-set CPT water table."""

from __future__ import annotations

from pydantic import Field

from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class WaterTablePatchRequest(StrictRequestModel):
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

        NEGATIVE means the water stands ABOVE the collar — the offshore case,
        where the collar is the seabed and the sea is over it (owner ruling
        2026-08-23: *"waterdepth can be negative too, offshore for example"*).
        This used to be floored at 0, which silently rewrote the engineer's
        observation on the way in: a CPT could not say whether the water was
        at the seabed or fifteen metres above it.

        Recording it is a PROVENANCE gain, not a numerical one.
        ``robertson_2015.stress_profile`` puts the pore-pressure datum at the
        ground surface, so its case-1 branch ("water at or above ground
        surface") already yields identical stresses for 0 and for -15. Should
        a future offshore pipeline need the water column in sigma_v, that is a
        change to the stress branch, not to this bound.

        The range guard (-500 to 500 m) still rejects a depth further from the
        collar than any CPT ever worked, which can only be a typo or a corrupt
        file.
    """

    water_depth_m: float | None = Field(default=None, ge=-500.0, le=500.0)

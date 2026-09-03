"""Shared request schema for the manual surface-elevation editor.

Used by both ``PATCH /cpt/{id}/elevation`` and ``PATCH /borehole/{id}/elevation``
since the payload shape is identical for both record types.
"""

from __future__ import annotations

from pydantic import Field

from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class ElevationPatchRequest(StrictRequestModel):
    """User-entered surface elevation update.

    Sent by the desktop frontend's ``ElevationEditor`` when the user fills in
    the missing Z for a CPT or borehole that came in without one. Setting
    ``elevation_m=None`` clears the value (returns the record to the
    "needs Z" state) — this is reachable from the editor's clear button.

    Parameters
    ----------
    elevation_m : float | None
        Surface elevation in metres. ``None`` clears the previously-entered
        value. The range guard (-500 to +9000 m) catches typos that would
        place the surface below the deepest oceanic trench or above Everest;
        legitimate values for DOV-Belgium imports sit in roughly -5 to +700 m.
    z_epsg : int | None
        Vertical CRS code for the supplied elevation. ``None`` means "use the
        platform default" — the router substitutes ``5710`` (mTAW) when the
        user supplied ``elevation_m`` without picking a vertical CRS, since
        the desktop UI doesn't expose a CRS picker today and DOV-Belgium
        imports are exclusively in mTAW. When ``elevation_m`` is also ``None``
        the router clears ``z_epsg`` to keep the two columns consistent.
    """

    elevation_m: float | None = Field(default=None, ge=-500.0, le=9000.0)
    z_epsg: int | None = None

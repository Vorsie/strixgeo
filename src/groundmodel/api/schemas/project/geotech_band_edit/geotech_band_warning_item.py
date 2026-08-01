"""Pydantic schema: :class:`GeotechBandWarningItem`."""

from __future__ import annotations

from pydantic import BaseModel, Field


class GeotechBandWarningItem(BaseModel):
    """One advisory consequence of a hand edit. Advisory — never blocking.

    Parameters
    ----------
    code : str
        ``qc_pull_down`` / ``qc_pull_up`` / ``qc_unavailable`` /
        ``below_minimum_thickness``.
    message : str
        Plain-language consequence, ready to show.
    depth_top_m : float
        Top of the interval the warning is about (m).
    depth_base_m : float
        Base of the interval the warning is about (m).
    band_id : str | None
        The existing band the warning names, when it names one.
    """

    code: str = Field(..., description="Warning code the UI switches on.")
    message: str = Field(..., description="Plain-language consequence.")
    depth_top_m: float = Field(..., description="Interval top (m).")
    depth_base_m: float = Field(..., description="Interval base (m).")
    band_id: str | None = Field(None, description="The band the warning names.")

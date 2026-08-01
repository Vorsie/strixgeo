"""Pydantic schema: :class:`GeotechBandIntervalItem`."""

from __future__ import annotations

from pydantic import BaseModel, Field


class GeotechBandIntervalItem(BaseModel):
    """One interval a split or merge would produce, with its re-derived class.

    Parameters
    ----------
    depth_top_m : float
        Interval top (m, positive down).
    depth_base_m : float
        Interval base (m, positive down).
    median_qc_mpa : float | None
        The interval's representative cone resistance — the MEDIAN, which is the
        statistic the build classifies on. ``None`` when the qc cannot answer.
        Label it "representative qc", not "average qc".
    nad_class : int | None
        The re-derived NAD packing class, or ``None`` when the qc cannot answer
        (the band is then flagged for review, never given a guessed class).
    previous_nad_class : int | None
        The class the interval's material carries today.
    class_changed : bool
        Whether the re-derivation moved the class.
    unclassifiable_reason : str | None
        Why no class could be derived; ``None`` on the happy path.
    """

    depth_top_m: float = Field(..., description="Interval top (m, positive down).")
    depth_base_m: float = Field(..., description="Interval base (m, positive down).")
    median_qc_mpa: float | None = Field(
        None, description="Representative (median) qc over the interval, MPa."
    )
    nad_class: int | None = Field(None, description="Re-derived NAD packing class.")
    previous_nad_class: int | None = Field(None, description="Class carried today.")
    class_changed: bool = Field(..., description="Whether the class moved.")
    unclassifiable_reason: str | None = Field(
        None, description="Why the qc could not answer, when it could not."
    )

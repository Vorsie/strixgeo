"""Pydantic schema for the per-CPT soil-behaviour-type profile endpoint."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class CptSbtProfileResponse(BaseModel):
    """Both Robertson classifications per depth point, from GET /cpt/{id}/sbt-profile.

    All arrays are parallel and ordered shallow → deep, matching
    ``CptPlotResponse`` so the two can be rendered on one shared depth axis
    without re-indexing.  ``None`` marks a depth point that could not be
    classified (missing sleeve friction, or a non-positive net cone resistance
    near the surface) — never a filled-in guess.

    Nothing here is stored: the profile is derived on read from the persisted
    qc / fs series (Data Integrity Rule 1), which is why ``gwt_m`` and
    ``gwt_source`` ride along — a surface showing a derived strip has to be
    able to say what it was derived under.

    Parameters
    ----------
    cpt_id:
        Primary key of the CPT record.
    depths_m:
        Measurement depths in metres below ground surface.
    ic:
        Normalised soil-behaviour-type index Ic from the full Robertson-2015
        pipeline (stress profile → iterative Qtn / F / Ic convergence).
        Identical to the ``ic`` array of ``GET /cpt/{id}/plot``.
    zone_normalised:
        Robertson (2009) chart zone 1–9 from that same pipeline, including the
        extended organic/peat outcome (Lengkeek & Brinkgreve 2022).
    i_sbt:
        Non-normalised soil-behaviour-type index I_SBT (Robertson 2010) — reads
        qc/pa and Rf directly, so it needs neither a stress profile nor a water
        table.  The appropriate classifier at shallow depth.
    zone_non_normalised:
        SBT zone 2–7 from ``i_sbt``.  Zones 1, 8 and 9 are not identifiable
        from the index alone and are never emitted.
    gwt_m:
        Depth to groundwater below ground surface, in metres, that the
        NORMALISED columns were computed under.
    gwt_source:
        Provenance of ``gwt_m``: ``"recorded"`` (parsed from the file),
        ``"engineer"`` (typed in the app), or ``"assumed"`` (nothing recorded —
        the project-wide default was used, and the UI must say so).
    """

    cpt_id: UUID
    depths_m: list[float]
    ic: list[float | None]
    zone_normalised: list[int | None]
    i_sbt: list[float | None]
    zone_non_normalised: list[int | None]
    gwt_m: float
    gwt_source: Literal["recorded", "engineer", "assumed"]

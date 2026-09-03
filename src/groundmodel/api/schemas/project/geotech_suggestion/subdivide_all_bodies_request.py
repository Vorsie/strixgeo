"""Pydantic schema: :class:`SubdivideAllBodiesRequest`."""

from __future__ import annotations

from uuid import UUID

from pydantic import Field

from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class SubdivideAllBodiesRequest(StrictRequestModel):
    """Body of ``POST .../geotech/subdivide-all-bodies`` and ``.../subdivide-cpts``.

    Geotech layers are written once per investigation (section-independent);
    correlation edges are derived per-section from the litho model's approved
    edges.  Which investigations take part is decided by SECTION MEMBERSHIP —
    see ``section_id`` below.

    Parameters
    ----------
    litho_model_id : UUID
        The lithostratigraphic model whose picks drive the subdivision.
        (The litho model id also appears in the URL as ``model_id``; this
        field is the canonical source used by the use case.)
    section_id : UUID | None
        Restrict the subdivision to the investigations that project onto ONE
        section (owner ruling 2026-08-15: *"i want subdivide cpt's also to be
        section scoped"*).  ``None`` (the default) takes every investigation
        that projects onto ANY section of the project — the historic breadth
        MINUS the ones that appear on no section at all, which the same ruling
        excludes from the model in both modes.
    representative_statistic : str | None
        Which representative qc the NAD classifier reads, chosen BEFORE the
        geotech model exists (owner ruling 2026-08-15: *"i can't choose
        harmonic qc before first subdivide, that's friction we don't need?"*).
        Honoured ONLY when this call CREATES the geotech model; on a re-run the
        model's own choice stands and ``POST .../geotech/statistic`` remains
        the one way to change it.  ``None`` (the default) is the historic
        behaviour — the model is created under ``median``.
    """

    litho_model_id: UUID
    section_id: UUID | None = Field(default=None)
    skip_existing: bool = Field(
        default=False,
        description=(
            "Owner ruling 2026-08-18: a column that already carries geotech "
            "bands is imported as-is and skipped — the first subdivision wins, "
            "so a tie section never tells a second story. False keeps the "
            "historic idempotent rebuild (statistic re-runs need it)."
        ),
    )
    representative_statistic: str | None = Field(
        default=None,
        description=(
            "Create the geotech model under this representative qc statistic "
            "('median' | 'arithmetic' | 'harmonic' | 'geometric'). Ignored "
            "when the model already exists; omit for the median default."
        ),
    )

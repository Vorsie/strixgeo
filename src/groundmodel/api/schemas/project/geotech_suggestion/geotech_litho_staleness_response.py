"""Pydantic schema: :class:`GeotechLithoStalenessResponse` and its column item."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field


class StaleGeotechColumnItem(BaseModel):
    """One column whose litho stack moved after its packing bands were made.

    Parameters
    ----------
    investigation_id : UUID
        The CPT or borehole the bands are anchored on.  The renderer already
        holds both lists, so the kind is left for it to look up rather than
        duplicated here.
    label : str
        Display name (``"GEO-23/125-S17"``), so the toolbar can name the column
        to re-press.  Falls back to the id when the row cannot be resolved.
    """

    investigation_id: UUID = Field(..., description="CPT or borehole the stale bands sit on.")
    label: str = Field(..., description="Display name of that investigation.")


class GeotechLithoStalenessResponse(BaseModel):
    """Response of ``GET .../geotech/litho-staleness`` (debt #266).

    Answers the question the geotech axis could not previously ask: has the
    lithology under these packing bands been edited since they were made?  The
    bands are derived from the litho stack, so a moved litho contact leaves them
    describing ground that is no longer there — and until this shipped, nothing
    said so, all the way into a client-facing export.

    Derived on every read by comparing the digests the last press stamped
    against the litho as it stands now, so it self-clears when the affected
    columns are re-pressed and there is nothing to acknowledge or reset.

    Parameters
    ----------
    geotech_model_id : UUID
        The geotechnical model the answer describes.
    litho_model_id : UUID | None
        Its parent lithostratigraphic model — the one the comparison is against.
        ``None`` only for a model with no parent, where nothing can be compared.
    stale_columns : list[StaleGeotechColumnItem]
        The columns to re-press, sorted by label.
    stale_column_count : int
        ``len(stale_columns)``, carried explicitly so a caller that wants only
        the chip count does not have to read the list.
    banded_column_count : int
        Columns carrying at least one band.
    unstamped_column_count : int
        Banded columns with no record of what they were built from — bands made
        before this stamp shipped.  NOT counted as stale: unknown provenance is
        not evidence the ground moved, and calling it stale would flag whole
        existing models on first open.  Reported separately because an export
        guard needs to tell "verified current" from "cannot say".
    """

    geotech_model_id: UUID = Field(..., description="The geotechnical model.")
    litho_model_id: UUID | None = Field(
        default=None, description="Parent litho model the bands are compared against."
    )
    stale_columns: list[StaleGeotechColumnItem] = Field(
        default_factory=list,
        description="Columns whose litho moved after their bands were made.",
    )
    stale_column_count: int = Field(default=0, description="How many columns are stale.")
    banded_column_count: int = Field(default=0, description="Columns carrying at least one band.")
    unstamped_column_count: int = Field(
        default=0,
        description="Banded columns with no recorded provenance (not stale — unknown).",
    )

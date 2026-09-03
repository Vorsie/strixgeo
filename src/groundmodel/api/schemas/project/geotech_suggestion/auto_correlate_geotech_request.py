"""Pydantic schema: :class:`AutoCorrelateGeotechRequest`."""

from __future__ import annotations

from uuid import UUID

from pydantic import Field

from groundmodel.api.schemas.strict_request_model import StrictRequestModel


class AutoCorrelateGeotechRequest(StrictRequestModel):
    """Body of ``POST .../geotech/auto-correlate``.

    Mirrors the litho axis's ``AutoCorrelateContactRequest`` in shape; the
    geotech rule takes no tunables (the NAD-class sequence match has no depth
    window), so ``section_id`` is the only field.

    Attributes
    ----------
    section_id : UUID | None
        Restrict the run to one section.  ``None`` (the default) proposes ties
        across every section of the project, which is how the engineer
        regenerates the automatic ties for a whole multi-section model in one
        press.
    """

    section_id: UUID | None = Field(default=None)

"""Pydantic schema: :class:`FormationContactBatchUpdateRequest`."""

from __future__ import annotations

from pydantic import Field

from groundmodel.api.schemas.strict_request_model import StrictRequestModel

from .formation_contact_batch_update_entry import FormationContactBatchUpdateEntry


class FormationContactBatchUpdateRequest(StrictRequestModel):
    """Body of ``PUT /projects/{pid}/geology/models/{mid}/contacts/batch``.

    All-or-nothing: every entry's contact must belong to the URL's
    model (the use case validates scope before mutating). A single
    transaction commit covers the whole list, so a failure on entry
    N rolls back the first N-1 updates. ``min_length=1`` rejects
    no-op calls; ``max_length=500`` keeps a single transaction
    bounded — multi-drag selections on real projects rarely exceed a
    handful of contacts, never hundreds.
    """

    updates: list[FormationContactBatchUpdateEntry] = Field(min_length=1, max_length=500)

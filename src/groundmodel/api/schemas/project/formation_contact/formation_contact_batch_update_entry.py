"""Pydantic schema: :class:`FormationContactBatchUpdateEntry`."""

from __future__ import annotations

from uuid import UUID

from .formation_contact_update_request import FormationContactUpdateRequest


class FormationContactBatchUpdateEntry(FormationContactUpdateRequest):
    """One row in a ``PUT /contacts/batch`` payload.

    Inherits every field + the XOR validator from
    :class:`FormationContactUpdateRequest` and adds the target
    ``contact_id``. Inheriting keeps the anchor / XOR semantics
    identical to a single PATCH — the batch endpoint is just N PATCHes
    in one transaction.
    """

    contact_id: UUID

"""Pydantic schema: :class:`FormationContactBatchUpdateResponse`."""

from __future__ import annotations

from pydantic import BaseModel

from .formation_contact_response import FormationContactResponse


class FormationContactBatchUpdateResponse(BaseModel):
    """Body returned by ``PUT /contacts/batch`` — updated rows in
    input order so the client can patch its local state by index.
    """

    contacts: list[FormationContactResponse]

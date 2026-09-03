"""Pydantic schema: :class:`FormationContactUpdateRequest`."""

from __future__ import annotations

from uuid import UUID

from pydantic import model_validator

from groundmodel.api.schemas.strict_request_model import StrictRequestModel

from .contact_enums import ContactConfidence, ContactSource


class FormationContactUpdateRequest(StrictRequestModel):
    """Body of ``PATCH /projects/{pid}/geology/models/{mid}/contacts/{cid}``.

    Only fields present in the body are written. The anchor
    (``borehole_id`` / ``cpt_id``) IS updatable so the section
    editor can drag-re-anchor a contact onto another investigation
    without a delete+recreate round trip. To keep the XOR invariant
    safe on partial updates, both anchor fields must be present
    together when either is touched — sending one without the other
    is rejected (see ``_xor_when_anchor_touched``).
    """

    formation_id: UUID | None = None
    depth_top_m: float | None = None
    borehole_id: UUID | None = None
    cpt_id: UUID | None = None
    source: ContactSource | None = None
    confidence: ContactConfidence | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def _xor_when_anchor_touched(self) -> FormationContactUpdateRequest:
        """XOR enforcement on the anchor pair when the patch touches either.

        Three rules:

        * Neither anchor field in the request → no-op, leave the row's
          existing anchor alone.
        * Exactly one anchor field in the request → reject. The XOR
          invariant requires BOTH the new (non-null) and the cleared
          (null) side to be sent together so the resulting row has
          exactly one anchor.
        * Both anchor fields in the request → exactly one must be
          non-null. Both-null or both-non-null is rejected.
        """
        sent = {"borehole_id", "cpt_id"} & self.model_fields_set
        if not sent:
            return self
        if sent != {"borehole_id", "cpt_id"}:
            raise ValueError(
                "Anchor update on a contact requires both borehole_id and cpt_id "
                "in the request body (set the unused one to null)"
            )
        if (self.borehole_id is None) == (self.cpt_id is None):
            raise ValueError(
                "Anchor update on a contact: exactly one of borehole_id / cpt_id must be non-null"
            )
        return self

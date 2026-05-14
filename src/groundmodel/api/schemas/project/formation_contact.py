"""Pydantic schemas for the FormationContact API surface."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

# Closed enum for the source column. Pydantic enforces these literally;
# the DB column stays plain VARCHAR so adding a new source is a
# Pydantic-only change.
ContactSource = Literal["borehole_observation", "manual_pick", "interpolated"]
ContactConfidence = Literal["high", "medium", "low"]


class FormationContactCreateRequest(BaseModel):
    """Body of ``POST /projects/{pid}/geology/models/{mid}/contacts``.

    Exactly one of ``borehole_id`` / ``cpt_id`` must be set. Per the
    v1 scope, the API only accepts borehole-anchored contacts —
    CPT-anchored contacts are reserved for Phase 5 (Robertson Ic) but
    the column exists so the editor can render the constraint shape
    consistently across both anchor types.
    """

    formation_id: UUID
    depth_top_m: float
    borehole_id: UUID | None = None
    cpt_id: UUID | None = None
    source: ContactSource = "manual_pick"
    confidence: ContactConfidence = "medium"
    observation_id: UUID | None = None
    observation_layer_id: UUID | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def _exactly_one_anchor(self) -> FormationContactCreateRequest:
        """XOR check on the borehole / CPT anchor at the API boundary.

        Mirrors the DB ``CheckConstraint`` so the client gets a clean
        422 with a clear message instead of an opaque INSERT error.
        """
        if (self.borehole_id is None) == (self.cpt_id is None):
            raise ValueError(
                "Exactly one of borehole_id / cpt_id must be set on a FormationContact"
            )
        return self


class FormationContactUpdateRequest(BaseModel):
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


class FormationContactBatchUpdateEntry(FormationContactUpdateRequest):
    """One row in a ``PUT /contacts/batch`` payload.

    Inherits every field + the XOR validator from
    :class:`FormationContactUpdateRequest` and adds the target
    ``contact_id``. Inheriting keeps the anchor / XOR semantics
    identical to a single PATCH — the batch endpoint is just N PATCHes
    in one transaction.
    """

    contact_id: UUID


class FormationContactBatchUpdateRequest(BaseModel):
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


class FormationContactBatchUpdateResponse(BaseModel):
    """Body returned by ``PUT /contacts/batch`` — updated rows in
    input order so the client can patch its local state by index.
    """

    contacts: list[FormationContactResponse]


class FormationContactResponse(BaseModel):
    """API representation of a FormationContact row."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    model_id: UUID
    formation_id: UUID
    borehole_id: UUID | None
    cpt_id: UUID | None
    depth_top_m: float
    source: str
    confidence: str
    observation_id: UUID | None
    observation_layer_id: UUID | None
    notes: str | None
    created_at: datetime
    updated_at: datetime


class AutoPopulateFromStratigraphyRequest(BaseModel):
    """Body of ``POST /projects/{pid}/geology/models/{mid}/contacts/auto-populate``.

    Seeds the model with contacts derived from each borehole's
    stratigraphy observation (formal preferred, falls through to
    informal). Caller scopes the run by passing the borehole id
    list — typically the boreholes projected onto the active
    cross-section, but any subset of the project's boreholes is
    valid. Idempotent: re-running with the same scope is a no-op
    because every contact carries its source ``observation_layer_id``
    and the use case skips layers already used.
    """

    borehole_ids: list[UUID] = Field(min_length=1, max_length=500)


class AutoPopulateFromStratigraphyResponse(BaseModel):
    """Result counts + ids returned by the auto-populate endpoint.

    ``skipped_existing`` covers idempotency hits (the layer already
    seeded a contact); ``skipped_unmatched`` covers layers with an
    empty description; ``skipped_no_stratigraphy`` covers boreholes
    that don't carry a formal OR informal stratigraphy observation
    at all.
    """

    created_contact_ids: list[UUID]
    created_formation_ids: list[UUID]
    skipped_existing: int
    skipped_unmatched: int
    skipped_no_stratigraphy: int


class DeduplicateContactsResponse(BaseModel):
    """Result of ``POST /projects/{pid}/geology/models/{mid}/contacts/dedupe``.

    Returns the count of inspected groups + the count + ids of
    removed duplicates so the frontend toast is meaningful and a
    future undo command could re-create the deleted rows.
    """

    inspected_groups: int
    duplicates_removed: int
    removed_contact_ids: list[UUID]


class RebuildSurfacesResponse(BaseModel):
    """Result of ``POST /projects/{pid}/geology/models/{mid}/surfaces/rebuild``.

    ``formations_considered`` counts the formations that have at
    least one contact in this model — these are the ones the rebuild
    loop visits. ``formations_rebuilt`` is the subset whose
    recomputed checksum differed from the cached one (i.e. the cache
    write fired). On a clean model both are 0.
    """

    formations_considered: int
    formations_rebuilt: int


class FormationSurfaceResponse(BaseModel):
    """API representation of a cached TIN per (model, formation).

    Derived from the formation's contacts; the section consumer
    fetches these to render slice-of-TIN polylines instead of
    connect-the-dots. The bundle round-trip carries them so a
    .strix re-open doesn't pay the recompute cost up front.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    model_id: UUID
    formation_id: UUID
    method: str
    # vertices: list of [x_m, y_m, elevation_m] tuples — typed as
    # ``list[list[float]]`` rather than the tighter
    # ``list[tuple[float, float, float]]`` because Pydantic JSON
    # serialises tuples as arrays anyway, and the frontend just
    # wants the array shape.
    vertices: list[list[float]]
    triangles: list[list[int]]
    source_contact_count: int
    created_at: datetime
    updated_at: datetime


class GapIssueResponse(BaseModel):
    """One item in the validate-no-gaps response."""

    kind: str
    detail: str
    depth_m: float | None = None
    contact_ids: list[UUID] = Field(default_factory=list)


class GapValidationResponse(BaseModel):
    """Body returned by ``GET /projects/{pid}/geology/models/{mid}/boreholes/{bid}/validate``.

    Empty ``issues`` ⇒ contacts form a clean contiguous stratigraphy.
    Any non-empty list is a soft warning — the editor decides whether
    to block save.
    """

    model_id: UUID
    borehole_id: UUID
    issues: list[GapIssueResponse] = Field(default_factory=list)

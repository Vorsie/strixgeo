"""Pydantic schemas for the cross-section API surface."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from groundmodel.api.schemas.strict_request_model import StrictRequestModel

# The section view_state sub-shapes reuse the shared StrictRequestModel base
# (``extra='forbid'`` + ``allow_inf_nan=False``). Forbidding extras is the
# load-bearing part (debt #24): a client shipping ``snap_to_stratigrahpy``
# (typo) would otherwise silently persist junk into the JSONB column; with it,
# Pydantic returns 422 and the typo surfaces. The former local ``_StrictModel``
# (extra-only) was folded into that base so there is one strict-write contract.


class CptChannels(StrictRequestModel):
    """Section CPT-channel toggles persisted into ``view_state``.

    Mirrors the frontend's ``CptChannels`` interface in
    ``desktop/src/renderer/src/components/sections/cptChannels.ts``.
    Each field is optional so partial PATCH bodies can flip a
    single toggle without round-tripping the whole bag.
    """

    qc: bool | None = None
    rf: bool | None = None
    fs: bool | None = None
    u2: bool | None = None
    # camelCase preserved verbatim from the JSON contract — the
    # frontend interface uses ``qTotal`` and changing it here
    # would break the bundle round-trip.
    qTotal: bool | None = None  # noqa: N815 — JSON-contract field name


class BoreholeChannels(StrictRequestModel):
    """Section borehole-stream toggles persisted into ``view_state``.

    Mirrors the frontend's ``BoreholeChannels`` interface in
    ``desktop/src/renderer/src/components/sections/cptChannels.ts``; the twin
    test ``tests/unit/api/test_twin_section_channel_keys.py`` pins both to
    ``tests/fixtures/contracts/section_channel_keys.json``. The renderer PATCHes
    the whole bag on every toggle, so a key missing here refuses EVERY toggle
    with a 422 (2026-09-22, the coded-lithology toggle of PR #18).
    """

    # Coded lithology (``coded_lithology`` observations) as a section stream,
    # added on the renderer side by PR #18 (2026-09-21); OFF by default there.
    lithology: bool | None = None
    geotech: bool | None = None
    formal_strat: bool | None = None
    informal_strat: bool | None = None


class ReviewFlags(StrictRequestModel):
    """Dismissed litho review flags persisted into ``view_state``.

    A review flag marks an uncorrelated same-litho neighbour the safe-default
    repair had to re-emit as an onlap; "Keep separate" dismisses one. The
    dismissal is a per-project engineering decision, so it rides the section row
    (and therefore the ``.gmproj`` bundle) rather than localStorage — see
    ``desktop/src/renderer/src/utils/reviewFlagPrefs.ts``.

    Without this key on the allowlist the PATCH is rejected 422 and every
    dismissal is silently lost, so the flag nags again on the next reload.
    """

    dismissed: list[str] | None = None


class SheetField(StrictRequestModel):
    """One free-text field of the cross-section PDF sheet's title block."""

    label: str = Field(max_length=80)
    value: str = Field(max_length=200)


class SheetSettingsState(StrictRequestModel):
    """The cross-section PDF sheet's per-section settings (``view_state.pdf_sheet``).

    Written by the desktop's sheet preview dialog on Export and on close, read back
    to seed the dialog; travels in the bundle like the rest of ``view_state``. The
    shape mirrors ``desktop/src/renderer/src/sheet/sheetPayload.ts`` ``SheetSettings``.
    """

    fill: Literal["litho", "geotech"]
    scaleMode: Literal["fit", "explicit"]  # noqa: N815 — wire name, camelCase by the renderer
    hScale: float | None = Field(default=None, gt=0)  # noqa: N815
    vScale: float | None = Field(default=None, gt=0)  # noqa: N815
    vex: float = Field(gt=0, le=100)
    spacing: float = Field(ge=0.0, le=1.0)
    fields: list[SheetField] = Field(min_length=4, max_length=4)


class SectionViewState(StrictRequestModel):
    """Validated shape of the ``cross_section.view_state`` JSONB bag.

    Used on the PATCH body so an unknown top-level key (typo, or a
    forward-incompat key from a newer client) is rejected with a
    422 instead of silently persisting. The DB column itself stays
    ``JSONB`` (untyped) so a bundle restore can round-trip whatever
    an older build saved; this gate only applies to live PATCH
    bodies. See CLAUDE.md "Backwards Compatibility".
    """

    cpt_channels: CptChannels | None = None
    borehole_channels: BoreholeChannels | None = None
    column_spacing: float | None = Field(default=None, ge=0.0, le=1.0)
    # The PDF sheet dialog's settings (2026-09-02); absent until first use.
    pdf_sheet: SheetSettingsState | None = None
    snap_to_stratigraphy: bool | None = None
    review_flags: ReviewFlags | None = None


class CrossSectionCreateRequest(StrictRequestModel):
    """Body of ``POST /projects/{id}/sections``.

    ``epsg`` is required; the desktop client typically passes the
    project's ``default_horizontal_epsg`` but a section can override
    when the endpoints live in a different CRS. Buffer and exaggeration
    have sensible defaults so simple cases stay short.
    """

    name: str = Field(min_length=1, max_length=200)
    # ``allow_inf_nan=False`` is load-bearing, not decoration: JSON carries a
    # bare ``NaN`` literal, Pydantic v2 accepts it into a float by default, and
    # ``NaN != NaN`` walks straight through the distinct-endpoints guard below —
    # the one check that exists to stop unusable geometry. A section persisted
    # with a NaN endpoint poisons every later projection, snapshot and export
    # and can only be repaired by deleting it, so it is refused at the door.
    start_x: float = Field(allow_inf_nan=False)
    start_y: float = Field(allow_inf_nan=False)
    end_x: float = Field(allow_inf_nan=False)
    end_y: float = Field(allow_inf_nan=False)
    epsg: int
    description: str | None = None
    projection_buffer_m: float = Field(default=50.0, gt=0.0, allow_inf_nan=False)
    vertical_exaggeration: float = Field(default=1.0, gt=0.0, allow_inf_nan=False)
    excluded_borehole_ids: list[UUID] = Field(default_factory=list)
    excluded_cpt_ids: list[UUID] = Field(default_factory=list)
    # A NaN clamp silently disables the depth window it is meant to define —
    # the ordering validator below is an inequality and NaN fails every one.
    min_depth_m: float | None = Field(default=None, allow_inf_nan=False)
    max_depth_m: float | None = Field(default=None, allow_inf_nan=False)
    display_order: int = 0
    view_state: dict[str, Any] | None = None
    # seeded_formation_contact_ids is NOT in the create request.
    # A freshly-drawn section always starts with an empty set — formation
    # content only appears after an explicit Seed or manual draw action.

    @model_validator(mode="after")
    def _endpoints_distinct(self) -> CrossSectionCreateRequest:
        """Reject zero-length sections — the projection math divides by line length."""
        if self.start_x == self.end_x and self.start_y == self.end_y:
            raise ValueError("Cross-section endpoints must be distinct (line length > 0).")
        return self

    @model_validator(mode="after")
    def _depth_window_ordered(self) -> CrossSectionCreateRequest:
        """If both depth bounds are set, ``min`` must be shallower than ``max``."""
        if (
            self.min_depth_m is not None
            and self.max_depth_m is not None
            and self.min_depth_m >= self.max_depth_m
        ):
            raise ValueError("min_depth_m must be strictly less than max_depth_m")
        return self


class CrossSectionUpdateRequest(StrictRequestModel):
    """Body of ``PATCH /projects/{id}/sections/{sid}``.

    Every field is optional — only keys present in the body are
    written. Endpoint updates re-trigger the distinct-endpoints
    invariant on the server side via the repo flush; we don't repeat
    that validation here because partial updates may leave one
    endpoint untouched.
    """

    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    # Same finiteness block as the create body — PATCH is the other door into
    # the same columns, and the router's post-update invariant repeats the same
    # equality test that NaN slips through.
    start_x: float | None = Field(default=None, allow_inf_nan=False)
    start_y: float | None = Field(default=None, allow_inf_nan=False)
    end_x: float | None = Field(default=None, allow_inf_nan=False)
    end_y: float | None = Field(default=None, allow_inf_nan=False)
    epsg: int | None = None
    projection_buffer_m: float | None = Field(default=None, gt=0.0, allow_inf_nan=False)
    vertical_exaggeration: float | None = Field(default=None, gt=0.0, allow_inf_nan=False)
    excluded_borehole_ids: list[UUID] | None = None
    excluded_cpt_ids: list[UUID] | None = None
    min_depth_m: float | None = Field(default=None, allow_inf_nan=False)
    max_depth_m: float | None = Field(default=None, allow_inf_nan=False)
    display_order: int | None = None
    # Sentinel: ``None`` means "do not touch view_state"; an explicit
    # empty dict ``{}`` clears the bag. The router applies a shallow
    # merge so callers can patch individual toggle keys without
    # round-tripping the whole bag (mirrors the
    # ``PATCH /projects/{id}/view-state`` semantics).
    #
    # Typed strictly for debt #24: unknown top-level keys (typos,
    # forward-incompat keys from a newer client) get 422 instead of
    # silent persistence into the JSONB column. The merge layer
    # serialises via ``model_dump(exclude_none=True)`` to preserve
    # the partial-update contract.
    view_state: SectionViewState | None = None
    # Replaces the seeded set wholesale.  The Seed handler and
    # manual-draw handler both PATCH via the union pattern (existing
    # ∪ new), not direct assignment, so they pass the full merged set
    # here.  When absent (None) the column is untouched by the generic
    # repo.update() loop — correct for all other PATCH callers.
    seeded_formation_contact_ids: list[UUID] | None = None


class CrossSectionResponse(BaseModel):
    """API representation of a CrossSection row."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    app_project_id: UUID
    name: str
    description: str | None
    start_x: float
    start_y: float
    end_x: float
    end_y: float
    epsg: int
    projection_buffer_m: float
    vertical_exaggeration: float
    excluded_borehole_ids: list[UUID]
    excluded_cpt_ids: list[UUID]
    min_depth_m: float | None
    max_depth_m: float | None
    display_order: int
    view_state: dict[str, Any] | None = None
    # Explicit-content included set — see ORM docstring + CLAUDE.md
    # "Cross-sections are the editing surface".  Empty list = nothing
    # seeded; formation contacts appear only when their id is in this set.
    seeded_formation_contact_ids: list[UUID]
    # Body companion linkage — Slice 4 of debt #101 (lens→body rename #222).
    # None if this section is a plain user section; set to the body id
    # when auto-created as the body's perpendicular companion.
    companion_body_id: UUID | None = None
    # True if this section was ever a body companion — stays True even
    # after the referenced body is deleted (companion_body_id → None).
    is_body_companion: bool = False
    # Human-readable body name for the companion badge in the section
    # header. Populated only by the perpendicular-companion endpoint
    # (which has the body loaded); all other callers leave it None.
    # Not stored on the section row — resolved by the endpoint that
    # creates or re-fetches the companion context.
    companion_body_name: str | None = None
    created_at: datetime
    updated_at: datetime

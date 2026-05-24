"""Pydantic schemas for the cross-section API surface."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class _StrictModel(BaseModel):
    """Base for the section view_state sub-shapes (debt #24).

    ``extra='forbid'`` is the load-bearing config — without it a
    client shipping ``snap_to_stratigrahpy`` (typo, missing the
    'g') would silently persist junk into the JSONB column. With
    it, Pydantic returns 422 and the typo surfaces.
    """

    model_config = ConfigDict(extra="forbid")


class CptChannels(_StrictModel):
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


class BoreholeChannels(_StrictModel):
    """Section borehole-stream toggles persisted into ``view_state``."""

    geotech: bool | None = None
    formal_strat: bool | None = None
    informal_strat: bool | None = None


class SectionViewState(_StrictModel):
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
    snap_to_stratigraphy: bool | None = None


class CrossSectionCreateRequest(BaseModel):
    """Body of ``POST /projects/{id}/sections``.

    ``epsg`` is required; the desktop client typically passes the
    project's ``default_horizontal_epsg`` but a section can override
    when the endpoints live in a different CRS. Buffer and exaggeration
    have sensible defaults so simple cases stay short.
    """

    name: str = Field(min_length=1, max_length=200)
    start_x: float
    start_y: float
    end_x: float
    end_y: float
    epsg: int
    description: str | None = None
    projection_buffer_m: float = Field(default=50.0, gt=0.0)
    vertical_exaggeration: float = Field(default=1.0, gt=0.0)
    excluded_borehole_ids: list[UUID] = Field(default_factory=list)
    excluded_cpt_ids: list[UUID] = Field(default_factory=list)
    min_depth_m: float | None = None
    max_depth_m: float | None = None
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


class CrossSectionUpdateRequest(BaseModel):
    """Body of ``PATCH /projects/{id}/sections/{sid}``.

    Every field is optional — only keys present in the body are
    written. Endpoint updates re-trigger the distinct-endpoints
    invariant on the server side via the repo flush; we don't repeat
    that validation here because partial updates may leave one
    endpoint untouched.
    """

    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    start_x: float | None = None
    start_y: float | None = None
    end_x: float | None = None
    end_y: float | None = None
    epsg: int | None = None
    projection_buffer_m: float | None = Field(default=None, gt=0.0)
    vertical_exaggeration: float | None = Field(default=None, gt=0.0)
    excluded_borehole_ids: list[UUID] | None = None
    excluded_cpt_ids: list[UUID] | None = None
    min_depth_m: float | None = None
    max_depth_m: float | None = None
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
    # Lens companion linkage — Slice 4 of debt #101.
    # None if this section is a plain user section; set to the lens id
    # when auto-created as the lens's perpendicular companion.
    companion_lens_id: UUID | None = None
    # True if this section was ever a lens companion — stays True even
    # after the referenced lens is deleted (companion_lens_id → None).
    is_lens_companion: bool = False
    created_at: datetime
    updated_at: datetime

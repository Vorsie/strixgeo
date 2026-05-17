"""Pydantic schema: :class:`AutoPopulateFromStratigraphyRequest`."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field


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

    ``selected_keys`` is an additive optional field.  When provided, only
    layers whose stable key (``regional_ref`` when present, else ``name``)
    is in this set are processed; other layers are silently skipped.  This
    is the mechanism used by the "Fill from boreholes" curated-selection
    dialog — the caller passes the keys the user checked, and the
    auto-populate creates ONLY those formations.

    When ``None`` (omitted), all layers are processed — the pre-existing
    behaviour of ``handleAutoPopulateFromStratigraphy`` (Sections "Seed
    from stratigraphy") is unaffected.
    """

    borehole_ids: list[UUID] = Field(min_length=1, max_length=500)
    selected_keys: list[str] | None = None
    manual_map: dict[str, str] | None = None
    """Optional ``{ normalize_formation_key(raw) -> target_formation_name }`` map.

    Built by the lumping dialog and sent on confirm so the write path uses
    the identical mapping that was used for the discover preview
    (``discover≡apply`` invariant).  ``None`` (omitted) = no lumping.
    """

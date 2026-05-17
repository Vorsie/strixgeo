"""Pydantic schema: :class:`FormationCandidateItem`."""

from __future__ import annotations

from pydantic import BaseModel


class FormationCandidateItem(BaseModel):
    """One candidate formation returned by the discover endpoint.

    ``name`` is the working display name (informal description preferred;
    formal as fallback).  ``key`` is the stable cross-borehole identity key
    (``regional_ref`` when formal stratigraphy is present, ``name``
    otherwise) — the frontend passes ``selected_keys`` on confirm using
    these, not the display names, so discover and auto-populate use the
    same stable identity regardless of informal-name variation across
    boreholes.

    ``regional_ref`` and ``key`` are additive new fields (optional on read
    for old callers, always present in new serialisations).

    ``borehole_count`` lets the dialog show ``"found in N borehole(s)"``
    secondary text.
    """

    name: str
    regional_ref: str | None = None
    key: str = ""  # server always sets this; default for schema compatibility
    borehole_count: int

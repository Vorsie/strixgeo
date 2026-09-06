"""Pydantic schema: :class:`FormationCandidateItem`."""

from __future__ import annotations

from pydantic import BaseModel

from .formal_code_item import FormalCodeItem


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

    ``formal_codes`` lists every DOV formal-stratigraphy code the candidate's
    boreholes pair the informal name with (each with a borehole count and,
    where the DOV lexicon knows it, the canonical name).  Additive, optional;
    empty for an informal-only candidate.  Added 2026-09-05 (owner dogfeed) so
    the dialog can show the DOV code behind each informal name and expose a
    formal↔informal disagreement.
    """

    name: str
    regional_ref: str | None = None
    key: str = ""  # server always sets this; default for schema compatibility
    borehole_count: int
    formal_codes: list[FormalCodeItem] = []

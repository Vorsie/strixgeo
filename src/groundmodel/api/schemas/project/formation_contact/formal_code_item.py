"""Pydantic schema: :class:`FormalCodeItem`."""

from __future__ import annotations

from pydantic import BaseModel


class FormalCodeItem(BaseModel):
    """One DOV formal-stratigraphy code a candidate's boreholes pair it with.

    Additive wire mirror of
    ``groundmodel.application.formal_code_count.FormalCodeCount``.  The fill
    dialog shows the ``code`` (muted, after the informal name) and its
    ``count`` so the DOV formal code behind each informal candidate is visible
    and a formal↔informal disagreement is exposed (owner dogfeed 2026-09-05);
    ``catalog_name`` lets the dialog offer the DOV code's own formation as a
    one-click target.
    """

    code: str
    count: int
    catalog_name: str | None = None

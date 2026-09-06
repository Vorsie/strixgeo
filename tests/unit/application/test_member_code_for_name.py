"""Unit tests for ``member_code_for_name`` — the DOV member-name reverse lookup.

The "Fill from boreholes" dialog can lump a candidate to a DOV member name
(e.g. "Lid van Merelbeke").  When the write path creates that formation it
stamps the DOV code as ``regional_ref`` where the lexicon knows it
unambiguously (owner ruling 2026-09-06).  ``member_code_for_name`` is the
single helper that answers "which DOV code is this member name?", reducing a
full ``member (Formatie van …)`` name to its member the same way the dialog
does before looking it up.
"""

from __future__ import annotations

from groundmodel.application.stratigraphy_bridge import member_code_for_name


def test_reduces_and_resolves_unique_member() -> None:
    """A unique member name resolves to its DOV code; a full name is reduced first."""
    # The dialog offers the reduced member name ("Lid van Merelbeke").
    assert member_code_for_name("Lid van Merelbeke") == "GeMe"
    # A full "member (Formatie van …)" name is reduced to the member first.
    assert member_code_for_name("Lid van Merelbeke (Formatie van Gentbrugge)") == "GeMe"


def test_ambiguous_member_returns_none() -> None:
    """A member shared by two formations cannot be resolved to one code."""
    # "Lid van Egem" is TtEg (Formatie van Tielt) AND HyEg (Formatie van Hyon).
    assert member_code_for_name("Lid van Egem") is None


def test_unknown_or_freeform_name_returns_none() -> None:
    """A free-form target the lexicon does not know is a miss."""
    assert member_code_for_name("My Custom Formation") is None
    assert member_code_for_name("") is None

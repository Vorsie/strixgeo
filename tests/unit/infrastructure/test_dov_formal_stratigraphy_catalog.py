"""Unit tests for the #59 DOV formal-stratigraphy lexicon loader.

Asserts the checked-in ``dov_formal_stratigraphy.json`` (built from the
DOV ``FormeleStratigrafieLedenEnumType`` XSD) loads and resolves known
codes, misses unknown ones, and that normalisation is applied on both
sides so casing/whitespace variants round-trip.
"""

from __future__ import annotations

from groundmodel.infrastructure.codelists.dov_formal_stratigraphy_catalog import (
    get_formal_stratigraphy,
)
from groundmodel.shared.formation_key import normalize_formation_key


def test_catalog_loads_and_has_full_belgian_coverage() -> None:
    """The committed JSON parses and carries the whole-of-Belgium enum."""
    cat = get_formal_stratigraphy()
    entries = cat.all_entries()
    # The 2026-05-18 DOV XSD snapshot had 403 codes; assert it's the full
    # comprehensive table, not a curated subset (regression guard against a
    # truncated rebuild).
    assert len(entries) >= 400


def test_known_codes_resolve_to_full_dov_name() -> None:
    """Atomic permkeys resolve to the verbatim DOV ``xs:documentation`` name."""
    cat = get_formal_stratigraphy()
    cases = {
        "KoAa": "Lid van Aalbeke (Formatie van Kortrijk)",
        "KoRo": "Lid van Roubaix (Formatie van Kortrijk)",
        "KoMo": "Lid van Moen (Formatie van Kortrijk)",  # historical member
        "Ko": "Formatie van Kortrijk",
        "Q": "Groep van Quartaire afzetting",
        "A": "Antropogeen",
    }
    for code, expected in cases.items():
        entry = cat.resolve(normalize_formation_key(code))
        assert entry is not None, f"{code} must resolve"
        assert entry.full_name_nl == expected
        # Raw code preserved on the entry (provenance).
        assert entry.code == code


def test_unknown_code_returns_none() -> None:
    """A code not in the DOV enum is a miss (caller falls through to raw)."""
    cat = get_formal_stratigraphy()
    assert cat.resolve(normalize_formation_key("ZZX_NOT_A_DOV_CODE")) is None


def test_normalisation_applied_both_sides() -> None:
    """Mixed-case / spaced input resolves identically to the canonical code."""
    cat = get_formal_stratigraphy()
    a = cat.resolve(normalize_formation_key("KoAa"))
    b = cat.resolve(normalize_formation_key("  koaa "))
    c = cat.resolve(normalize_formation_key("KOAA"))
    assert a is not None and a is b is c


# ---------------------------------------------------------------------------
# Reverse lookup: member name -> DOV code (owner ruling 2026-09-06).
#
# When the "Fill from boreholes" dialog lumps a candidate to a DOV member name
# ("Lid van Merelbeke"), the created formation should carry the DOV code
# ("GeMe") as its regional_ref where the lexicon knows it — but ONLY when the
# member name maps to a single code.  A member shared by two formations (Egem
# = TtEg in Tielt AND HyEg in Hyon) cannot be resolved and must decline.
# ---------------------------------------------------------------------------


def test_member_code_reverse_lookup_unique() -> None:
    """A member name that maps to exactly one code resolves to that code."""
    cat = get_formal_stratigraphy()
    assert cat.member_code(normalize_formation_key("Lid van Merelbeke")) == "GeMe"
    assert cat.member_code(normalize_formation_key("Lid van Vlierzele")) == "GeVl"
    assert cat.member_code(normalize_formation_key("Formatie van Boom")) == "Bm"


def test_member_code_ambiguous_member_returns_none() -> None:
    """A member shared by >1 formation resolves to no unique code (no guess)."""
    cat = get_formal_stratigraphy()
    # "Lid van Egem" is TtEg (Formatie van Tielt) AND HyEg (Formatie van Hyon).
    assert cat.member_code(normalize_formation_key("Lid van Egem")) is None


def test_member_code_unknown_name_returns_none() -> None:
    """A name the lexicon does not know is a miss."""
    cat = get_formal_stratigraphy()
    assert cat.member_code(normalize_formation_key("Some Engineer Freeform Name")) is None

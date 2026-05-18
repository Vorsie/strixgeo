"""Constants for the DOV formal-stratigraphy compound-code resolver.

Compound codes arise from the DOV borehole interpretation XML where
``<lid1>``, ``<relatie_lid1_lid2>``, and ``<lid2>`` are separate
elements.  The DOV interpretation parser (``dov_interpretation_parser.py``)
combines them as ``"<lid1>-<relation>-<lid2>"`` (e.g. ``"QH-T-QP"``).

**Detection runs on the NORMALISED key, not the raw string.** By the time
the resolver sees a code it has already passed through
``normalize_formation_key`` (NFKC + casefold + every non-alphanumeric run
collapsed to a single space). So ``"QH-T-QP"`` arrives as ``"qh t qp"`` —
the dashes are gone. A compound is therefore detected as *exactly three
space-separated tokens whose middle token is a single relation letter*
(``t`` / ``o`` / ``e``). Atomic DOV permkeys are alphanumeric with no
internal separators, so they normalise to a single token and can never
false-positive this 3-token shape.

Source: ``RelatieLedenEnumType`` in ``InterpretatieDataCodes.xsd`` at the
DOV schema endpoint ``/xdov/schema/latest/xsd/kern/interpretatie/``.
Fetched 2026-05-18.
"""

from __future__ import annotations

# Relation-letter (normalised, lower-case) → Dutch expansion word.
# Source: RelatieLedenEnumType in InterpretatieDataCodes.xsd (DOV, 2026-05-18).
#   T = "tot"  — a range from lid1 to lid2.
#   O = "of"   — uncertainty between lid1 and lid2.
#   E = "en"   — two co-occurring units.
# Keyed by the casefolded letter because the resolver matches against the
# already-normalised key (see module docstring).
RELATION_WORD: dict[str, str] = {
    "t": "tot",
    "o": "of",
    "e": "en",
}

# The set of normalised relation letters — the middle token of a 3-token
# normalised key that flags a compound ``lid1 <rel> lid2`` code.
RELATION_CODES_NORM: frozenset[str] = frozenset(RELATION_WORD)

# Sentinel codes that EXIST in the DOV XSD enum but are NOT real
# lithostratigraphic units — resolving them would lump unrelated layers
# under one bogus formation. They must fall through to the raw token like
# any other miss. ``U`` = "Onbekend" (unknown): owner-decided 2026-05-18
# to drop (a "U" layer stays its raw token, never becomes an "Onbekend"
# formation that swallows every unknown-coded layer across boreholes).
# Keys are normalize_formation_key(code) form.
UNRESOLVABLE_CODES_NORM: frozenset[str] = frozenset({"u"})

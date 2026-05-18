"""Canonical short slugs for ``ScalarLabTest.parameter`` (debt #20).

``scalar_lab_test`` stores the verbatim DOV parameter string — DOV's
inconsistent doubled-tail convention and all (e.g.
``"Korrelvolumemassa (korrelvolumemassa)"``). That is the right storage
choice (store raw upstream tokens; translate at the boundary — see
CLAUDE.md "Engineering Patterns" + Data Integrity Rule §1), but raw DOV
strings are useless as a stable reporting / filtering key: they are long,
Dutch, and can change if DOV tweaks the tail again.

This module is the **compute-on-read** canonical-slug layer (owner
decision 2026-05-18, debt #20): a curated map from the verbatim DOV
string to a short stable English slug, plus the forward and reverse
lookups. No column, no migration, no ingest mutation — storage stays
upstream-faithful and the slug is derived only where it is needed.

Future filtered query pattern (the trigger that makes #20 load-bearing):
translate the requested slug to its raw-string set via
``raw_parameters_for_slug`` and filter the existing column —
``WHERE parameter IN (:raw_set)`` — so the slug never has to be stored.

The map is keyed off the ``DOV_PARAMETER_*`` constants (not re-typed
literals) so the verbatim strings have a single source of truth in
``dov_constants``; if DOV corrects a tail there, the slug follows.
"""

from __future__ import annotations

from groundmodel.infrastructure.parsers.lab.dov.dov_constants import (
    DOV_PARAMETER_ASTM_CODE,
    DOV_PARAMETER_ASTM_DESCRIPTION,
    DOV_PARAMETER_BGGG_NORM,
    DOV_PARAMETER_CALCAREOUS_CONTENT,
    DOV_PARAMETER_CLAY_CONTENT_MB,
    DOV_PARAMETER_GRAIN_DENSITY,
    DOV_PARAMETER_ORGANIC_MATTER,
    DOV_PARAMETER_WATER_CONTENT_ALT,
    DOV_PARAMETER_WET_DENSITY,
)

# Verbatim DOV parameter string → canonical slug. Many raw strings may
# map to one slug (if DOV publishes a renamed variant we add the new key
# alongside the old, both pointing at the same slug — that is exactly the
# upstream-tweak resilience #20 is about). Slugs are short, snake_case,
# English (CLAUDE.md "English only"), and chosen to match standard
# geotechnical parameter names where one exists.
PARAMETER_SLUG_MAP: dict[str, str] = {
    DOV_PARAMETER_GRAIN_DENSITY: "particle_density",
    DOV_PARAMETER_WET_DENSITY: "wet_density",
    DOV_PARAMETER_WATER_CONTENT_ALT: "water_content",
    DOV_PARAMETER_ASTM_CODE: "astm_soil_code",
    DOV_PARAMETER_ASTM_DESCRIPTION: "astm_soil_description",
    DOV_PARAMETER_BGGG_NORM: "bggg_soil_type",
    DOV_PARAMETER_CALCAREOUS_CONTENT: "calcareous_content",
    DOV_PARAMETER_ORGANIC_MATTER: "organic_matter_content",
    DOV_PARAMETER_CLAY_CONTENT_MB: "clay_content_mb",
}

# Reverse index, built once at import: slug → every raw string that maps
# to it. Used by the future slug-filtered query path
# (slug → raw set → ``WHERE parameter IN (...)``).
_SLUG_TO_RAW: dict[str, frozenset[str]] = {}
for _raw, _slug in PARAMETER_SLUG_MAP.items():
    _SLUG_TO_RAW[_slug] = _SLUG_TO_RAW.get(_slug, frozenset()) | {_raw}


def parameter_slug(raw: str) -> str | None:
    """Return the canonical slug for a verbatim DOV parameter string.

    Parameters
    ----------
    raw : str
        The exact value stored in ``scalar_lab_test.parameter``.

    Returns
    -------
    str | None
        The canonical slug, or ``None`` when the string is not in the
        curated map. ``None`` means "no canonical name yet — callers
        fall back to showing the raw string"; it is never an error,
        because the catch-all family can legitimately ingest a
        parameter before its slug is curated.
    """
    return PARAMETER_SLUG_MAP.get(raw)


def raw_parameters_for_slug(slug: str) -> frozenset[str]:
    """Return every verbatim DOV string that maps to ``slug``.

    The load-bearing reverse lookup for the future filtered-query path:
    a caller filtering ``scalar_lab_test`` by canonical parameter
    translates the slug to this set and runs
    ``WHERE parameter IN (:raw_set)`` — so the slug never needs to be
    stored (debt #20, compute-on-read decision).

    Parameters
    ----------
    slug : str
        A canonical slug (a value from :data:`PARAMETER_SLUG_MAP`).

    Returns
    -------
    frozenset[str]
        Every raw DOV string mapping to ``slug``; empty when the slug
        is unknown.
    """
    return _SLUG_TO_RAW.get(slug, frozenset())

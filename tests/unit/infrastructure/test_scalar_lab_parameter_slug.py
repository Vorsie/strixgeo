"""Unit tests for the ScalarLabTest parameter-slug layer (debt #20).

Pure map/function tests — no DB, no I/O. The coverage test ties the
curated map to the ingest registry so adding a new catch-all parameter
without a slug fails loudly here instead of silently shipping raw
strings into reporting.
"""

from __future__ import annotations

from groundmodel.infrastructure.codelists.scalar_lab_parameter_slug import (
    PARAMETER_SLUG_MAP,
    parameter_slug,
    raw_parameters_for_slug,
)
from groundmodel.infrastructure.parsers.lab.dov.dov_constants import (
    DOV_OTHER_SCALAR_LAB_TEST_PARAMETERS,
    DOV_PARAMETER_CLAY_CONTENT_MB,
    DOV_PARAMETER_GRAIN_DENSITY,
)


def test_known_string_resolves_to_slug() -> None:
    """A verbatim DOV string maps to its canonical slug."""
    assert parameter_slug(DOV_PARAMETER_GRAIN_DENSITY) == "particle_density"
    # The double-paren clay-content nasty resolves too.
    assert parameter_slug(DOV_PARAMETER_CLAY_CONTENT_MB) == "clay_content_mb"


def test_unknown_string_returns_none_not_error() -> None:
    """An uncurated string yields None (callers fall back to raw)."""
    assert parameter_slug("Some parameter DOV has not published yet") is None
    assert parameter_slug("") is None


def test_reverse_lookup_returns_raw_set() -> None:
    """slug → raw set is the future filtered-query path."""
    raws = raw_parameters_for_slug("particle_density")
    assert raws == frozenset({DOV_PARAMETER_GRAIN_DENSITY})
    assert raw_parameters_for_slug("no_such_slug") == frozenset()


def test_forward_reverse_round_trip() -> None:
    """Every mapped raw string is recoverable via its slug."""
    for raw, slug in PARAMETER_SLUG_MAP.items():
        assert raw in raw_parameters_for_slug(slug)


def test_slugs_are_snake_case_ascii() -> None:
    """Slugs are stable, English, snake_case (CLAUDE.md English-only)."""
    for slug in PARAMETER_SLUG_MAP.values():
        assert slug.isascii()
        assert slug == slug.lower()
        assert " " not in slug
        assert slug.replace("_", "").isalnum()


def test_every_ingested_catch_all_parameter_has_a_slug() -> None:
    """Coverage guard: every parameter the catch-all ingests is curated.

    Ties the slug map to ``DOV_OTHER_SCALAR_LAB_TEST_PARAMETERS`` — the
    single source of truth for what the orchestrator persists into
    ``scalar_lab_test``. Adding a new tuple there without a slug fails
    here loudly instead of silently shipping a raw Dutch string into
    any future reporting/filter path.
    """
    missing = [
        parameter
        for _group, parameter in DOV_OTHER_SCALAR_LAB_TEST_PARAMETERS
        if parameter_slug(parameter) is None
    ]
    assert missing == [], f"catch-all parameters without a slug: {missing}"

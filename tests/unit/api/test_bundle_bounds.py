"""Regression tests for the bundle restore bounds (debt #38).

Two layers of defence against a malicious / corrupted .strix file:

1. ``BodySizeLimitMiddleware`` — rejects the request before any
   buffering when ``Content-Length`` declares more than the per-
   request budget, AND tracks bytes across chunked-transfer bodies
   so an attacker can't bypass by omitting Content-Length.
2. ``ProjectBundleRequest`` Pydantic ``max_length`` per array —
   stops a body that fits the envelope budget but ships an array
   with 10⁷ entries.

Pydantic-layer assertions instantiate the schema directly so they
don't need a DB (unit-tier). HTTP-middleware assertions hit a
non-DB route (POST to a non-existent URL → 404) so the middleware's
behaviour is observable without touching Postgres.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from groundmodel.api.main import _MAX_BODY_BYTES, app
from groundmodel.api.schemas.project.project_bundle import (
    BUNDLE_FORMAT_VERSION,
    ProjectBundleRequest,
)


@pytest.fixture(scope="module")
def client() -> TestClient:
    """One TestClient for the whole module.

    ``base_url`` is pinned to ``http://127.0.0.1`` so the Host header
    passes TrustedHostMiddleware.
    """
    return TestClient(app, base_url="http://127.0.0.1")


# ---------------------------------------------------------------------------
# BodySizeLimitMiddleware — observe via a non-DB route
# ---------------------------------------------------------------------------


def test_body_size_middleware_rejects_oversized_content_length(
    client: TestClient,
) -> None:
    """Declared Content-Length > cap → 413 before any buffering.

    Sends a small body with a lying header to a non-existent route:
    the middleware trusts the declared size (the attacker has to
    declare SOMETHING to make the request well-formed enough to
    route) and rejects before FastAPI's 404 handler ever runs.
    """
    response = client.post(
        "/__nonexistent__",
        content=b"{}",
        headers={"Content-Length": str(_MAX_BODY_BYTES + 1)},
    )
    assert response.status_code == 413


def test_body_size_middleware_accepts_under_cap(client: TestClient) -> None:
    """A small body sails through; FastAPI returns its own 404."""
    response = client.post("/__nonexistent__", content=b"{}")
    # NOT 413 — middleware passed, FastAPI's 404 took over.
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# ProjectBundleRequest array max_length caps — Pydantic-direct
# ---------------------------------------------------------------------------


def _minimal_body(**overrides):
    base = {
        "format_version": BUNDLE_FORMAT_VERSION,
        "project": {"id": "x", "name": "x"},
    }
    base.update(overrides)
    return base


def test_bundle_pydantic_rejects_too_many_cpts() -> None:
    """11 000 CPTs (past the 10 000 cap) → ValidationError."""
    with pytest.raises(ValidationError) as exc_info:
        ProjectBundleRequest(
            **_minimal_body(cpts=[{"id": str(i)} for i in range(11_000)]),
        )
    # Field name surfaces so the renderer's UX has a hook.
    assert "cpts" in str(exc_info.value).lower()


def test_bundle_pydantic_rejects_too_many_geological_models() -> None:
    """1 001 geological models → ValidationError."""
    with pytest.raises(ValidationError):
        ProjectBundleRequest(
            **_minimal_body(
                geological_models=[{"id": str(i)} for i in range(1_001)],
            ),
        )


def test_bundle_pydantic_rejects_too_many_boreholes() -> None:
    with pytest.raises(ValidationError):
        ProjectBundleRequest(
            **_minimal_body(boreholes=[{"id": str(i)} for i in range(10_001)]),
        )


def test_bundle_pydantic_accepts_at_cap() -> None:
    """A bundle right at the cap parses cleanly."""
    bundle = ProjectBundleRequest(
        **_minimal_body(cross_sections=[{"id": str(i)} for i in range(1_000)]),
    )
    assert len(bundle.cross_sections) == 1_000


def test_bundle_pydantic_accepts_empty_children() -> None:
    """Empty child arrays are the documented default."""
    bundle = ProjectBundleRequest(**_minimal_body())
    assert bundle.cpts == []
    assert bundle.boreholes == []
    assert bundle.geological_models == []


# ---------------------------------------------------------------------------
# Cross-section NESTED collections — the per-array max_length above bounds the
# number of cross-sections, but each cross-section carries its own unbounded
# ARRAY(UUID) exclusion lists and a JSONB view_state bag. A hostile .strix can
# fit the envelope budget yet ship ONE cross-section whose excluded_borehole_ids
# is a 10⁷-UUID list, or a view_state with a 1 GB string value.
# ---------------------------------------------------------------------------


def _cross_section(**fields) -> dict:
    """One minimal cross-section dict, overridden by ``fields``.

    Only the id is required for the bound checks; each test supplies the one
    oversized collection it is pinning.
    """
    base = {"id": "00000000-0000-0000-0000-000000000001"}
    base.update(fields)
    return base


def test_bundle_rejects_oversized_excluded_borehole_ids() -> None:
    """A section can't exclude more boreholes than a project could hold → reject."""
    with pytest.raises(ValidationError) as exc_info:
        ProjectBundleRequest(
            **_minimal_body(
                cross_sections=[
                    _cross_section(excluded_borehole_ids=[str(i) for i in range(10_001)])
                ],
            ),
        )
    assert "excluded_borehole_ids" in str(exc_info.value)


def test_bundle_rejects_oversized_seeded_formation_contact_ids() -> None:
    """A section's seeded-contact list past the per-section cap is rejected."""
    with pytest.raises(ValidationError) as exc_info:
        ProjectBundleRequest(
            **_minimal_body(
                cross_sections=[
                    _cross_section(seeded_formation_contact_ids=[str(i) for i in range(50_001)])
                ],
            ),
        )
    assert "seeded_formation_contact_ids" in str(exc_info.value)


def test_bundle_rejects_view_state_with_giant_value() -> None:
    """A single view_state entry cannot carry a multi-MB string → reject."""
    with pytest.raises(ValidationError) as exc_info:
        ProjectBundleRequest(
            **_minimal_body(
                cross_sections=[_cross_section(view_state={"note": "x" * 100_000})],
            ),
        )
    assert "view_state" in str(exc_info.value)


def test_bundle_accepts_normal_cross_section_nested() -> None:
    """A real section's small exclusion lists + toggle bag pass unchanged."""
    bundle = ProjectBundleRequest(
        **_minimal_body(
            cross_sections=[
                _cross_section(
                    excluded_borehole_ids=["00000000-0000-0000-0000-0000000000aa"],
                    excluded_cpt_ids=["00000000-0000-0000-0000-0000000000bb"],
                    seeded_formation_contact_ids=["00000000-0000-0000-0000-0000000000cc"],
                    view_state={"cpt_channels": {"qc": True, "rf": False}},
                )
            ],
        ),
    )
    assert len(bundle.cross_sections) == 1


def test_bundle_still_accepts_long_section_description() -> None:
    """The nested-field guard must NOT bleed onto free-text fields.

    ``description`` is a TEXT column; a long section description is legitimate
    and must survive — the guard bounds only the four collection fields.
    """
    bundle = ProjectBundleRequest(
        **_minimal_body(
            cross_sections=[_cross_section(description="x" * 100_000)],
        ),
    )
    assert len(bundle.cross_sections[0]["description"]) == 100_000

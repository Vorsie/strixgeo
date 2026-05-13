"""Unit checks for the ``?include=`` alias plumbing on ``GET /borehole/{id}``.

These tests don't need a database — they pin the structural invariants
that keep the scoped-load path honest (debt #2):

1. Router aliases cover every repository relationship (so a typed
   lab-test family added in one place can't drift in the other).
2. URL alias keys are URL-safe.
3. The router's alias parser rejects unknown values BEFORE reaching
   the repository (so a typo returns 400, not 500).

The route's session dependency is overridden with a stub so the route
body can run without touching Postgres; the stub never actually gets
queried because the validation branch under test fires first.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from groundmodel.api.routers.borehole import (
    LAB_TEST_INCLUDE_ALIASES,
)
from groundmodel.api.routers.borehole import (
    router as borehole_router,
)
from groundmodel.infrastructure.db.repositories.borehole_repository import (
    LAB_TEST_RELATIONSHIPS,
)
from groundmodel.infrastructure.db.session import get_session


class _NeverUsedSession:
    """Sentinel session — should never have a method called on it.

    Any test that triggers a DB query against this object indicates
    the alias-validation branch we're testing did NOT short-circuit
    the request like it should. The ``__getattr__`` trap raises a
    loud AssertionError naming the attribute the route asked for, so
    failures are diagnostic rather than the generic
    ``InterfaceError`` async-Postgres throws when a fake session
    leaks into a real query.
    """

    def __getattr__(self, name: str) -> None:
        raise AssertionError(
            f"_NeverUsedSession.{name} touched — the route reached the DB layer "
            "instead of short-circuiting at the alias-validation branch.",
        )


def _client() -> TestClient:
    """Mount the borehole router with the DB session stubbed out."""
    app = FastAPI()
    app.include_router(borehole_router, prefix="/borehole")
    app.dependency_overrides[get_session] = lambda: _NeverUsedSession()
    return TestClient(app)


def test_router_aliases_cover_every_repo_relationship() -> None:
    """Every relationship name the repo accepts has a URL alias.

    The router's ``LAB_TEST_INCLUDE_ALIASES`` values are the
    relationship names — they must equal the repo's
    ``LAB_TEST_RELATIONSHIPS`` set so a future typed lab-test family
    landing in the repo can't be silently un-requestable via the API.
    """
    assert sorted(LAB_TEST_INCLUDE_ALIASES.values()) == sorted(LAB_TEST_RELATIONSHIPS)


def test_router_alias_keys_are_url_safe() -> None:
    """URL aliases are lowercase + underscore-or-letters only — no spaces,
    punctuation, or accents the user has to URL-encode."""
    for alias in LAB_TEST_INCLUDE_ALIASES:
        assert alias.islower(), alias
        assert all(c.isalnum() or c == "_" for c in alias), alias


def test_unknown_include_value_returns_400() -> None:
    """A bogus ``?include=`` value must 400 with a hint about valid names."""
    client = _client()
    resp = client.get(
        "/borehole/00000000-0000-0000-0000-000000000001",
        params={"include": "grain_size,made_up_family"},
    )
    assert resp.status_code == 400
    body = resp.json()
    assert "Unknown include value" in body["detail"]
    # The error names what the caller sent (so they can grep their own
    # code) AND lists the valid set (so they can fix it without
    # context-switching to the docs).
    assert "made_up_family" in body["detail"]
    for alias in LAB_TEST_INCLUDE_ALIASES:
        assert alias in body["detail"]


def test_unknown_include_value_short_circuits_before_db() -> None:
    """A bogus alias must NEVER reach the DB session.

    The ``_NeverUsedSession`` stub raises if any attribute is read,
    so this test passing means the alias validation rejected the
    request before the route body called the repository.
    """
    client = _client()
    resp = client.get(
        "/borehole/00000000-0000-0000-0000-000000000001",
        params={"include": "totally_bogus"},
    )
    assert resp.status_code == 400


def test_empty_include_value_is_tolerated() -> None:
    """``?include=`` with empty / whitespace-only entries must not 400.

    A UI that always appends the parameter regardless of selection
    should fall through to "no filter" (= load everything), not have
    its request rejected.
    """
    client = _client()
    # An empty filter falls through to no-filter and the route body
    # WOULD then try to use the session. The expected outcome is NOT
    # 400 — the assertion stops there. We don't pin the downstream
    # status because the stubbed session intentionally raises.
    try:
        resp = client.get(
            "/borehole/00000000-0000-0000-0000-000000000001",
            params={"include": ", ,"},
        )
        # If FastAPI swallows the stub's AssertionError into a 500,
        # check the status — must not be 400.
        assert resp.status_code != 400
    except AssertionError as exc:
        # The stub fired — confirms the route DID pass alias
        # validation and reached the repo layer (= the empty filter
        # was tolerated).
        assert "_NeverUsedSession" in str(exc)

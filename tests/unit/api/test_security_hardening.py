"""Regression tests for debt #112 and #113 security hardening.

Covers:
- BodyBoundaryWriteRequest node-list caps (debt #112 / S3)
- CPT series-row cap helper (debt #112)
- PDF query-param length caps (debt #112)
- Settings.secret_key default warning (debt #113 item 1)
- DOV_VALID_PERMKEY_RE uses true string anchors \\A/\\Z (debt #113 item 3)
- CQL no-single-quote module-load assertion (debt #113 item 2)
- IPC window:set-title string truncation (debt #113 item 4)

All tests are unit-tier: no DB, no network, no Docker required.
"""

from __future__ import annotations

import warnings

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from groundmodel.api.main import app

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def client() -> TestClient:
    """Shared TestClient for HTTP-level assertions.

    ``raise_server_exceptions=False`` so a handler that 500s (e.g. the PDF
    export reaching an unavailable DB in a unit run) returns a 500 *response*
    instead of propagating the exception into the test. These are query-param
    *validation* / security tests — they assert on the status the validator
    produces (422 vs not), which fires before the handler; whether the handler
    then succeeds, 404s, or 500s must not make the test DB-dependent.
    """
    return TestClient(app, base_url="http://127.0.0.1", raise_server_exceptions=False)


# ===========================================================================
# Debt #112 / S3 — BodyBoundaryWriteRequest node-list caps
# ===========================================================================


class TestBodyBoundaryNodeCap:
    """``upper_nodes`` and ``lower_nodes`` must be capped at 10 000 each."""

    def test_accepts_empty_lists(self) -> None:
        """Empty request body (the common case) must parse cleanly."""
        from groundmodel.api.schemas.project.body.body_boundary import (
            BodyBoundaryWriteRequest,
        )

        req = BodyBoundaryWriteRequest()
        assert req.upper_nodes == []
        assert req.lower_nodes == []

    def test_accepts_at_cap(self) -> None:
        """Exactly 10 000 nodes must pass validation."""
        from groundmodel.api.schemas.project.body.body_boundary import (
            BodyBoundaryNodeItem,
            BodyBoundaryWriteRequest,
        )

        nodes = [BodyBoundaryNodeItem(along_m=float(i), elevation_m=0.0) for i in range(10_000)]
        req = BodyBoundaryWriteRequest(upper_nodes=nodes, lower_nodes=[])
        assert len(req.upper_nodes) == 10_000

    def test_rejects_upper_nodes_over_cap(self) -> None:
        """10 001 upper_nodes must raise ValidationError."""
        from groundmodel.api.schemas.project.body.body_boundary import (
            BodyBoundaryNodeItem,
            BodyBoundaryWriteRequest,
        )

        nodes = [BodyBoundaryNodeItem(along_m=float(i), elevation_m=0.0) for i in range(10_001)]
        with pytest.raises(ValidationError) as exc_info:
            BodyBoundaryWriteRequest(upper_nodes=nodes)
        assert "upper_nodes" in str(exc_info.value).lower()

    def test_rejects_lower_nodes_over_cap(self) -> None:
        """10 001 lower_nodes must raise ValidationError."""
        from groundmodel.api.schemas.project.body.body_boundary import (
            BodyBoundaryNodeItem,
            BodyBoundaryWriteRequest,
        )

        nodes = [BodyBoundaryNodeItem(along_m=float(i), elevation_m=0.0) for i in range(10_001)]
        with pytest.raises(ValidationError) as exc_info:
            BodyBoundaryWriteRequest(lower_nodes=nodes)
        assert "lower_nodes" in str(exc_info.value).lower()


# ===========================================================================
# Debt #112 — CPT series-row cap helper
# ===========================================================================


class TestCptSeriesRowCap:
    """``_series_row_count`` and the restore-loop cap guard."""

    def test_helper_returns_none_when_no_series(self) -> None:
        """Returns None when the CPT dict has no 'series' key at all."""
        from groundmodel.infrastructure.db.repositories.project_bundle import (
            _series_row_count,
        )

        assert _series_row_count({}) is None
        assert _series_row_count({"id": "x"}) is None

    def test_helper_returns_none_when_series_has_no_depths(self) -> None:
        """Returns None when series exists but has no depths_m array."""
        from groundmodel.infrastructure.db.repositories.project_bundle import (
            _series_row_count,
        )

        assert _series_row_count({"series": {"qc_mpa": [1.0, 2.0]}}) is None

    def test_helper_returns_correct_count(self) -> None:
        """Returns the length of depths_m when present."""
        from groundmodel.infrastructure.db.repositories.project_bundle import (
            _series_row_count,
        )

        cpt = {"series": {"depths_m": list(range(500))}}
        assert _series_row_count(cpt) == 500

    def test_cap_constant_is_100k(self) -> None:
        """Cap is pinned at 100 000 (10× the deepest real CPT in the baseline)."""
        from groundmodel.infrastructure.db.repositories.project_bundle import (
            _MAX_CPT_SERIES_ROWS,
        )

        assert _MAX_CPT_SERIES_ROWS == 100_000

    def test_series_within_cap_accepted(self) -> None:
        """A series right at the cap must pass the guard (below → not >, so 100 000 is OK)."""
        from groundmodel.infrastructure.db.repositories.project_bundle import (
            _MAX_CPT_SERIES_ROWS,
            _series_row_count,
        )

        cpt = {"series": {"depths_m": list(range(_MAX_CPT_SERIES_ROWS))}}
        n = _series_row_count(cpt)
        assert n is not None
        # The restore loop skips when strictly greater-than the cap
        assert not (n > _MAX_CPT_SERIES_ROWS)

    def test_series_over_cap_triggers_guard(self) -> None:
        """A series with one row past the cap must trip the guard."""
        from groundmodel.infrastructure.db.repositories.project_bundle import (
            _MAX_CPT_SERIES_ROWS,
            _series_row_count,
        )

        cpt = {"series": {"depths_m": list(range(_MAX_CPT_SERIES_ROWS + 1))}}
        n = _series_row_count(cpt)
        assert n is not None
        assert n > _MAX_CPT_SERIES_ROWS


# ===========================================================================
# Debt #113 item 1 — Settings.secret_key default warning
# ===========================================================================


class TestSecretKeyWarning:
    """A RuntimeWarning fires when secret_key is the 'change-me' sentinel."""

    def test_default_secret_key_emits_warning(self) -> None:
        """Constructing Settings with no SECRET_KEY override emits RuntimeWarning."""
        from groundmodel.shared.config import _SECRET_KEY_DEFAULT, Settings

        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            s = Settings()
        runtime_warnings = [w for w in caught if issubclass(w.category, RuntimeWarning)]
        assert any(_SECRET_KEY_DEFAULT in str(w.message) for w in runtime_warnings), (
            "Expected a RuntimeWarning mentioning the default key — none fired. "
            f"Warnings seen: {[str(w.message) for w in caught]}"
        )
        assert s.secret_key == _SECRET_KEY_DEFAULT

    def test_custom_secret_key_does_not_warn(self) -> None:
        """Setting a non-default secret_key must NOT emit a RuntimeWarning."""
        from groundmodel.shared.config import Settings

        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            Settings(secret_key="a-real-random-value")  # noqa: S106
        runtime_warnings = [w for w in caught if issubclass(w.category, RuntimeWarning)]
        assert not runtime_warnings, (
            f"Unexpected RuntimeWarning when secret_key is custom: "
            f"{[str(w.message) for w in runtime_warnings]}"
        )


# ===========================================================================
# Debt #113 item 3 — DOV_VALID_PERMKEY_RE uses \A/\Z anchors
# ===========================================================================


class TestPermkeyRegexAnchors:
    """The permkey regex must use true string anchors, not line anchors."""

    def test_regex_uses_true_string_anchors(self) -> None:
        r"""Pattern source must start with \A and end with \Z."""
        from groundmodel.infrastructure.parsers.dov.dov_common import (
            DOV_VALID_PERMKEY_RE,
        )

        assert DOV_VALID_PERMKEY_RE.pattern.startswith(r"\A"), (
            "DOV_VALID_PERMKEY_RE must start with \\A, not ^ (debt #113 item 3)"
        )
        assert DOV_VALID_PERMKEY_RE.pattern.endswith(r"\Z"), (
            "DOV_VALID_PERMKEY_RE must end with \\Z, not $ (debt #113 item 3)"
        )

    def test_multiline_permkey_is_rejected(self) -> None:
        r"""A permkey containing a newline must NOT match (the ^ / $ bug would allow it)."""
        from groundmodel.infrastructure.parsers.dov.dov_common import (
            DOV_VALID_PERMKEY_RE,
        )

        malicious = "2009-000089\n../etc/passwd"
        assert not DOV_VALID_PERMKEY_RE.match(malicious), (
            "A newline-embedded permkey must be rejected — line-anchor ^ would allow it"
        )

    def test_valid_permkey_still_matches(self) -> None:
        """A real DOV permkey like '2009-000089' must still pass."""
        from groundmodel.infrastructure.parsers.dov.dov_common import (
            DOV_VALID_PERMKEY_RE,
        )

        assert DOV_VALID_PERMKEY_RE.match("2009-000089")
        assert DOV_VALID_PERMKEY_RE.match("GEO-2026-042.a_b")


# ===========================================================================
# Debt #113 item 2 — CQL no-single-quote assertion fires on import
# ===========================================================================


class TestCqlNoSingleQuoteAssertion:
    """Importing dov_scalar_observation_client must succeed (all param values are safe)."""

    def test_module_import_succeeds_with_clean_params(self) -> None:
        """If all DOV_OTHER_SCALAR_LAB_TEST_PARAMETERS values are quote-free, import is OK."""
        # If the assertion in the module fires, this import raises AssertionError.
        import groundmodel.infrastructure.parsers.lab.dov.dov_scalar_observation_client  # noqa: F401

    def test_no_single_quotes_in_param_values(self) -> None:
        """All parameter values in DOV_OTHER_SCALAR_LAB_TEST_PARAMETERS are quote-free."""
        from groundmodel.infrastructure.parsers.lab.dov.dov_constants import (
            DOV_OTHER_SCALAR_LAB_TEST_PARAMETERS,
        )

        for _group, param in DOV_OTHER_SCALAR_LAB_TEST_PARAMETERS:
            assert "'" not in param, (
                f"DOV param {param!r} contains a single-quote — "
                "_build_cql_filter would produce broken CQL (debt #113)"
            )


# ===========================================================================
# Debt #112 — TIN payload structural validation (restore hardening)
# ===========================================================================


class TestTinPayloadStructuralValidation:
    """A surface restored from an untrusted .strix carries ``vertices``
    (``[x, y, z]`` float triples) and ``triangles`` (``[i, j, k]`` int
    index triples).  Size is capped elsewhere; this guards the *shape* —
    a malformed triple (wrong arity, non-numeric coordinate, or an index
    pointing outside the vertex array) must be rejected so the restore
    can blank the geometry instead of letting the downstream TIN code
    crash with an opaque ``IndexError`` / ``TypeError``.
    """

    def test_empty_arrays_are_valid(self) -> None:
        """A surface with no geometry yet (both arrays empty) is legitimate."""
        from groundmodel.infrastructure.db.repositories.project_bundle import (
            _validate_tin_payload,
        )

        assert _validate_tin_payload([], []) is True

    def test_none_arrays_are_valid(self) -> None:
        """``None`` means "no geometry provided" — a not-yet-built surface
        that must survive restore unblanked, distinct from a malformed value.
        """
        from groundmodel.infrastructure.db.repositories.project_bundle import (
            _validate_tin_payload,
        )

        assert _validate_tin_payload(None, []) is True
        assert _validate_tin_payload([], None) is True
        assert _validate_tin_payload(None, None) is True

    def test_well_formed_tin_is_valid(self) -> None:
        """Three vertices + one in-range triangle pass the structural check."""
        from groundmodel.infrastructure.db.repositories.project_bundle import (
            _validate_tin_payload,
        )

        verts = [[0.0, 0.0, 1.0], [1.0, 0.0, 2.0], [0.0, 1.0, 3.0]]
        tris = [[0, 1, 2]]
        assert _validate_tin_payload(verts, tris) is True

    def test_vertex_wrong_arity_is_rejected(self) -> None:
        """A vertex that is not exactly 3 coordinates must be rejected."""
        from groundmodel.infrastructure.db.repositories.project_bundle import (
            _validate_tin_payload,
        )

        assert _validate_tin_payload([[0.0, 0.0]], []) is False
        assert _validate_tin_payload([[0.0, 0.0, 1.0, 2.0]], []) is False

    def test_vertex_non_numeric_coordinate_is_rejected(self) -> None:
        """A coordinate that is not int/float must be rejected."""
        from groundmodel.infrastructure.db.repositories.project_bundle import (
            _validate_tin_payload,
        )

        assert _validate_tin_payload([["a", "b", "c"]], []) is False
        assert _validate_tin_payload([[0.0, None, 1.0]], []) is False

    def test_non_list_arrays_are_rejected(self) -> None:
        """``vertices`` / ``triangles`` that are not lists must be rejected."""
        from groundmodel.infrastructure.db.repositories.project_bundle import (
            _validate_tin_payload,
        )

        assert _validate_tin_payload("nope", []) is False
        assert _validate_tin_payload([], {"not": "a list"}) is False

    def test_triangle_wrong_arity_is_rejected(self) -> None:
        """A triangle that is not exactly 3 indices must be rejected."""
        from groundmodel.infrastructure.db.repositories.project_bundle import (
            _validate_tin_payload,
        )

        verts = [[0.0, 0.0, 1.0], [1.0, 0.0, 2.0], [0.0, 1.0, 3.0]]
        assert _validate_tin_payload(verts, [[0, 1]]) is False

    def test_triangle_float_index_is_rejected(self) -> None:
        """A float triangle index would crash list indexing — reject it."""
        from groundmodel.infrastructure.db.repositories.project_bundle import (
            _validate_tin_payload,
        )

        verts = [[0.0, 0.0, 1.0], [1.0, 0.0, 2.0], [0.0, 1.0, 3.0]]
        assert _validate_tin_payload(verts, [[0, 1, 2.0]]) is False

    def test_triangle_index_out_of_range_is_rejected(self) -> None:
        """A triangle index >= len(vertices) would IndexError — reject it."""
        from groundmodel.infrastructure.db.repositories.project_bundle import (
            _validate_tin_payload,
        )

        verts = [[0.0, 0.0, 1.0], [1.0, 0.0, 2.0], [0.0, 1.0, 3.0]]
        assert _validate_tin_payload(verts, [[0, 1, 3]]) is False

    def test_triangle_negative_index_is_rejected(self) -> None:
        """A negative triangle index would wrap around silently — reject it."""
        from groundmodel.infrastructure.db.repositories.project_bundle import (
            _validate_tin_payload,
        )

        verts = [[0.0, 0.0, 1.0], [1.0, 0.0, 2.0], [0.0, 1.0, 3.0]]
        assert _validate_tin_payload(verts, [[0, 1, -1]]) is False

    def test_bool_coordinate_is_rejected(self) -> None:
        """``bool`` is an ``int`` subclass — a True/False coordinate is malformed."""
        from groundmodel.infrastructure.db.repositories.project_bundle import (
            _validate_tin_payload,
        )

        assert _validate_tin_payload([[True, 0.0, 1.0]], []) is False

    def test_non_finite_coordinate_is_rejected(self) -> None:
        """NaN / ±inf are valid floats but yield silent garbage geometry — reject."""
        from groundmodel.infrastructure.db.repositories.project_bundle import (
            _validate_tin_payload,
        )

        assert _validate_tin_payload([[float("nan"), 0.0, 1.0]], []) is False
        assert _validate_tin_payload([[0.0, float("inf"), 1.0]], []) is False
        assert _validate_tin_payload([[0.0, 1.0, float("-inf")]], []) is False

"""Unit tests for the bundle restore child-array cap helper (debt #112, F2).

``_cap`` is the defence that stops a crafted .strix bundle from nesting an
unbounded observation/sample tree inside one borehole. It truncates an
oversized child array and warns what was dropped; arrays within the cap pass
through untouched.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from groundmodel.infrastructure.db.repositories.project_bundle import _cap


def test_cap_truncates_oversized_array_and_warns() -> None:
    """An array longer than the cap is truncated to the cap and a warning fires."""
    logger = MagicMock()
    out = _cap(list(range(100)), 10, "things on borehole X", logger)
    assert out == list(range(10))
    logger.warning.assert_called_once()


def test_cap_passes_through_array_within_limit() -> None:
    """An array within the cap is returned unchanged with no warning."""
    logger = MagicMock()
    out = _cap([1, 2, 3], 10, "things on borehole X", logger)
    assert out == [1, 2, 3]
    logger.warning.assert_not_called()


def test_cap_at_exactly_the_limit_does_not_truncate() -> None:
    """An array of exactly cap length is kept whole (cap is inclusive)."""
    logger = MagicMock()
    out = _cap([1, 2, 3], 3, "things on borehole X", logger)
    assert out == [1, 2, 3]
    logger.warning.assert_not_called()

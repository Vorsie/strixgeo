"""Unit tests for SECRET_KEY enforcement in Settings.

Audit finding #16: shipping the ``change-me`` default key as a mere warning
means a coworker binary can run with a forgeable signing key. The fix keeps
the warning for local development but turns it into a hard error in any
non-development environment.
"""

from __future__ import annotations

import warnings

import pytest

from groundmodel.shared.config import _SECRET_KEY_DEFAULT, Settings


def test_default_secret_key_in_development_warns_not_raises() -> None:
    """Local dev keeps the soft warning so first-run setup is not blocked."""
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        Settings(
            environment="development",
            secret_key=_SECRET_KEY_DEFAULT,
            _env_file=None,
        )
    assert any(issubclass(w.category, RuntimeWarning) for w in caught)


def test_default_secret_key_in_production_raises() -> None:
    """A non-dev environment with the default key is a hard error."""
    with pytest.raises(ValueError, match="SECRET_KEY"):
        Settings(
            environment="production",
            secret_key=_SECRET_KEY_DEFAULT,
            _env_file=None,
        )


def test_real_secret_key_in_production_is_accepted() -> None:
    """A genuine key in production passes validation."""
    settings = Settings(
        environment="production",
        secret_key="a-real-secret-value",
        _env_file=None,
    )
    assert settings.secret_key == "a-real-secret-value"

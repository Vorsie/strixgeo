"""Regression tests for error-message hardening (debt #43).

Previously the DOV / DHMVII upstream-failure handlers carried the
library's exception class name + message into the user-facing
``HTTPException.detail``. That's debug-friendly today but leaks
dependency versions / internal type names / network topology the
moment Strix ever fields a non-trusted caller.

These tests assert by source-grep that no ``__class__.__name__`` /
``type(...).__name__`` / verbatim exception-as-string leaks into the
user-facing ``detail`` argument of HTTPException. The specific text
goes through the server-side logger (where it remains observable
for support).
"""

from __future__ import annotations

import re
from pathlib import Path

ROUTER_PATHS = [
    Path("src/groundmodel/api/routers/cpt.py"),
    Path("src/groundmodel/api/routers/borehole.py"),
    Path("src/groundmodel/api/routers/dem.py"),
]


def _user_facing_detail_strings(source: str) -> list[str]:
    """Extract every ``detail=...`` argument from HTTPException
    constructions in the source — the strings that reach the user.
    """
    # Matches ``detail=f"..."`` and ``detail="..."`` (single-line).
    pattern = re.compile(r'detail\s*=\s*(?:f?")([^"]*)"')
    return pattern.findall(source)


def test_no_router_leaks_exception_class_name_to_user_detail() -> None:
    """No HTTPException.detail string carries ``__class__.__name__`` or
    ``type(...).__name__`` interpolations.

    Catches the audit's finding: a future non-trusted caller of the API
    would receive ``"DOV request failed: ConnectError: ..."`` and
    derive that we run on httpx. Generic messages on the user side
    plus structured warnings server-side give support the trail
    without giving an attacker the recon.
    """
    for path in ROUTER_PATHS:
        source = path.read_text(encoding="utf-8")
        details = _user_facing_detail_strings(source)
        for d in details:
            assert "__class__" not in d, f"{path}: detail leaks __class__: {d!r}"
            assert "__name__" not in d, f"{path}: detail leaks __name__: {d!r}"
            # ``{type(err).__name__}`` is the bare-type variant of the
            # same leak — also banned.
            assert "type(" not in d, f"{path}: detail leaks type(...): {d!r}"


def test_routers_still_log_full_exception_server_side() -> None:
    """The class name / message MUST still go to the log so support
    has a debugging trail.

    Looking for a ``logger.warning(...type(`` or ``logger.error(...type(``
    pattern inside each router whose upstream-failure handler used to
    inline the class name in ``detail=``.
    """
    for path in ROUTER_PATHS:
        source = path.read_text(encoding="utf-8")
        # The two paths that need this contain at least one
        # ``logger.warning`` (or ``logger.error``) with a ``type(``
        # interpolation. dem.py has at least one DHMVII path, cpt.py
        # + borehole.py each have the DOV path.
        has_log_with_type = bool(re.search(r"logger\.(warning|error)\([^)]*type\(", source))
        assert has_log_with_type, (
            f"{path}: no logger.warning/error with type(...) — class "
            f"name leak fix would have lost the server-side trail"
        )

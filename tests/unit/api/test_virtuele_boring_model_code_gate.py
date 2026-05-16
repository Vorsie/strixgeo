"""Codelist gate for the Virtuele Boring ``models`` param (debt #50).

Each requested model code is embedded raw into the outbound DOV
doorprik URL path. The endpoint now rejects any code that is not a
short ASCII slug before fan-out. These tests pin the regex contract
directly — it is the whole of the fix and is pure (no app/DB needed).
"""

from __future__ import annotations

import pytest

from groundmodel.api.routers.virtuele_boring import _VALID_MODEL_CODE_RE


@pytest.mark.parametrize(
    "code",
    [
        "g3dv3_F",
        "hcovv2_H",
        "G3Dv3",
        "model.v2",
        "a-b_c.1",
        "x",  # 1 char — lower bound
        "a" * 50,  # 50 chars — upper bound
    ],
)
def test_real_lagenmodel_codes_pass(code: str) -> None:
    """Genuine DOV lagenmodel slugs match the gate."""
    assert _VALID_MODEL_CODE_RE.match(code) is not None


@pytest.mark.parametrize(
    "code",
    [
        "",  # empty
        "a" * 51,  # over the 50-char cap
        "../etc/passwd",  # path traversal
        "g3dv3/F",  # embedded slash (would extend the URL path)
        "model code",  # space
        "model%2F",  # percent-encoding attempt
        "http://evil",  # scheme injection attempt
        "model\n",  # newline
        "model?x=1",  # query injection
        "café",  # non-ASCII
    ],
)
def test_injection_shaped_codes_are_rejected(code: str) -> None:
    """Anything outside the short-ASCII-slug charset/length is rejected."""
    assert _VALID_MODEL_CODE_RE.match(code) is None

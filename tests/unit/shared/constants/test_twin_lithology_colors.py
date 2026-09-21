"""Cross-language twin test -- base-lithology display colours (debt #284/#275).

The base-lithology -> display-hex table lives once in Python
(``shared/constants/litho_constants.py`` -- ``LITHOLOGY_COLORS`` +
``LITHOLOGY_FALLBACK_COLOR``) and once in TypeScript
(``desktop/src/renderer/src/utils/lithoConstants.ts`` -- ``LITHOLOGY_COLORS`` +
``LITHOLOGY_FALLBACK_COLOR``). Both docstrings already assert the two MUST stay
byte-identical: the ghost-suggestion overlay renders a layer with the TS colour
BEFORE any formation row exists, and on accept the backend stamps
``geological_formation.color`` from the Python colour (debt #145), so a hex drift
on either side lets a preview disagree with the accepted band.

Until now nothing enforced that across the language boundary. This module and its
TypeScript twin (``desktop/src/renderer/src/utils/lithologyColors.twin.test.ts``)
read the SAME committed arbiter,
``tests/fixtures/contracts/lithology_colors.json``. A drift on either side --
a changed hex, an added key, a dropped key -- turns the other side's suite red.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from groundmodel.shared.constants.litho_constants import (
    LITHOLOGY_COLORS,
    LITHOLOGY_FALLBACK_COLOR,
)

# tests/unit/shared/constants/ -> tests/
_FIXTURE_PATH = (
    Path(__file__).resolve().parents[3] / "fixtures" / "contracts" / "lithology_colors.json"
)


def _fixture() -> dict[str, Any]:
    """Load the shared twin fixture.

    Returns
    -------
    dict[str, Any]
        The parsed arbiter: ``colors`` (the full base-lithology -> hex table)
        and ``fallback_color`` (the unrecognised-token colour).
    """
    with _FIXTURE_PATH.open(encoding="utf-8") as handle:
        return dict(json.load(handle))


def test_lithology_colors_match_the_shared_contract() -> None:
    """The Python colour table equals the shared arbiter exactly.

    Exact-dict equality catches a changed hex, an added lithology, or a dropped
    one -- any of which would let the accepted band diverge from its ghost.
    """
    assert LITHOLOGY_COLORS == _fixture()["colors"]


def test_lithology_fallback_colour_matches_the_shared_contract() -> None:
    """The Python fallback colour equals the shared arbiter."""
    assert LITHOLOGY_FALLBACK_COLOR == _fixture()["fallback_color"]

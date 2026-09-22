"""Cross-language twin test -- cross-section channel toggle keys (debt #284/#275).

The section ``view_state`` carries two toggle bags, ``cpt_channels`` and
``borehole_channels``. Their keys live once in TypeScript
(``desktop/src/renderer/src/components/sections/cptChannels.ts`` --
``DEFAULT_CPT_CHANNELS`` / ``DEFAULT_BOREHOLE_CHANNELS``) and once in Python
(``api/schemas/project/cross_section.py`` -- ``CptChannels`` /
``BoreholeChannels``, ``extra='forbid'``). The renderer PATCHes the WHOLE bag on
every toggle, so a key the backend does not know rejects every toggle with a
422 -- which is exactly what happened on 2026-09-22 after PR #18 added the
coded-lithology toggle on the renderer side only.

This module and its TypeScript twin
(``desktop/src/renderer/src/components/sections/cptChannels.twin.test.ts``) read
the SAME committed arbiter, ``tests/fixtures/contracts/section_channel_keys.json``.
A key added or dropped on either side turns the other side's suite red.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from groundmodel.api.schemas.project.cross_section import (
    BoreholeChannels,
    CptChannels,
)

# tests/unit/api/ -> tests/
_FIXTURE_PATH = (
    Path(__file__).resolve().parents[2] / "fixtures" / "contracts" / "section_channel_keys.json"
)


def _fixture() -> dict[str, Any]:
    """Load the shared twin fixture.

    Returns
    -------
    dict[str, Any]
        The parsed ``section_channel_keys.json``.
    """
    return json.loads(_FIXTURE_PATH.read_text(encoding="utf-8"))


def test_cpt_channel_keys_match_the_shared_contract() -> None:
    """The backend accepts exactly the CPT toggles the renderer can send."""
    assert set(CptChannels.model_fields) == set(_fixture()["cpt_channels"])


def test_borehole_channel_keys_match_the_shared_contract() -> None:
    """The backend accepts exactly the borehole toggles the renderer can send."""
    assert set(BoreholeChannels.model_fields) == set(_fixture()["borehole_channels"])

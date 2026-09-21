"""Cross-language twin test -- admixture -> NAD-fork detection (debt #284/#275).

Whether a litho unit's pure-vs-with-admixture NAD choice is a real fork (owner
ruling 2026-09-04) is decided once in Python
(``domain/services/nad_admixture_choice.py`` -- ``unit_admixture_is_ambiguous``,
via ``NAD_QC_BANDS`` + the ``_SECONDARY_ADMIXTURE_CODES`` sets) and once in
TypeScript (``desktop/src/renderer/src/utils/admixtureNadChoice.ts`` --
``unitAdmixtureIsAmbiguous``, via ``SECONDARY_ADMIXTURE_CODES`` ported verbatim
from ``nad_classification_constants.py``). Both must agree on which soils fork
and which admixture codes fork them, or the geotech prompt asks (or hides) a unit
on one platform that the other treats differently.

``test_nad_admixture_choice.py`` and ``admixtureNadChoice.test.ts`` were two
hand-maintained mirrors with nothing enforcing they stay in step. This module and
its TypeScript twin (``desktop/src/renderer/src/utils/admixtureNadChoice.twin.test.ts``)
read the SAME committed arbiter,
``tests/fixtures/contracts/nad_admixture_fork.json``. A drift on either side
turns the other side's suite red.

Scope: the arbiter pins the DETECTION rule only. The sibling "which NAD column a
stored answer binds to" (``resolve_admixture_variant``: pure->clean,
with_admixture->secondary) is resolved on the backend alone, so it has no
cross-language twin and stays covered by ``test_nad_admixture_choice.py``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from groundmodel.domain.services.nad_admixture_choice import unit_admixture_is_ambiguous
from groundmodel.domain.value_objects.admixture import Admixture

# tests/unit/domain/services/ -> tests/
_FIXTURE_PATH = (
    Path(__file__).resolve().parents[3] / "fixtures" / "contracts" / "nad_admixture_fork.json"
)


def _fixture() -> dict[str, Any]:
    """Load the shared twin fixture.

    Returns
    -------
    dict[str, Any]
        The parsed arbiter: ``cases``, each a ``soil`` + ``admixture_codes`` +
        the agreed ``expected_ambiguous`` boolean.
    """
    with _FIXTURE_PATH.open(encoding="utf-8") as handle:
        return dict(json.load(handle))


_CASES: list[dict[str, Any]] = list(_fixture()["cases"])


@pytest.mark.parametrize("case", _CASES, ids=[c["name"] for c in _CASES])
def test_fork_detection_matches_the_shared_contract(case: dict[str, Any]) -> None:
    """Each fixture case's ambiguity matches the domain detector.

    Parameters
    ----------
    case : dict[str, Any]
        One fixture case: a ``soil`` token, its ``admixture_codes`` and the
        agreed ``expected_ambiguous``. The admixtures are built as
        ``Admixture(soil_code=..., amount="M")`` exactly as the segmenter feeds
        them (``amount`` does not affect the fork rule -- only ``soil_code``).
    """
    admixtures = tuple(Admixture(soil_code=code, amount="M") for code in case["admixture_codes"])
    assert unit_admixture_is_ambiguous(case["soil"], admixtures) is case["expected_ambiguous"], (
        case["name"]
    )

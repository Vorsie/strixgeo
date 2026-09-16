"""Cross-boundary arbiter test — admixture canonical key (debt #284).

The admixture canonical key ``"<soil_code>:<canonical_amount>"``, with the
owner's 2026-09-06 amount-step synonyms ``S -> V`` (sterk = veel) and
``Z -> W`` (zwak = weinig), lives in ``domain/value_objects/admixture.py``
(``Admixture.canonical_key``) + ``admixture_constants.py``
(``canonical_amount``). It is used by the Accept find-or-create key,
auto-correlate ranking and the litho-formation lookup.

Unlike the section-corridor and packing-class-key twins, this key is CURRENTLY
PYTHON-ONLY: the renderer sends raw admixtures ``{soil_code, amount, locally}``
to the API and the BACKEND computes the key server-side, so there is no
TypeScript implementation to drift against today. (The renderer's
``buildSeamClassOf`` is amount-independent by design — soil codes only — and is
a different concept, not this key's twin.) This module holds the backend to the
committed arbiter ``tests/fixtures/contracts/admixture_canonical_key.json``; the
moment a renderer needs the same key, a
``desktop/.../admixtureCanonicalKey.twin.test.ts`` reading the SAME file makes
the drift cross-language-caught, exactly as debt #284 asks. The ``locally``
flag is intentionally excluded from the key.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from groundmodel.domain.value_objects.admixture import Admixture

# tests/unit/domain/value_objects/ -> tests/
_FIXTURE_PATH = (
    Path(__file__).resolve().parents[3] / "fixtures" / "contracts" / "admixture_canonical_key.json"
)


def _fixture() -> dict[str, Any]:
    """Load the shared arbiter fixture.

    Returns
    -------
    dict[str, Any]
        The parsed arbiter: ``key_cases`` (soil + amount -> expected key) and
        ``equivalence_cases`` (two admixtures + whether their keys are equal).
    """
    with _FIXTURE_PATH.open(encoding="utf-8") as handle:
        return dict(json.load(handle))


_FIX = _fixture()
_KEY_CASES: list[dict[str, Any]] = list(_FIX["key_cases"])
_EQUIV_CASES: list[dict[str, Any]] = list(_FIX["equivalence_cases"])


@pytest.mark.parametrize("case", _KEY_CASES, ids=[c["name"] for c in _KEY_CASES])
def test_canonical_key_matches_the_shared_contract(case: dict[str, Any]) -> None:
    """Each fixture case's canonical key matches the value object.

    Parameters
    ----------
    case : dict[str, Any]
        One fixture case: ``soil_code``, ``amount`` and the agreed
        ``expected_key`` (with the synonym folded).
    """
    key = Admixture(soil_code=case["soil_code"], amount=case["amount"]).canonical_key()
    assert key == case["expected_key"], case["name"]


@pytest.mark.parametrize("case", _EQUIV_CASES, ids=[c["name"] for c in _EQUIV_CASES])
def test_key_equivalence_matches_the_shared_contract(case: dict[str, Any]) -> None:
    """Each fixture equivalence case matches the value object.

    Parameters
    ----------
    case : dict[str, Any]
        One fixture case: two admixtures (``a`` and ``b``, each ``soil_code`` +
        ``amount`` + optional ``locally``) and whether their canonical keys are
        ``equal``.
    """
    key_a = Admixture(
        soil_code=case["a"]["soil_code"],
        amount=case["a"]["amount"],
        locally=case["a"].get("locally", False),
    ).canonical_key()
    key_b = Admixture(
        soil_code=case["b"]["soil_code"],
        amount=case["b"]["amount"],
        locally=case["b"].get("locally", False),
    ).canonical_key()
    assert (key_a == key_b) is case["equal"], case["name"]

"""PRE_DRILL_NOT_APPLIED on the real camz-001 campaign GEFs (project 23.15-002).

Soundings 39 and 42 declare a 0.35 m pre-drill (``#MEASUREMENTVAR= 13``) but
their depth column starts at 0.02 m; the report sheets plot them from 0.37 m.
The importer flags them. Soundings 1 (no pre-drill) and 110 (none) and 112
(1.2 m declared, data from 1.2 m) must not be flagged.

The GEFs are the owner's campaign files, not repo fixtures. Point
``STRIX_CAMZ_GEF_DIR`` at the ``camz-001/finale gefs`` directory (default
``data/cpt_pdf/camz-001-gefs``, gitignored); the tests skip when absent.

No database is touched.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from groundmodel.infrastructure.parsers.cpt.gef.gef_parser import GEFParser
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel

GEF_DIR = Path(os.environ.get("STRIX_CAMZ_GEF_DIR", "data/cpt_pdf/camz-001-gefs"))

pytestmark = pytest.mark.skipif(
    not (GEF_DIR / "23.15-002_39.gef").exists(),
    reason=f"camz-001 campaign GEFs not present ({GEF_DIR})",
)


def _issues(sounding: str) -> dict[str, object]:
    """Parse ``23.15-002_<sounding>.gef`` and index its issues by code."""
    text = (GEF_DIR / f"23.15-002_{sounding}.gef").read_text(encoding="latin-1")
    result = GEFParser().parse(text)
    return {i.code: i for i in result.issues}


@pytest.mark.parametrize("sounding", ["39", "42"])
def test_the_unshifted_pre_drill_soundings_are_flagged(sounding: str) -> None:
    """39 and 42: 0.35 m declared, the stored series starts at 0.02 m."""
    issue = _issues(sounding).get("PRE_DRILL_NOT_APPLIED")
    assert issue is not None
    assert issue.level == ValidationLevel.WARNING
    assert issue.details == {"pre_drill_m": 0.35, "first_depth_m": 0.02}


@pytest.mark.parametrize("sounding", ["1", "110", "112"])
def test_the_other_soundings_are_not_flagged(sounding: str) -> None:
    """No pre-drill declared (1, 110) or the data starts at it (112)."""
    assert "PRE_DRILL_NOT_APPLIED" not in _issues(sounding)

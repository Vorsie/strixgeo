"""Unit tests for _apply_grain_size_method_fallback.

Closes the gap that bit us 2026-05-09: DOV's per-observation XML
sometimes ships grain-size rows without a ``<methode>`` element, so
``GrainSize.method`` ends up ``None`` and the lab-pane legend falls
back to placeholder labels ("Method 1" / "Method 2"). The orchestrator
overrides with the WFS row's ``methode`` (which IS reliably present)
when the XML left it null.
"""

from __future__ import annotations

from datetime import date
from uuid import uuid4

from groundmodel.application.import_samples_dov import _apply_grain_size_method_fallback
from groundmodel.domain.models.lab.grain_size import GrainSize
from groundmodel.infrastructure.parsers.lab.dov.grain_size_parse_result import (
    GrainSizeParseResult,
)
from groundmodel.infrastructure.parsers.lab.dov.grain_size_wfs_row import GrainSizeWfsRow


def _row(methode: str | None) -> GrainSizeWfsRow:
    return GrainSizeWfsRow(
        permkey="2024-50459846",
        parent_sample_permkey="2024-401424",
        fiche_url="https://www.dov.vlaanderen.be/data/observatie/2024-50459846",
        xml_url="https://www.dov.vlaanderen.be/xdov/proxy/export/observatie/2024-50459846",
        methode=methode,
    )


def _gs(method: str | None) -> GrainSizeParseResult:
    return GrainSizeParseResult(
        grain_size=GrainSize(
            sample_id=uuid4(),
            diameters_mm=[0.063, 0.125, 0.25],
            pct_larger=[80.0, 50.0, 20.0],
            method=method,
            test_date=date(2024, 1, 26),
            lime_removed=False,
            organics_removed=False,
        ),
        issues=[],
    )


def test_method_none_falls_back_to_row_methode() -> None:
    """XML had no <methode>; WFS row methode wins, no placeholder leaks."""
    parsed = _gs(method=None)
    row = _row(methode="Zeving op massa met grootte <= 2mm (fijnkorrelig)")

    result = _apply_grain_size_method_fallback(parsed, row)

    assert result.grain_size is not None
    assert result.grain_size.method == "Zeving op massa met grootte <= 2mm (fijnkorrelig)"


def test_method_set_in_xml_wins_over_row() -> None:
    """When the XML provides <methode>, the WFS row is NOT used."""
    parsed = _gs(method="Zeving (XML-source)")
    row = _row(methode="Zeving (WFS-source)")

    result = _apply_grain_size_method_fallback(parsed, row)

    assert result.grain_size is not None
    assert result.grain_size.method == "Zeving (XML-source)"


def test_both_none_stays_none() -> None:
    """Neither XML nor WFS row carries a method — leave method as None."""
    parsed = _gs(method=None)
    row = _row(methode=None)

    result = _apply_grain_size_method_fallback(parsed, row)

    assert result.grain_size is not None
    assert result.grain_size.method is None


def test_grain_size_none_is_passthrough() -> None:
    """A parse result with no GrainSize (heavy parse failure) returns unchanged."""
    parsed = GrainSizeParseResult(grain_size=None, issues=[])
    row = _row(methode="Hydrometer")

    result = _apply_grain_size_method_fallback(parsed, row)

    assert result.grain_size is None


def test_empty_string_methode_treated_as_none() -> None:
    """Empty-string row methode is falsy → no override."""
    parsed = _gs(method=None)
    row = _row(methode="")

    result = _apply_grain_size_method_fallback(parsed, row)

    assert result.grain_size is not None
    assert result.grain_size.method is None

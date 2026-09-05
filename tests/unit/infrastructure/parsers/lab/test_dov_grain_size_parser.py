"""Unit tests for DovGrainSizeParser — DOV observation XML → GrainSize.

Fixtures mirror the real DOV grain-size observation schema (verified live
2026-05-08, example permkey 2022-2618228). Three method flavours exercised:
"Zeving" (sieve), "Hydrometer", "D.m.v. Laserdiffractie".

Caller-supplied parameter:
* sample_id — required keyword arg.
"""

from __future__ import annotations

from datetime import date
from uuid import uuid4

import pytest

from groundmodel.infrastructure.parsers.lab.dov.dov_grain_size_parser import (
    DovGrainSizeParser,
)
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel
from groundmodel.shared.exceptions import ParseError

_NS = "http://kern.schemas.dov.vlaanderen.be"


def _curve_row(diameter: str, pct: str) -> str:
    """Build one <meetreekswaarde> row.

    DOV emits <meetwaarde_numeriek> BEFORE <meetpunt_numeriek> in the source
    XML — we mirror that order so the fixture is faithful and the parser's
    by-tag-name extraction (rather than by-position) is genuinely tested.
    """
    return (
        f"<meetreekswaarde>"
        f"<meetwaarde_numeriek>{pct}</meetwaarde_numeriek>"
        f"<meetpunt_numeriek>{diameter}</meetpunt_numeriek>"
        f"</meetreekswaarde>"
    )


def _treatment(kind: str, value: str) -> str:
    """Build one <behandeling> wrapper with the same-named inner child + waarde."""
    return (
        f"<behandeling>"
        f"<behandeling>{kind}</behandeling>"
        f"<behandeling_waarde>{value}</behandeling_waarde>"
        f"</behandeling>"
    )


def _xml(
    *,
    parametergroep: str = "Onderkenningsproeven-korrelverdeling ",
    parameter: str = "Korrelverdeling d.m.v. zeefproef",
    methode: str = "Zeving",
    fenomeentijd: str = "2002-11-26",
    curve_rows: str = "",
    treatments: str = "",
    omit_series: bool = False,
) -> bytes:
    """Build a DOV grain-size observation XML matching the real schema.

    Default fixture values come straight from the live permkey 2022-2618228
    sieve test we probed.
    """
    series = (
        ""
        if omit_series
        else f"""
            <waarde_meetreeks>
                <meetpuntparameter>Diameter</meetpuntparameter>
                <meetpuntparameter_eenheid>mm</meetpuntparameter_eenheid>
                <meetwaardeparameter>Fractie met grotere diameter</meetwaardeparameter>
                <meetwaardeparameter_eenheid>%</meetwaardeparameter_eenheid>
                {curve_rows}
            </waarde_meetreeks>
        """
    )

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<ns4:dov-schema xmlns:ns4="{_NS}">
  <observatie>
    <identificator>
      <identificator>2022-2618228</identificator>
      <toegekend_door>DOV</toegekend_door>
    </identificator>
    <geobserveerd_object>
      <objecttype>monster</objecttype>
      <naam>19</naam>
      <permkey>2017-137886</permkey>
    </geobserveerd_object>
    <diepte_van>18.000</diepte_van>
    <diepte_tot>19.000</diepte_tot>
    <parameter>{parameter}</parameter>
    <parametergroep>{parametergroep}</parametergroep>
    {series}
    <methode>{methode}</methode>
    <fenomeentijd>{fenomeentijd}</fenomeentijd>
    <herkomst>LABO</herkomst>
    <uitvoerder>
      <organisatie><naam>Aggregate Consultants BVBA</naam></organisatie>
    </uitvoerder>
    {treatments}
  </observatie>
</ns4:dov-schema>""".encode()


# ---------------------------------------------------------------------------
# Header + curve — happy path
# ---------------------------------------------------------------------------


class TestHappyPath:
    def test_real_sieve_curve_round_trip(self) -> None:
        # Reproduces the live curve from permkey 2022-2618228 (sieve test).
        rows = (
            _curve_row("0.063", "95.0")
            + _curve_row("0.125", "87.0")
            + _curve_row("0.25", "45.0")
            + _curve_row("0.5", "8.0")
            + _curve_row("1.0", "3.0")
            + _curve_row("2.0", "1.0")
            + _curve_row("4.0", "0.0")
        )
        sample = uuid4()
        result = DovGrainSizeParser().parse(_xml(curve_rows=rows), sample_id=sample)
        gs = result.grain_size
        assert gs.sample_id == sample
        assert gs.diameters_mm == pytest.approx([0.063, 0.125, 0.25, 0.5, 1.0, 2.0, 4.0])
        assert gs.pct_larger == pytest.approx([95.0, 87.0, 45.0, 8.0, 3.0, 1.0, 0.0])
        assert gs.method == "Zeving"
        assert gs.test_date == date(2002, 11, 26)
        assert result.has_errors is False

    def test_methode_passthrough_for_three_methods(self) -> None:
        rows = _curve_row("0.063", "95.0") + _curve_row("0.125", "87.0")
        for method in ("Zeving", "Hydrometer", "D.m.v. Laserdiffractie"):
            result = DovGrainSizeParser().parse(
                _xml(methode=method, curve_rows=rows),
                sample_id=uuid4(),
            )
            assert result.grain_size.method == method
            assert result.has_errors is False

    def test_meetreekswaarde_extraction_is_by_tag_not_position(self) -> None:
        # DOV emits <meetwaarde_numeriek> before <meetpunt_numeriek> — the
        # parser must use tag names, not positional access. Building rows in
        # the source order verifies that.
        rows = _curve_row("0.063", "95.0")
        result = DovGrainSizeParser().parse(_xml(curve_rows=rows), sample_id=uuid4())
        # Diameter went to diameters_mm, percentage to pct_larger — not swapped.
        assert result.grain_size.diameters_mm == pytest.approx([0.063])
        assert result.grain_size.pct_larger == pytest.approx([95.0])


# ---------------------------------------------------------------------------
# Pre-treatment booleans — <behandeling> blocks
# ---------------------------------------------------------------------------


class TestTreatments:
    def test_lime_and_organics_both_no(self) -> None:
        # Real permkey 2022-2618228 fixture — both pre-treatments declined.
        rows = _curve_row("0.063", "95.0") + _curve_row("0.125", "87.0")
        treatments = _treatment("Kalk verwijderd", "nee") + _treatment(
            "Organisch materiaal verwijderd", "nee"
        )
        result = DovGrainSizeParser().parse(
            _xml(curve_rows=rows, treatments=treatments),
            sample_id=uuid4(),
        )
        assert result.grain_size.lime_removed is False
        assert result.grain_size.organics_removed is False

    def test_lime_yes_organics_yes(self) -> None:
        rows = _curve_row("0.063", "95.0") + _curve_row("0.125", "87.0")
        treatments = _treatment("Kalk verwijderd", "ja") + _treatment(
            "Organisch materiaal verwijderd", "ja"
        )
        result = DovGrainSizeParser().parse(
            _xml(curve_rows=rows, treatments=treatments),
            sample_id=uuid4(),
        )
        assert result.grain_size.lime_removed is True
        assert result.grain_size.organics_removed is True

    def test_no_treatments_block_means_none(self) -> None:
        rows = _curve_row("0.063", "95.0") + _curve_row("0.125", "87.0")
        result = DovGrainSizeParser().parse(
            _xml(curve_rows=rows, treatments=""),
            sample_id=uuid4(),
        )
        assert result.grain_size.lime_removed is None
        assert result.grain_size.organics_removed is None

    def test_unknown_treatment_kind_silently_ignored(self) -> None:
        rows = _curve_row("0.063", "95.0") + _curve_row("0.125", "87.0")
        # DOV could add a third pre-treatment kind tomorrow; we don't crash.
        treatments = _treatment("Future pre-treatment", "ja") + _treatment("Kalk verwijderd", "ja")
        result = DovGrainSizeParser().parse(
            _xml(curve_rows=rows, treatments=treatments),
            sample_id=uuid4(),
        )
        assert result.grain_size.lime_removed is True
        # Organics still None — we didn't see a "Organisch materiaal verwijderd"
        # behandeling in this XML, only the unknown future one + lime.
        assert result.grain_size.organics_removed is None

    def test_case_insensitive_ja_nee(self) -> None:
        rows = _curve_row("0.063", "95.0") + _curve_row("0.125", "87.0")
        # Some DOV exports use "Ja"/"Nee" capitalised; we accept anyway.
        treatments = _treatment("Kalk verwijderd", "JA") + _treatment(
            "Organisch materiaal verwijderd", "Nee"
        )
        result = DovGrainSizeParser().parse(
            _xml(curve_rows=rows, treatments=treatments),
            sample_id=uuid4(),
        )
        assert result.grain_size.lime_removed is True
        assert result.grain_size.organics_removed is False


# ---------------------------------------------------------------------------
# Resilience — malformed curves, missing series, fatal cases
# ---------------------------------------------------------------------------


class TestResilience:
    def test_no_waarde_meetreeks_emits_warning_empty_curve(self) -> None:
        result = DovGrainSizeParser().parse(_xml(omit_series=True), sample_id=uuid4())
        assert result.grain_size.diameters_mm == []
        assert result.grain_size.pct_larger == []
        assert any(i.code == "NO_CURVE" for i in result.issues)
        assert result.has_errors is False  # WARNING, not ERROR

    def test_empty_waarde_meetreeks_emits_warning(self) -> None:
        # <waarde_meetreeks> exists but has no <meetreekswaarde> children.
        result = DovGrainSizeParser().parse(_xml(curve_rows=""), sample_id=uuid4())
        assert result.grain_size.diameters_mm == []
        assert any(i.code == "NO_CURVE" for i in result.issues)

    def test_incomplete_row_skipped_with_warning(self) -> None:
        # Row missing <meetpunt_numeriek> — skipped, others retained.
        rows = (
            _curve_row("0.063", "95.0")
            + "<meetreekswaarde><meetwaarde_numeriek>50.0</meetwaarde_numeriek></meetreekswaarde>"
            + _curve_row("0.125", "87.0")
        )
        result = DovGrainSizeParser().parse(_xml(curve_rows=rows), sample_id=uuid4())
        assert result.grain_size.diameters_mm == pytest.approx([0.063, 0.125])
        assert any(i.code == "INCOMPLETE_CURVE_POINT" for i in result.issues)

    def test_non_numeric_row_skipped_with_warning(self) -> None:
        rows = _curve_row("0.063", "95.0") + _curve_row("not-a-number", "50.0")
        result = DovGrainSizeParser().parse(_xml(curve_rows=rows), sample_id=uuid4())
        assert result.grain_size.diameters_mm == pytest.approx([0.063])
        assert any(
            i.code == "INCOMPLETE_CURVE_POINT" and i.level == ValidationLevel.WARNING
            for i in result.issues
        )

    def test_descending_diameters_yield_invalid_curve_error(self) -> None:
        # Domain GrainSize requires strictly ascending diameters; non-ascending
        # → INVALID_CURVE ERROR + result entity has empty arrays so the
        # orchestrator skips persistence.
        rows = _curve_row("2.0", "1.0") + _curve_row("0.063", "95.0")
        result = DovGrainSizeParser().parse(_xml(curve_rows=rows), sample_id=uuid4())
        assert result.grain_size.diameters_mm == []
        assert result.grain_size.pct_larger == []
        assert result.has_errors is True
        assert any(
            i.code == "INVALID_CURVE" and i.level == ValidationLevel.ERROR for i in result.issues
        )

    def test_percentage_above_100_yields_invalid_curve(self) -> None:
        rows = _curve_row("0.063", "150.0")
        result = DovGrainSizeParser().parse(_xml(curve_rows=rows), sample_id=uuid4())
        assert result.has_errors is True
        assert any(i.code == "INVALID_CURVE" for i in result.issues)

    def test_missing_method_emits_warning(self) -> None:
        rows = _curve_row("0.063", "95.0") + _curve_row("0.125", "87.0")
        result = DovGrainSizeParser().parse(_xml(methode="", curve_rows=rows), sample_id=uuid4())
        assert result.grain_size.method is None
        assert any(i.code == "MISSING_METHOD" for i in result.issues)

    def test_wrong_parametergroep_emits_warning(self) -> None:
        # Orchestrator was supposed to filter — log a warning if it didn't.
        rows = _curve_row("0.063", "95.0") + _curve_row("0.125", "87.0")
        result = DovGrainSizeParser().parse(
            _xml(parametergroep="Bodem_chemisch", curve_rows=rows),
            sample_id=uuid4(),
        )
        assert any(i.code == "WRONG_PARAMETERGROEP" for i in result.issues)
        # Still produces a valid curve — the parser doesn't reject on this.
        assert result.grain_size.diameters_mm == pytest.approx([0.063, 0.125])


# ---------------------------------------------------------------------------
# Fatal cases — ParseError raised
# ---------------------------------------------------------------------------


class TestFatalCases:
    def test_unparseable_xml_raises(self) -> None:
        with pytest.raises(ParseError, match="parse error"):
            DovGrainSizeParser().parse(b"<not>valid", sample_id=uuid4())

    def test_no_observatie_root_raises(self) -> None:
        empty = (
            f'<?xml version="1.0"?><ns4:dov-schema xmlns:ns4="{_NS}"><wrong-root/></ns4:dov-schema>'
        ).encode()
        with pytest.raises(ParseError, match="missing <observatie>"):
            DovGrainSizeParser().parse(empty, sample_id=uuid4())


# ---------------------------------------------------------------------------
# Caller-supplied params — sample_id required keyword
# ---------------------------------------------------------------------------


class TestCallerArgs:
    def test_sample_id_threaded_to_grain_size(self) -> None:
        sample = uuid4()
        rows = _curve_row("0.063", "95.0") + _curve_row("0.125", "87.0")
        result = DovGrainSizeParser().parse(_xml(curve_rows=rows), sample_id=sample)
        assert result.grain_size.sample_id == sample

    def test_sample_id_required_keyword(self) -> None:
        # Forgetting sample_id is a TypeError, not a silent miswire.
        with pytest.raises(TypeError):
            DovGrainSizeParser().parse(_xml())  # type: ignore[call-arg]

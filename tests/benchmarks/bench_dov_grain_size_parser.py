"""DovGrainSizeParser performance benchmarks.

Run with::

    uv run pytest tests/benchmarks/bench_dov_grain_size_parser.py --benchmark-enable -v

Pre-built synthetic XML payloads sized to bracket realistic DOV grain-size
observations:

* minimal — 2 curve points (smallest valid input).
* typical — 13 curve points (matches the real ISO sieve series we probed
  for permkey 2022-2618228).
* large — 200 curve points (laser-diffraction analyses sometimes report
  bin-resolved curves with hundreds of points).

Reference numbers will land in CLAUDE.local.md after the full ingest
pipeline is in place.
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from groundmodel.infrastructure.parsers.lab.dov.dov_grain_size_parser import (
    DovGrainSizeParser,
)

_NS = "http://kern.schemas.dov.vlaanderen.be"


def _curve_row(diameter: float, pct: float) -> str:
    return (
        "<meetreekswaarde>"
        f"<meetwaarde_numeriek>{pct}</meetwaarde_numeriek>"
        f"<meetpunt_numeriek>{diameter}</meetpunt_numeriek>"
        "</meetreekswaarde>"
    )


def _make_xml(n_points: int) -> bytes:
    """Build a synthetic grain-size XML with n_points strictly-ascending rows.

    Diameters are spaced log2-step so the strictly-ascending domain
    constraint holds for any n_points up to thousands, and percentages
    decrease monotonically from 100 toward 0 mirroring real curves.
    """
    rows = "".join(
        _curve_row(
            diameter=0.001 * (2.0 ** (i * 0.1)),
            pct=max(0.0, 100.0 - (100.0 / max(n_points - 1, 1)) * i),
        )
        for i in range(n_points)
    )
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<ns4:dov-schema xmlns:ns4="{_NS}">
  <observatie>
    <identificator>
      <identificator>bench-{n_points}</identificator>
      <toegekend_door>DOV</toegekend_door>
    </identificator>
    <geobserveerd_object>
      <objecttype>monster</objecttype><naam>19</naam>
      <permkey>bench-monster</permkey>
    </geobserveerd_object>
    <diepte_van>0.000</diepte_van>
    <diepte_tot>1.000</diepte_tot>
    <parameter>Korrelverdeling d.m.v. zeefproef</parameter>
    <parametergroep>Onderkenningsproeven-korrelverdeling </parametergroep>
    <waarde_meetreeks>
      <meetpuntparameter>Diameter</meetpuntparameter>
      <meetpuntparameter_eenheid>mm</meetpuntparameter_eenheid>
      <meetwaardeparameter>Fractie met grotere diameter</meetwaardeparameter>
      <meetwaardeparameter_eenheid>%</meetwaardeparameter_eenheid>
      {rows}
    </waarde_meetreeks>
    <methode>Zeving</methode>
    <fenomeentijd>2025-06-13</fenomeentijd>
    <herkomst>LABO</herkomst>
    <uitvoerder>
      <organisatie><naam>BenchLab</naam></organisatie>
    </uitvoerder>
    <behandeling>
      <behandeling>Kalk verwijderd</behandeling>
      <behandeling_waarde>nee</behandeling_waarde>
    </behandeling>
    <behandeling>
      <behandeling>Organisch materiaal verwijderd</behandeling>
      <behandeling_waarde>nee</behandeling_waarde>
    </behandeling>
  </observatie>
</ns4:dov-schema>""".encode()


# Pre-build payloads once so the benchmark times only the parse.
_XML_MINIMAL = _make_xml(n_points=2)
_XML_TYPICAL = _make_xml(n_points=13)  # matches real ISO sieve series
_XML_LARGE = _make_xml(n_points=200)


# ---------------------------------------------------------------------------
# Benchmarks
# ---------------------------------------------------------------------------


def test_bench_parse_minimal(benchmark: pytest.fixture) -> None:
    """Floor cost — fixed XML overhead + 2 curve points."""
    parser = DovGrainSizeParser()
    sample = uuid4()
    result = benchmark(parser.parse, _XML_MINIMAL, sample_id=sample)
    assert len(result.grain_size.diameters_mm) == 2


def test_bench_parse_typical(benchmark: pytest.fixture) -> None:
    """Typical sieve-test curve — 13 ISO sieve apertures."""
    parser = DovGrainSizeParser()
    sample = uuid4()
    result = benchmark(parser.parse, _XML_TYPICAL, sample_id=sample)
    assert len(result.grain_size.diameters_mm) == 13


def test_bench_parse_large(benchmark: pytest.fixture) -> None:
    """Stress case — 200-point laser-diffraction curve.

    Protects against accidental quadratic behaviour at scale; bbox imports
    yielding hundreds of laser-diffraction observations would be the
    extreme case.
    """
    parser = DovGrainSizeParser()
    sample = uuid4()
    result = benchmark(parser.parse, _XML_LARGE, sample_id=sample)
    assert len(result.grain_size.diameters_mm) == 200

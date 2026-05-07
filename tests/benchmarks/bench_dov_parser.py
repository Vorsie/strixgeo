"""DOV parser benchmarks — run with: uv run pytest tests/benchmarks/ --benchmark-enable -v

Measures DovParser.parse() throughput at varying row counts. Network and download
latency are intentionally NOT included — those are dominated by DOV server response
time and would not be a useful benchmark of our code.
"""

from __future__ import annotations

import pytest

from groundmodel.infrastructure.parsers.cpt.dov.dov_parser import DovParser

_NS = "http://kern.schemas.dov.vlaanderen.be"
_GML = "http://www.opengis.net/gml/3.2"


def _build_xml(n_rows: int) -> bytes:
    """Build a synthetic DOV XML with n_rows <meetdata> elements (CPTU shape)."""
    rows = "".join(
        f"<meetdata>"
        f"<lengte>{i * 0.02:.2f}</lengte>"
        f"<diepte>{i * 0.02:.2f}</diepte>"
        f"<qc>{1.0 + (i % 50) * 0.1:.3f}</qc>"
        f"<fs>{20 + (i % 30)}</fs>"
        f"<u>{5 + (i % 10)}</u>"
        f"<i>0.0</i>"
        f"</meetdata>"
        for i in range(1, n_rows + 1)
    )
    return f"""<?xml version="1.0"?>
<ns4:dov-schema xmlns:ns4="{_NS}" xmlns:gml="{_GML}">
  <sondering>
    <sondeernummer>BENCH-{n_rows}</sondeernummer>
    <datum_aanvang>2026-01-01</datum_aanvang>
    <uitvoerder><naam>Bench Co.</naam></uitvoerder>
    <ligging>
      <gml:Point srsName="urn:ogc:def:crs:EPSG::6190" srsDimension="3">
        <gml:pos>200000.0 200000.0 5.0</gml:pos>
      </gml:Point>
    </ligging>
    <sondeonderzoek>
      <sondeerapparaat>
        <sondeerconus>
          <conustype>U</conustype>
          <net_area_ratio>0.75</net_area_ratio>
        </sondeerconus>
      </sondeerapparaat>
      <penetratietest>{rows}</penetratietest>
    </sondeonderzoek>
  </sondering>
</ns4:dov-schema>""".encode()


@pytest.mark.parametrize("n_rows", [100, 1_000, 10_000])
def test_dov_parse_scaling(benchmark, n_rows: int):
    """Scaling profile: parse a synthetic DOV CPT with n_rows measurement rows."""
    xml = _build_xml(n_rows)
    parser = DovParser()
    result = benchmark(parser.parse, xml, f"BENCH-{n_rows}")
    assert len(result.data) == n_rows

"""DovBoringParser performance benchmarks.

Run with::

    uv run pytest tests/benchmarks/bench_dov_boring_parser.py --benchmark-enable -v

Synthetic XML payloads are pre-built once at module import so construction
cost is excluded from timing — we measure XML→BoreholeParseResult only.

Sizes are chosen to bracket realistic DOV boreholes (5–20 drill segments,
3–10 field-log rows per kind in typical geotechnical borings) and stress
the parser at scale (a 100-segment "deep stratigraphic" borehole).

Reference numbers go in CLAUDE.local.md "Performance baseline" once
production data flows through.
"""

from __future__ import annotations

import pytest

from groundmodel.infrastructure.parsers.borehole.dov.dov_boring_parser import (
    DovBoringParser,
)

_NS = "http://kern.schemas.dov.vlaanderen.be"
_GML = "http://www.opengis.net/gml/3.2"


def _drill_segment(top: float, base: float, method: str) -> str:
    return (
        f"<boormethode><van>{top:.2f}</van><tot>{base:.2f}</tot>"
        f"<methode>{method}</methode></boormethode>"
    )


def _field_log_row(tag: str, top: float, base: float, value: str) -> str:
    return f"<{tag}><van>{top:.2f}</van><tot>{base:.2f}</tot><{tag}>{value}</{tag}></{tag}>"


def _make_xml(n_segments: int, n_field_log_per_kind: int) -> bytes:
    """Build a synthetic DOV boring XML with the requested row counts.

    Parameters
    ----------
    n_segments : int
        Number of <boormethode> drill segments. Each spans 0.5 m, so a
        100-segment borehole is 50 m deep.
    n_field_log_per_kind : int
        Number of intervals per field-log kind (color, moisture, consistency).
        Total field-log rows = 3 × n_field_log_per_kind.
    """
    methods = ["spade", "edelmanboring", "avegaarboring", "pulsboring", "kerboor"]
    segments_xml = "".join(
        _drill_segment(i * 0.5, (i + 1) * 0.5, methods[i % len(methods)]) for i in range(n_segments)
    )

    colors = ["groenbruin", "bruingroen", "groengrijs", "grijsgroen"]
    moistures = ["weinig vochtig", "vochtig", "verzadigd"]
    consistencies = ["zacht", "plastisch", "vast", "stijf"]

    color_xml = "".join(
        _field_log_row("kleur", i * 1.0, (i + 1) * 1.0, colors[i % len(colors)])
        for i in range(n_field_log_per_kind)
    )
    moisture_xml = "".join(
        _field_log_row("vochtgehalte", i * 1.5, (i + 1) * 1.5, moistures[i % len(moistures)])
        for i in range(n_field_log_per_kind)
    )
    consistency_xml = "".join(
        _field_log_row(
            "consistentie",
            i * 1.0,
            (i + 1) * 1.0,
            consistencies[i % len(consistencies)],
        )
        for i in range(n_field_log_per_kind)
    )

    total_depth = max(n_segments * 0.5, n_field_log_per_kind * 1.5, 1.0)

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<ns4:dov-schema xmlns:ns4="{_NS}" xmlns:gml="{_GML}">
  <boring>
    <identificatie>BENCH-BH</identificatie>
    <dataidentifier>
      <permkey>bench-{n_segments}-{n_field_log_per_kind}</permkey>
      <uri>https://www.dov.vlaanderen.be/data/boring/bench</uri>
    </dataidentifier>
    <ligging>
      <gml:Point srsName="urn:ogc:def:crs:EPSG::6190" srsDimension="3">
        <gml:pos>200000.00 200000.00 5.00</gml:pos>
      </gml:Point>
    </ligging>
    <gemeente>44088</gemeente>
    <diepte_tot>{total_depth:.2f}</diepte_tot>
    <datum_aanvang>2025-06-13</datum_aanvang>
    <doel>Geotechnisch onderzoek</doel>
    <boringtype>Geotechnische boring - (dis)continue monstername</boringtype>
    <uitvoerder><naam>BenchmarkLab</naam></uitvoerder>
    <details>
      {segments_xml}
      {color_xml}
      {moisture_xml}
      {consistency_xml}
      <grondwaterstand><diepte_grondwater>4.30</diepte_grondwater></grondwaterstand>
    </details>
  </boring>
</ns4:dov-schema>""".encode()


# Pre-build representative payloads once. ``minimal`` is a single-segment
# borehole with one field-log row per kind (smallest valid input). ``typical``
# matches the example DOV borehole we probed (~7 segments, ~4 rows per kind).
# ``large`` stresses the parser with a 100-segment, 50-row-per-kind borehole.
_XML_MINIMAL = _make_xml(n_segments=1, n_field_log_per_kind=1)
_XML_TYPICAL = _make_xml(n_segments=7, n_field_log_per_kind=4)
_XML_LARGE = _make_xml(n_segments=100, n_field_log_per_kind=50)


# ---------------------------------------------------------------------------
# Benchmarks
# ---------------------------------------------------------------------------


def test_bench_parse_minimal(benchmark: pytest.fixture) -> None:
    """Floor cost — fixed XML overhead + one drill segment + 3 field-log rows."""
    parser = DovBoringParser()
    result = benchmark(parser.parse, _XML_MINIMAL)
    assert result.has_errors is False
    assert len(result.drill_segments) == 1


def test_bench_parse_typical(benchmark: pytest.fixture) -> None:
    """Typical Belgian geotechnical borehole shape."""
    parser = DovBoringParser()
    result = benchmark(parser.parse, _XML_TYPICAL)
    assert result.has_errors is False
    assert len(result.drill_segments) == 7
    assert len(result.field_log) == 12  # 3 kinds × 4 rows


def test_bench_parse_large(benchmark: pytest.fixture) -> None:
    """Stress case — deep stratigraphic borehole.

    100 drill segments + 150 field-log rows. A bbox import yielding hundreds
    of large boreholes would be the extreme case; this benchmark protects
    against accidental quadratic behaviour at scale.
    """
    parser = DovBoringParser()
    result = benchmark(parser.parse, _XML_LARGE)
    assert result.has_errors is False
    assert len(result.drill_segments) == 100
    assert len(result.field_log) == 150

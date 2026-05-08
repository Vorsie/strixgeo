"""DovInterpretationParser performance benchmarks.

Run with::

    uv run pytest tests/benchmarks/bench_dov_interpretation_parser.py --benchmark-enable -v

Pre-built synthetic XML payloads sized to bracket realistic DOV
interpretations:

* minimal — 1 layer (smallest valid input).
* typical — 12 layers (matches real DOV examples we probed; ~10–15 is
  the median for geotechnical lithology streams).
* large — 200 layers (deep stratigraphic boreholes can run this long).

Reference numbers will land in CLAUDE.local.md after the full ingest
pipeline is in place.
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from groundmodel.domain.value_objects.observation_type import ObservationType
from groundmodel.infrastructure.parsers.borehole.dov.dov_interpretation_parser import (
    DovInterpretationParser,
)

_NS = "http://kern.schemas.dov.vlaanderen.be"


def _laag(top: float, base: float, soil_codes: list[str], admixtures: int) -> str:
    hoofd = "".join(f"<hoofdnaam><grondsoort>{c}</grondsoort></hoofdnaam>" for c in soil_codes)
    adm = "".join(
        "<bijmenging><plaatselijk>false</plaatselijk>"
        "<hoeveelheid>M</hoeveelheid><grondsoort>GL</grondsoort></bijmenging>"
        for _ in range(admixtures)
    )
    return (
        f"<laag><van>{top:.2f}</van><tot>{base:.2f}</tot><kleur>onbekend</kleur>{hoofd}{adm}</laag>"
    )


def _make_xml(n_layers: int, admixtures_per_layer: int) -> bytes:
    """Build a synthetic gecodeerde_lithologie XML with n_layers and admixtures.

    Each layer is 0.5 m thick; total depth = n_layers * 0.5.
    """
    soils = ["FZ", "KL", "GL", "LE", "XZ"]
    laagen = "".join(
        _laag(
            top=i * 0.5,
            base=(i + 1) * 0.5,
            soil_codes=[soils[i % len(soils)]],
            admixtures=admixtures_per_layer,
        )
        for i in range(n_layers)
    )
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<ns4:dov-schema xmlns:ns4="{_NS}">
  <interpretaties>
    <gecodeerdelithologie>
      <boring>BENCH-BH</boring>
      <dataidentifier><permkey>bench-{n_layers}</permkey></dataidentifier>
      <auteur>
        <persoon><naam>Benchmark</naam><voornaam>Test</voornaam></persoon>
        <bedrijf-dienst><naam>BenchLab</naam></bedrijf-dienst>
      </auteur>
      <datum>2025-06-13</datum>
      <betrouwbaarheid>goed</betrouwbaarheid>
      <dataleverancier><naam>onbekend</naam></dataleverancier>
      <kwaliteit>
        <categorie>matig</categorie>
        <geschiktheid_boormethode>Hoog</geschiktheid_boormethode>
      </kwaliteit>
      {laagen}
    </gecodeerdelithologie>
  </interpretaties>
</ns4:dov-schema>""".encode()


# Pre-build payloads once. Constructing the parser and the input XML at
# module load excludes both costs from the timed call.
_XML_MINIMAL = _make_xml(n_layers=1, admixtures_per_layer=0)
_XML_TYPICAL = _make_xml(n_layers=12, admixtures_per_layer=2)
_XML_LARGE = _make_xml(n_layers=200, admixtures_per_layer=3)


# ---------------------------------------------------------------------------
# Benchmarks
# ---------------------------------------------------------------------------


def test_bench_parse_minimal(benchmark: pytest.fixture) -> None:
    """Floor cost — fixed XML overhead + one layer with no admixtures."""
    parser = DovInterpretationParser()
    bh = uuid4()
    result = benchmark(
        parser.parse,
        _XML_MINIMAL,
        borehole_id=bh,
        observation_type=ObservationType.CODED_LITHOLOGY,
    )
    assert len(result.observation.layers) == 1


def test_bench_parse_typical(benchmark: pytest.fixture) -> None:
    """Typical Belgian geotechnical interpretation shape."""
    parser = DovInterpretationParser()
    bh = uuid4()
    result = benchmark(
        parser.parse,
        _XML_TYPICAL,
        borehole_id=bh,
        observation_type=ObservationType.CODED_LITHOLOGY,
    )
    assert len(result.observation.layers) == 12
    # 12 layers × 2 admixtures each = 24 admixtures total
    total_adm = sum(len(layer.admixtures) for layer in result.observation.layers)
    assert total_adm == 24


def test_bench_parse_large(benchmark: pytest.fixture) -> None:
    """Stress case — deep stratigraphic interpretation.

    200 layers × 3 admixtures = 600 admixtures + 200 ObservationLayers.
    Protects against accidental quadratic behaviour at scale.
    """
    parser = DovInterpretationParser()
    bh = uuid4()
    result = benchmark(
        parser.parse,
        _XML_LARGE,
        borehole_id=bh,
        observation_type=ObservationType.CODED_LITHOLOGY,
    )
    assert len(result.observation.layers) == 200
    total_adm = sum(len(layer.admixtures) for layer in result.observation.layers)
    assert total_adm == 600

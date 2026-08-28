"""Unit tests for dov_parse_worker.parse_cpt_xml.

The worker is a thin wrapper around DovParser — these tests verify that:
  - the gzip decompress + parse round-trip works end-to-end (happy path)
  - a structurally invalid XML raises ParseError (error path)
  - variant detection (CPTU vs CPTE) passes through correctly

These run in-process (no subprocess spawn) — the worker function is a
regular top-level function and can be called directly in unit tests.
"""

from __future__ import annotations

import gzip

import pytest

from groundmodel.infrastructure.parsers.cpt.dov.dov_parse_worker import parse_cpt_xml
from groundmodel.infrastructure.parsers.cpt.gef.cpt_type import CPTType
from groundmodel.shared.exceptions import ParseError

# ---------------------------------------------------------------------------
# XML fixture helpers (mirrors test_dov_parser.py)
# ---------------------------------------------------------------------------

_NS = "http://kern.schemas.dov.vlaanderen.be"
_GML = "http://www.opengis.net/gml/3.2"


def _xml(
    *,
    test_id: str = "GEO-24/001-S1",
    pos: str = "200000.00 200000.00 5.50",
    conustype: str = "E",
    rows: str = "",
) -> bytes:
    """Return minimal valid DOV XML bytes matching the real schema."""
    body_rows = rows or _row("0.20", qc="1.5", fs="30")
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<ns4:dov-schema xmlns:ns4="{_NS}" xmlns:gml="{_GML}">
  <sondering>
    <sondeernummer>{test_id}</sondeernummer>
    <datum_aanvang>2024-03-15</datum_aanvang>
    <uitvoerder><naam>Test NV</naam></uitvoerder>
    <ligging>
      <gml:Point srsName="urn:ogc:def:crs:EPSG::6190" srsDimension="3">
        <gml:pos>{pos}</gml:pos>
      </gml:Point>
    </ligging>
    <sondeonderzoek>
      <sondeerapparaat>
        <sondeerconus>
          <conustype>{conustype}</conustype>
          <net_area_ratio>0.75</net_area_ratio>
        </sondeerconus>
      </sondeerapparaat>
      <penetratietest>{body_rows}</penetratietest>
    </sondeonderzoek>
  </sondering>
</ns4:dov-schema>""".encode()


def _row(diepte: str, *, qc: str = "1.0", fs: str | None = None, u: str | None = None) -> str:
    """Build a <meetdata> row. fs and u are in kPa per DOV convention."""
    fs_el = f"<fs>{fs}</fs>" if fs is not None else ""
    u_el = f"<u>{u}</u>" if u is not None else ""
    return (
        f"<meetdata>"
        f"<lengte>{diepte}</lengte>"
        f"<diepte>{diepte}</diepte>"
        f"<qc>{qc}</qc>"
        f"{fs_el}{u_el}"
        f"</meetdata>"
    )


def _compress(xml_bytes: bytes) -> bytes:
    """Return gzip-compressed bytes at level=1 (matches the production caller)."""
    return gzip.compress(xml_bytes, compresslevel=1)


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


def test_happy_path_returns_parse_result():
    """parse_cpt_xml decompresses and parses a valid DOV XML successfully."""
    xml = _xml(test_id="GEO-24/001-S1", pos="218343.80 211622.90 51.15")
    result = parse_cpt_xml(_compress(xml), "GEO-24/001-S1")

    assert result.header.test_id == "GEO-24/001-S1"
    assert result.header.x == pytest.approx(218343.80)
    assert result.header.y == pytest.approx(211622.90)
    assert len(result.data) == 1
    assert result.has_errors is False


def test_happy_path_data_row_values():
    """Measurement values survive the gzip round-trip without distortion."""
    rows = _row("0.50", qc="3.2", fs="45")
    xml = _xml(rows=rows)
    result = parse_cpt_xml(_compress(xml), "TEST-CPT")

    row = result.data.row(0, named=True)
    assert row["depth_m"] == pytest.approx(0.50)
    assert row["qc_mpa"] == pytest.approx(3.2)
    # fs is kPa in DOV XML → MPa in parse result
    assert row["fs_mpa"] == pytest.approx(0.045)


# ---------------------------------------------------------------------------
# Real ProcessPoolExecutor round-trip — the production dispatch path
# ---------------------------------------------------------------------------


def test_real_process_pool_roundtrip_matches_inline():
    """Exercise the ACTUAL production path: submit parse_cpt_xml to a real
    ProcessPoolExecutor and assert the GEFParseResult pickles back from the
    spawned worker identical to an inline parse.

    The 740-green unit suite never reaches ``loop.run_in_executor(pool, ...)``
    (every importer test mocks fetch_bbox_processed or calls the worker
    in-process), so the pickle round-trip of GEFParseResult — Polars frame
    (→ Arrow IPC) + by-value enums + ValidationIssue list — was previously
    unverified. ``asyncio.gather(return_exceptions=True)`` swallows a
    PicklingError as a per-CPT "download failed", which would present as
    silent data loss. This pins ``spawn`` semantics on every platform —
    spawn is what production uses (``api/main.py`` passes an explicit spawn
    context: Linux's fork default deadlocks under a threaded parent, which
    is exactly how this test hung the first Linux CI run — faulthandler
    dump in Actions run 33115778146).
    """
    import multiprocessing
    from concurrent.futures import ProcessPoolExecutor

    xml = _xml(rows=_row("0.50", qc="3.2", fs="45", u="12"))
    compressed = _compress(xml)

    inline = parse_cpt_xml(compressed, "POOL-CPT")
    with ProcessPoolExecutor(
        max_workers=1, mp_context=multiprocessing.get_context("spawn")
    ) as pool:
        pooled = pool.submit(parse_cpt_xml, compressed, "POOL-CPT").result(timeout=60)

    # Salient header fields survive the spawn + pickle round-trip.
    assert pooled.header.test_id == inline.header.test_id
    assert pooled.header.x == pytest.approx(inline.header.x)
    assert pooled.header.y == pytest.approx(inline.header.y)
    assert pooled.cpt_type == inline.cpt_type
    assert pooled.has_errors == inline.has_errors
    assert len(pooled.issues) == len(inline.issues)
    # The Polars depth-series frame is byte-faithful across the process boundary.
    assert pooled.data.equals(inline.data)


# ---------------------------------------------------------------------------
# Variant detection
# ---------------------------------------------------------------------------


def test_cptu_variant_detected_via_u_column():
    """CPTU variant is detected when <u> (pore pressure) data is present."""
    rows = _row("0.20", qc="2.0", fs="30", u="10")
    xml = _xml(conustype="U", rows=rows)
    result = parse_cpt_xml(_compress(xml), "CPTU-CPT")
    assert result.cpt_type == CPTType.CPTU


def test_cpte_variant_detected_without_u_column():
    """CPTE variant is detected when only qc + fs are present (no pore pressure)."""
    rows = _row("0.20", qc="2.0", fs="30")
    xml = _xml(conustype="E", rows=rows)
    result = parse_cpt_xml(_compress(xml), "CPTE-CPT")
    assert result.cpt_type == CPTType.CPTE


# ---------------------------------------------------------------------------
# Error paths
# ---------------------------------------------------------------------------


def test_empty_bytes_raises_parse_error():
    """Passing empty gzip payload (valid gzip wrapping empty bytes) raises ParseError."""
    empty_compressed = gzip.compress(b"", compresslevel=1)
    with pytest.raises(ParseError):
        parse_cpt_xml(empty_compressed, "EMPTY")


def test_not_xml_raises_error():
    """Passing non-XML content (gzip-compressed) raises an error."""
    garbage = gzip.compress(b"this is not xml at all", compresslevel=1)
    with pytest.raises(Exception):  # noqa: B017 — ParseError or xml.etree.ElementTree.ParseError
        parse_cpt_xml(garbage, "GARBAGE")


def test_missing_root_element_raises_parse_error():
    """XML with wrong root element raises ParseError (no sondering found)."""
    bad_xml = b"""<?xml version="1.0"?><wrong><element/></wrong>"""
    with pytest.raises(ParseError):
        parse_cpt_xml(_compress(bad_xml), "BAD-STRUCTURE")

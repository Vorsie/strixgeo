"""Unit tests for DovParser — DOV XML → GEFParseResult."""

import pytest

from groundmodel.infrastructure.parsers.cpt.dov.dov_parser import DovParser
from groundmodel.infrastructure.parsers.cpt.gef.cpt_type import CPTType
from groundmodel.shared.exceptions import ParseError

_NS = "http://www.dov.vlaanderen.be/schema/dov/1.0.0"


def _xml(
    *,
    probe_id: str = "GEO-24/001-S1",
    x: str = "200000.0",
    y: str = "200000.0",
    z: str = "5.5",
    rows: str = "",
    company: str = "Test NV",
) -> bytes:
    """Build a minimal DOV sondering XML for testing."""
    row_block = rows or _row("0.20", qc="1.5", fs="0.030", u="0.010", rf="2.0")
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<dov xmlns="{_NS}">
  <sondering>
    <identificatie>
      <proefnummer>{probe_id}</proefnummer>
      <datum_aanvang>2024-03-15</datum_aanvang>
      <uitvoerder>{company}</uitvoerder>
    </identificatie>
    <ligging>
      <xy>
        <x>{x}</x>
        <y>{y}</y>
      </xy>
      <oorspronkelijk_maaiveld>
        <waarde>{z}</waarde>
      </oorspronkelijk_maaiveld>
    </ligging>
    <sondering>
      <data>
        {row_block}
      </data>
    </sondering>
  </sondering>
</dov>""".encode()


def _row(
    tot: str,
    qc: str = "1.0",
    fs: str | None = None,
    u: str | None = None,
    rf: str | None = None,
) -> str:
    fs_el = f"<fs>{fs}</fs>" if fs is not None else ""
    u_el = f"<u>{u}</u>" if u is not None else ""
    rf_el = f"<friction_ratio>{rf}</friction_ratio>" if rf is not None else ""
    return f"<laag><tot>{tot}</tot><qc>{qc}</qc>{fs_el}{u_el}{rf_el}</laag>"


# ------------------------------------------------------------------
# Header parsing
# ------------------------------------------------------------------


def test_header_coordinates():
    result = DovParser().parse(_xml(x="199643.0", y="210216.0", z="20.5"))
    assert result.header.x == pytest.approx(199643.0)
    assert result.header.y == pytest.approx(210216.0)
    assert result.header.z == pytest.approx(20.5)
    assert result.header.epsg == 31370
    assert result.header.z_epsg == 5710


def test_header_identification():
    result = DovParser().parse(_xml(probe_id="GEO-24/001-S1", company="DOV Test"))
    assert result.header.test_id == "GEO-24/001-S1"
    assert result.header.project_id == "DOV"
    assert result.header.company == "DOV Test"


# ------------------------------------------------------------------
# CPT type detection
# ------------------------------------------------------------------


def test_type_cptu_when_u_present():
    xml = _xml(rows=_row("1.0", qc="2.0", fs="0.05", u="0.01"))
    assert DovParser().parse(xml).cpt_type == CPTType.CPTU


def test_type_cpte_when_fs_but_no_u():
    xml = _xml(rows=_row("1.0", qc="2.0", fs="0.05"))
    assert DovParser().parse(xml).cpt_type == CPTType.CPTE


def test_type_cptm_when_only_qc():
    xml = _xml(rows=_row("1.0", qc="2.0"))
    assert DovParser().parse(xml).cpt_type == CPTType.CPTM


# ------------------------------------------------------------------
# Data parsing
# ------------------------------------------------------------------


def test_data_rows():
    rows = _row("0.20", qc="1.5", fs="0.030", u="0.010", rf="2.0") + _row(
        "0.40", qc="2.0", fs="0.040", u="0.012", rf="2.0"
    )
    result = DovParser().parse(_xml(rows=rows))
    df = result.data
    assert len(df) == 2
    assert df["depth_m"].to_list() == pytest.approx([0.20, 0.40])
    assert df["qc_mpa"].to_list() == pytest.approx([1.5, 2.0])
    assert df["fs_mpa"].to_list() == pytest.approx([0.030, 0.040])
    assert df["u2_mpa"].to_list() == pytest.approx([0.010, 0.012])


def test_optional_columns_dropped_when_all_null():
    xml = _xml(rows=_row("0.20", qc="1.5"))
    result = DovParser().parse(xml)
    assert "fs_mpa" not in result.data.columns
    assert "u2_mpa" not in result.data.columns
    assert "rf_pct" not in result.data.columns


# ------------------------------------------------------------------
# Error handling
# ------------------------------------------------------------------


def test_parse_error_on_invalid_xml():
    with pytest.raises(ParseError, match="DOV XML parse error"):
        DovParser().parse(b"<not valid xml<<")


def test_missing_sondering_element():
    xml = b'<?xml version="1.0"?><dov xmlns="http://www.dov.vlaanderen.be/schema/dov/1.0.0"></dov>'
    with pytest.raises(ParseError, match="missing <sondering>"):
        DovParser().parse(xml, name="test")

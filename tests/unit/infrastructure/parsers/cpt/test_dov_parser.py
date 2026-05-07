"""Unit tests for DovParser — DOV XML → GEFParseResult.

Fixtures mirror the real DOV schema (verified against live data 2026-05-07):
  Namespace: http://kern.schemas.dov.vlaanderen.be
  GML:       http://www.opengis.net/gml/3.2

Units in DOV XML:
  qc, Qt: MPa
  fs, u:  kPa  (DovParser converts to MPa)
"""

import pytest

from groundmodel.infrastructure.parsers.cpt.dov.dov_parser import DovParser
from groundmodel.infrastructure.parsers.cpt.gef.cpt_type import CPTType
from groundmodel.shared.exceptions import ParseError

_NS = "http://kern.schemas.dov.vlaanderen.be"
_GML = "http://www.opengis.net/gml/3.2"


def _xml(
    *,
    test_id: str = "GEO-24/001-S1",
    company: str = "Test NV",
    pos: str = "200000.00 200000.00 5.50",
    conustype: str = "E",
    net_area_ratio: str = "0.75",
    rows: str = "",
    extra_inside_sondering: str = "",
) -> bytes:
    """Build a DOV sondering XML matching the real schema.

    Parameters
    ----------
    pos : str
        Space-separated "X Y Z" for the gml:pos element.
    conustype : str
        Cone type code: 'E' / 'U' / 'EU' = electric, 'M1'/'M2'/... = mechanical.
    rows : str
        XML for the <meetdata> rows. Use _row() to build them.
    """
    body_rows = rows or _row("0.20", qc="1.5", fs="30", u="10")
    # Match real DOV: only the root has the DOV namespace (via ns4 prefix);
    # all child elements are unprefixed (no namespace). GML elements use the gml prefix.
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<ns4:dov-schema xmlns:ns4="{_NS}" xmlns:gml="{_GML}">
  <sondering>
    <sondeernummer>{test_id}</sondeernummer>
    <datum_aanvang>2024-03-15</datum_aanvang>
    <uitvoerder>
      <naam>{company}</naam>
    </uitvoerder>
    <ligging>
      <gml:Point srsName="urn:ogc:def:crs:EPSG::6190" srsDimension="3">
        <gml:pos>{pos}</gml:pos>
      </gml:Point>
    </ligging>
    {extra_inside_sondering}
    <sondeonderzoek>
      <sondeerapparaat>
        <sondeerconus>
          <conustype>{conustype}</conustype>
          <net_area_ratio>{net_area_ratio}</net_area_ratio>
        </sondeerconus>
      </sondeerapparaat>
      <penetratietest>
        {body_rows}
      </penetratietest>
    </sondeonderzoek>
  </sondering>
</ns4:dov-schema>""".encode()


def _row(
    diepte: str,
    *,
    qc: str = "1.0",
    fs: str | None = None,
    u: str | None = None,
    qt: str | None = None,
    lengte: str | None = None,
) -> str:
    """Build a <meetdata> row. fs and u are in kPa per DOV convention."""
    lengte = lengte or diepte
    fs_el = f"<fs>{fs}</fs>" if fs is not None else ""
    u_el = f"<u>{u}</u>" if u is not None else ""
    qt_el = f"<Qt>{qt}</Qt>" if qt is not None else ""
    return (
        f"<meetdata>"
        f"<lengte>{lengte}</lengte>"
        f"<diepte>{diepte}</diepte>"
        f"<qc>{qc}</qc>"
        f"{fs_el}{u_el}{qt_el}"
        f"</meetdata>"
    )


# ------------------------------------------------------------------
# Header parsing
# ------------------------------------------------------------------


def test_header_coordinates_parsed_from_gml_pos():
    result = DovParser().parse(_xml(pos="218343.80 211622.90 51.15"))
    assert result.header.x == pytest.approx(218343.80)
    assert result.header.y == pytest.approx(211622.90)
    assert result.header.z == pytest.approx(51.15)
    assert result.header.epsg == 31370
    assert result.header.z_epsg == 5710


def test_header_coordinates_without_z():
    result = DovParser().parse(_xml(pos="200000.0 200000.0"))
    assert result.header.x == pytest.approx(200000.0)
    assert result.header.y == pytest.approx(200000.0)
    assert result.header.z is None


def test_header_identification():
    result = DovParser().parse(_xml(test_id="GEO-24/001-S1", company="DOV Test"))
    assert result.header.test_id == "GEO-24/001-S1"
    assert result.header.project_id == "DOV"
    assert result.header.company == "DOV Test"


def test_header_net_area_ratio():
    result = DovParser().parse(_xml(net_area_ratio="0.80"))
    assert result.header.net_area_ratio == pytest.approx(0.80)


def test_header_cone_type_mechanical():
    result = DovParser().parse(_xml(conustype="M1"))
    assert result.header.cone_type_code == 1


def test_header_cone_type_electric():
    result = DovParser().parse(_xml(conustype="E"))
    assert result.header.cone_type_code == 0


def test_header_cone_type_piezo():
    result = DovParser().parse(_xml(conustype="U"))
    assert result.header.cone_type_code == 0


# ------------------------------------------------------------------
# CPT type detection
# ------------------------------------------------------------------


def test_type_cptu_when_u_present():
    xml = _xml(conustype="U", rows=_row("1.0", qc="2.0", fs="30", u="10"))
    assert DovParser().parse(xml).cpt_type == CPTType.CPTU


def test_type_cpte_when_fs_but_no_u():
    xml = _xml(conustype="E", rows=_row("1.0", qc="2.0", fs="30"))
    assert DovParser().parse(xml).cpt_type == CPTType.CPTE


def test_type_cptm_when_only_qc_and_qt():
    xml = _xml(conustype="M1", rows=_row("1.0", qc="2.0", qt="3.5"))
    assert DovParser().parse(xml).cpt_type == CPTType.CPTM


def test_mechanical_cone_type_overrides_stray_columns():
    # If the cone is M1 (mechanical), classify as CPTM even if fs sneaks through.
    xml = _xml(conustype="M1", rows=_row("1.0", qc="2.0", fs="30"))
    assert DovParser().parse(xml).cpt_type == CPTType.CPTM


# ------------------------------------------------------------------
# Data parsing & unit conversion
# ------------------------------------------------------------------


def test_fs_and_u_converted_from_kpa_to_mpa():
    # DOV stores fs and u in kPa as integers; parser must divide by 1000.
    rows = _row("0.20", qc="1.500", fs="30", u="10")
    result = DovParser().parse(_xml(rows=rows))
    assert result.data["fs_mpa"].to_list() == pytest.approx([0.030])
    assert result.data["u2_mpa"].to_list() == pytest.approx([0.010])


def test_qc_kept_in_mpa():
    result = DovParser().parse(_xml(rows=_row("0.20", qc="1.500")))
    assert result.data["qc_mpa"].to_list() == pytest.approx([1.500])


def test_qt_kept_in_mpa():
    result = DovParser().parse(_xml(conustype="M1", rows=_row("0.20", qc="5.66", qt="9.36")))
    assert result.data["qt_mpa"].to_list() == pytest.approx([9.36])


def test_diepte_preferred_over_lengte():
    rows = "<meetdata><lengte>1.10</lengte><diepte>1.05</diepte><qc>2.0</qc></meetdata>"
    result = DovParser().parse(_xml(rows=rows))
    assert result.data["depth_m"].to_list() == pytest.approx([1.05])


def test_lengte_used_when_diepte_missing():
    # Mechanical cones often only emit <lengte>, not <diepte>.
    rows = "<meetdata><lengte>0.20</lengte><qc>5.66</qc><Qt>9.36</Qt></meetdata>"
    result = DovParser().parse(_xml(conustype="M1", rows=rows))
    assert result.data["depth_m"].to_list() == pytest.approx([0.20])


def test_rf_calculated_from_qc_and_fs():
    # qc=2.0 MPa, fs=20 kPa = 0.020 MPa → Rf = (0.020 / 2.0) * 100 = 1.0 %
    rows = _row("1.0", qc="2.0", fs="20")
    result = DovParser().parse(_xml(rows=rows))
    assert "rf_pct" in result.data.columns
    assert result.data["rf_pct"].to_list() == pytest.approx([1.0])


def test_optional_columns_dropped_when_all_null():
    xml = _xml(conustype="M1", rows=_row("0.20", qc="5.66", qt="9.36"))
    df = DovParser().parse(xml).data
    assert "fs_mpa" not in df.columns
    assert "u2_mpa" not in df.columns
    assert "rf_pct" not in df.columns
    assert "qt_mpa" in df.columns


def test_multiple_rows_preserved_in_order():
    rows = (
        _row("0.20", qc="1.5", fs="30", u="10")
        + _row("0.40", qc="2.0", fs="40", u="12")
        + _row("0.60", qc="2.5", fs="50", u="14")
    )
    result = DovParser().parse(_xml(rows=rows))
    df = result.data
    assert len(df) == 3
    assert df["depth_m"].to_list() == pytest.approx([0.20, 0.40, 0.60])
    assert df["qc_mpa"].to_list() == pytest.approx([1.5, 2.0, 2.5])


# ------------------------------------------------------------------
# Error handling
# ------------------------------------------------------------------


def test_parse_error_on_invalid_xml():
    with pytest.raises(ParseError, match="DOV XML parse error"):
        DovParser().parse(b"<not valid xml<<")


def test_missing_sondering_element():
    xml = (f'<?xml version="1.0"?><ns4:dov-schema xmlns:ns4="{_NS}"></ns4:dov-schema>').encode()
    with pytest.raises(ParseError, match="missing <sondering>"):
        DovParser().parse(xml, name="test")


def test_missing_sondeonderzoek_records_error_issue():
    xml = f"""<?xml version="1.0"?>
<ns4:dov-schema xmlns:ns4="{_NS}" xmlns:gml="{_GML}">
  <sondering>
    <sondeernummer>X</sondeernummer>
    <ligging>
      <gml:Point><gml:pos>200000 200000 5</gml:pos></gml:Point>
    </ligging>
  </sondering>
</ns4:dov-schema>""".encode()
    result = DovParser().parse(xml, name="X")
    assert any(i.code == "NO_DATA" for i in result.issues)
    assert len(result.data) == 0


# ------------------------------------------------------------------
# Resilience — corrupted, empty, and unexpected payloads
# ------------------------------------------------------------------


def test_empty_body_raises_parse_error():
    with pytest.raises(ParseError, match="DOV XML parse error"):
        DovParser().parse(b"", name="empty")


def test_truncated_xml_raises_parse_error():
    truncated = (
        f'<?xml version="1.0"?><ns4:dov-schema xmlns:ns4="{_NS}"><sondering><sondeer'
    ).encode()
    with pytest.raises(ParseError, match="DOV XML parse error"):
        DovParser().parse(truncated, name="truncated")


def test_html_error_page_raises_parse_error():
    # If DOV returns an HTML error page (e.g. maintenance), it must fail cleanly.
    html = b"<!DOCTYPE html><html><body>503 Service Unavailable</body></html>"
    with pytest.raises(ParseError):
        DovParser().parse(html, name="html-error")


def test_non_numeric_qc_row_skipped_not_crashed():
    rows = (
        "<meetdata><lengte>0.20</lengte><diepte>0.20</diepte><qc>NOTANUMBER</qc></meetdata>"
        + _row("0.40", qc="2.0", fs="30")
    )
    result = DovParser().parse(_xml(rows=rows))
    assert len(result.data) == 1
    assert result.data["depth_m"].to_list() == pytest.approx([0.40])

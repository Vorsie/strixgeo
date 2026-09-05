"""Unit tests for DovBoringParser — DOV boring XML → BoreholeParseResult.

Fixtures mirror the real DOV schema (verified against live data 2026-05-08,
example permkey 2025-232644):
* DOV namespace on root only (children are unprefixed)
* GML elements inside <ligging> are namespaced
* Field-log wrappers contain a same-named child for the value
  (e.g. <kleur><kleur>groenbruin</kleur></kleur>)
* gml:Point's srsName advertises EPSG:6190 but values are Lambert 72 (31370).
"""

from __future__ import annotations

from datetime import date

import pytest

from groundmodel.domain.value_objects.field_log_kind import FieldLogKind
from groundmodel.infrastructure.parsers.borehole.dov.dov_boring_parser import (
    DovBoringParser,
)
from groundmodel.infrastructure.parsers.cpt.validation.validation_level import ValidationLevel
from groundmodel.shared.exceptions import ParseError

_NS = "http://kern.schemas.dov.vlaanderen.be"
_GML = "http://www.opengis.net/gml/3.2"


def _xml(
    *,
    name: str = "GEO-25/001-B1",
    permkey: str = "2025-200001",
    pos: str = "200000.00 200000.00 5.00",
    municipality: str = "44088",
    diepte_tot: str = "8.50",
    datum_aanvang: str = "2025-06-13",
    doel: str = "Geotechnisch onderzoek",
    boringtype: str = "Geotechnische boring - (dis)continue monstername",
    executor: str = "Geolab",
    drill_segments: str = "",
    field_log: str = "",
    grondwater: str = "",
    extra_inside_boring: str = "",
    omit_ligging: bool = False,
    omit_details: bool = False,
) -> bytes:
    """Build a DOV boring XML matching the real schema for testing.

    Parameters
    ----------
    pos : str
        Space-separated "X Y Z" for the gml:pos element.
    drill_segments, field_log, grondwater : str
        Inner XML strings for the <details> children. Use the helpers
        ``_drill_segment`` / ``_field_log_row`` to build them.
    extra_inside_boring : str
        Free-form XML inserted as additional <boring> children for tests
        of resilience to unknown / extra elements.
    omit_ligging, omit_details : bool
        Skip the <ligging> or <details> wrapper to test parser resilience.
    """
    ligging = (
        ""
        if omit_ligging
        else f"""
            <ligging>
              <gml:Point srsName="urn:ogc:def:crs:EPSG::6190" srsDimension="3">
                <gml:pos>{pos}</gml:pos>
              </gml:Point>
            </ligging>
        """
    )
    details = (
        ""
        if omit_details
        else f"""
            <details>
              {drill_segments}
              {field_log}
              {grondwater}
            </details>
        """
    )

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<ns4:dov-schema xmlns:ns4="{_NS}" xmlns:gml="{_GML}">
  <boring>
    <identificatie>{name}</identificatie>
    <dataidentifier>
      <permkey>{permkey}</permkey>
      <uri>https://www.dov.vlaanderen.be/data/boring/{permkey}</uri>
    </dataidentifier>
    {ligging}
    <gemeente>{municipality}</gemeente>
    <diepte_tot>{diepte_tot}</diepte_tot>
    <datum_aanvang>{datum_aanvang}</datum_aanvang>
    <doel>{doel}</doel>
    <boringtype>{boringtype}</boringtype>
    <uitvoerder><naam>{executor}</naam></uitvoerder>
    {extra_inside_boring}
    {details}
  </boring>
</ns4:dov-schema>""".encode()


def _drill_segment(van: str, tot: str, methode: str) -> str:
    """Build one <boormethode> XML fragment."""
    return (
        f"<boormethode><van>{van}</van><tot>{tot}</tot><methode>{methode}</methode></boormethode>"
    )


def _field_log_row(tag: str, van: str, tot: str, value: str) -> str:
    """Build one field-log wrapper. The value child shares the wrapper tag.

    DOV's schema quirk: ``<kleur><kleur>groenbruin</kleur></kleur>`` — the
    inner element holding the value has the same name as the outer wrapper.
    """
    return f"<{tag}><van>{van}</van><tot>{tot}</tot><{tag}>{value}</{tag}></{tag}>"


def _grondwaterstand(diepte_grondwater: str = "4.30") -> str:
    return (
        f"<grondwaterstand><diepte_grondwater>{diepte_grondwater}</diepte_grondwater>"
        "</grondwaterstand>"
    )


# ---------------------------------------------------------------------------
# Header parsing
# ---------------------------------------------------------------------------


class TestHeaderParsing:
    def test_full_header(self) -> None:
        result = DovBoringParser().parse(_xml())
        bh = result.borehole
        assert bh.name == "GEO-25/001-B1"
        assert bh.location_x == pytest.approx(200000.0)
        assert bh.location_y == pytest.approx(200000.0)
        assert bh.elevation_m == pytest.approx(5.0)
        assert bh.epsg == 31370
        assert bh.z_epsg == 5710
        assert bh.total_depth_m == pytest.approx(8.50)
        assert bh.start_date == date(2025, 6, 13)
        assert bh.purpose == "Geotechnisch onderzoek"
        assert bh.borehole_type == "Geotechnische boring - (dis)continue monstername"
        assert bh.municipality == "44088"
        assert bh.executor == "Geolab"

    def test_no_issues_on_clean_xml(self) -> None:
        result = DovBoringParser().parse(_xml())
        assert result.has_errors is False
        assert len(result.issues) == 0

    def test_missing_total_depth_emits_warning(self) -> None:
        result = DovBoringParser().parse(_xml(diepte_tot=""))
        assert any(i.code == "NO_TOTAL_DEPTH" for i in result.issues)
        assert all(i.level != ValidationLevel.ERROR for i in result.issues)

    def test_missing_optional_fields_no_issue(self) -> None:
        # Empty-string optional fields produce None on the entity, no issues.
        result = DovBoringParser().parse(_xml(municipality="", doel="", boringtype="", executor=""))
        assert result.borehole.municipality is None
        assert result.borehole.purpose is None
        assert result.borehole.borehole_type is None
        assert result.borehole.executor is None
        assert result.has_errors is False


# ---------------------------------------------------------------------------
# Coordinates / location
# ---------------------------------------------------------------------------


class TestCoordinates:
    def test_xy_extracted_from_gml_pos(self) -> None:
        result = DovBoringParser().parse(_xml(pos="107804.72 188493.50 7.84"))
        assert result.borehole.location_x == pytest.approx(107804.72)
        assert result.borehole.location_y == pytest.approx(188493.50)
        assert result.borehole.elevation_m == pytest.approx(7.84)

    def test_xy_only_z_missing_emits_no_elevation_warning(self) -> None:
        # gml:pos can be 2D when Z isn't recorded. XY parse fine, but Z
        # (surface elevation) is essential for cross-borehole layer
        # correlation, so its absence must be flagged at WARNING level —
        # the orchestrator can still fill Z from the WFS Boringen row's
        # Z_mTAW field, but the gap must be visible in the import report.
        result = DovBoringParser().parse(_xml(pos="200000.0 200000.0"))
        assert result.borehole.location_x == pytest.approx(200000.0)
        assert result.borehole.location_y == pytest.approx(200000.0)
        assert result.borehole.elevation_m is None
        # Not an ERROR — XY were valid, the row is recoverable. But a
        # NO_ELEVATION WARNING must be present.
        assert result.has_errors is False
        no_elev = [i for i in result.issues if i.code == "NO_ELEVATION"]
        assert len(no_elev) == 1
        assert no_elev[0].level == ValidationLevel.WARNING

    def test_non_numeric_z_emits_no_elevation_warning(self) -> None:
        # gml:pos has three components but the third isn't a float — Z is
        # effectively absent. Same NO_ELEVATION WARNING as the missing-Z case.
        result = DovBoringParser().parse(_xml(pos="200000.0 200000.0 NaN-marker"))
        assert result.borehole.elevation_m is None
        assert result.has_errors is False
        no_elev = [i for i in result.issues if i.code == "NO_ELEVATION"]
        assert len(no_elev) == 1
        assert no_elev[0].level == ValidationLevel.WARNING

    def test_full_xyz_emits_no_elevation_warning_only_when_z_missing(self) -> None:
        # Sanity: the default fixture has X Y Z — no NO_ELEVATION expected.
        result = DovBoringParser().parse(_xml())  # default pos has Z
        assert result.borehole.elevation_m == pytest.approx(5.0)
        assert all(i.code != "NO_ELEVATION" for i in result.issues)

    def test_no_ligging_emits_no_coordinates_error(self) -> None:
        result = DovBoringParser().parse(_xml(omit_ligging=True))
        assert result.has_errors is True
        codes = {i.code for i in result.issues}
        assert "NO_COORDINATES" in codes

    def test_zero_coordinates_emits_error(self) -> None:
        # Null-island artefact — sometimes ships when GPS metadata is broken.
        result = DovBoringParser().parse(_xml(pos="0.0 0.0"))
        assert result.has_errors is True
        assert any(i.code == "ZERO_COORDINATES" for i in result.issues)

    def test_non_numeric_pos_emits_no_coordinates(self) -> None:
        result = DovBoringParser().parse(_xml(pos="abc def"))
        assert result.has_errors is True
        assert any(i.code == "NO_COORDINATES" for i in result.issues)

    def test_pos_with_one_component_emits_no_coordinates(self) -> None:
        result = DovBoringParser().parse(_xml(pos="42.0"))
        assert result.has_errors is True
        assert any(i.code == "NO_COORDINATES" for i in result.issues)

    def test_lambert72_position_outside_belgium_raises_bounds_warning(self) -> None:
        # DOV positions are Belgian Lambert 72 (EPSG:31370); a northing far
        # north of Belgium (Amsterdam RD range) is caught at import.
        result = DovBoringParser().parse(_xml(pos="121000.0 487000.0 5.0"))
        bounds = [i for i in result.issues if i.code == "COORDINATES_OUTSIDE_CRS_BOUNDS"]
        assert len(bounds) == 1
        assert bounds[0].level == ValidationLevel.WARNING
        assert "31370" in bounds[0].message
        # Never blocks the import for it.
        assert all(i.level != ValidationLevel.ERROR for i in result.issues)

    def test_lambert72_position_inside_belgium_raises_no_bounds_warning(self) -> None:
        # The default fixture's (200000, 200000) is a valid Belgian point.
        result = DovBoringParser().parse(_xml())
        assert all(i.code != "COORDINATES_OUTSIDE_CRS_BOUNDS" for i in result.issues)


# ---------------------------------------------------------------------------
# Drill segments
# ---------------------------------------------------------------------------


class TestDrillSegments:
    def test_single_drill_segment(self) -> None:
        rows = _drill_segment("0.00", "0.50", "spade")
        result = DovBoringParser().parse(_xml(drill_segments=rows))
        assert len(result.drill_segments) == 1
        seg = result.drill_segments[0]
        assert seg.top_m == 0.0
        assert seg.base_m == 0.5
        assert seg.method == "spade"

    def test_multi_segment_real_borehole(self) -> None:
        # Reproduces the actual segment list from the DOV example we probed
        # for permkey 2025-232644.
        rows = (
            _drill_segment("0.00", "0.50", "spade")
            + _drill_segment("0.50", "2.00", "edelmanboring")
            + _drill_segment("2.00", "4.50", "avegaarboring")
            + _drill_segment("4.50", "6.00", "pulsboring")
            + _drill_segment("6.00", "7.00", "avegaarboring")
            + _drill_segment("7.00", "7.50", "pulsboring")
            + _drill_segment("7.50", "8.50", "avegaarboring")
        )
        result = DovBoringParser().parse(_xml(drill_segments=rows))
        assert len(result.drill_segments) == 7
        assert result.drill_segments[0].method == "spade"
        assert result.drill_segments[-1].method == "avegaarboring"
        assert result.drill_segments[-1].base_m == pytest.approx(8.50)

    def test_no_drill_segments_when_details_missing(self) -> None:
        result = DovBoringParser().parse(_xml(omit_details=True))
        assert result.drill_segments == []
        # NO_DETAILS is INFO, not ERROR.
        assert result.has_errors is False
        assert any(i.code == "NO_DETAILS" for i in result.issues)

    def test_invalid_interval_skipped_with_warning(self) -> None:
        rows = (
            _drill_segment("0.00", "0.50", "spade")
            + _drill_segment("2.00", "1.00", "edelmanboring")  # base < top
            + _drill_segment("0.50", "2.00", "avegaarboring")
        )
        result = DovBoringParser().parse(_xml(drill_segments=rows))
        # Two valid segments retained; one emits a WARNING.
        assert len(result.drill_segments) == 2
        assert any(
            i.code == "INVALID_INTERVAL" and i.level == ValidationLevel.WARNING
            for i in result.issues
        )

    def test_incomplete_drill_segment_skipped_with_warning(self) -> None:
        rows = (
            _drill_segment("0.00", "0.50", "spade")
            + "<boormethode><van>0.50</van><tot>2.00</tot></boormethode>"  # no <methode>
        )
        result = DovBoringParser().parse(_xml(drill_segments=rows))
        assert len(result.drill_segments) == 1
        assert any(i.code == "INCOMPLETE_DRILL_SEGMENT" for i in result.issues)


# ---------------------------------------------------------------------------
# Field log — color, moisture, consistency
# ---------------------------------------------------------------------------


class TestFieldLog:
    def test_color_intervals(self) -> None:
        rows = _field_log_row("kleur", "0.00", "1.50", "groenbruin") + _field_log_row(
            "kleur", "1.50", "3.00", "bruingroen"
        )
        result = DovBoringParser().parse(_xml(field_log=rows))
        colors = [f for f in result.field_log if f.kind is FieldLogKind.COLOR]
        assert len(colors) == 2
        assert colors[0].value == "groenbruin"
        assert colors[1].value == "bruingroen"

    def test_moisture_and_consistency_kinds(self) -> None:
        rows = _field_log_row("vochtgehalte", "0.00", "2.50", "weinig vochtig") + _field_log_row(
            "consistentie", "6.00", "7.00", "plastisch"
        )
        result = DovBoringParser().parse(_xml(field_log=rows))
        kinds = {f.kind for f in result.field_log}
        assert kinds == {FieldLogKind.MOISTURE, FieldLogKind.CONSISTENCY}
        moisture = next(f for f in result.field_log if f.kind is FieldLogKind.MOISTURE)
        assert moisture.value == "weinig vochtig"

    def test_all_three_kinds_mixed(self) -> None:
        rows = (
            _field_log_row("kleur", "0.00", "1.00", "groenbruin")
            + _field_log_row("vochtgehalte", "0.00", "2.50", "vochtig")
            + _field_log_row("consistentie", "6.00", "7.00", "plastisch")
        )
        result = DovBoringParser().parse(_xml(field_log=rows))
        assert len(result.field_log) == 3
        kinds = {f.kind for f in result.field_log}
        assert kinds == {FieldLogKind.COLOR, FieldLogKind.MOISTURE, FieldLogKind.CONSISTENCY}

    def test_empty_field_log_is_silent(self) -> None:
        # Borehole with no field log is valid (e.g. spade auger boreholes
        # often only emit drill segments).
        result = DovBoringParser().parse(_xml(field_log=""))
        assert result.field_log == []
        assert all(
            i.code != "INCOMPLETE_FIELD_LOG" and i.code != "INVALID_INTERVAL" for i in result.issues
        )

    def test_invalid_field_log_interval_skipped(self) -> None:
        # base equal to top → domain rejects → WARNING issue
        rows = _field_log_row("kleur", "1.00", "1.00", "bruin")
        result = DovBoringParser().parse(_xml(field_log=rows))
        assert result.field_log == []
        assert any(i.code == "INVALID_INTERVAL" for i in result.issues)


# ---------------------------------------------------------------------------
# Water-table depth
# ---------------------------------------------------------------------------


class TestGroundwater:
    def test_water_table_extracted(self) -> None:
        result = DovBoringParser().parse(_xml(grondwater=_grondwaterstand("4.30")))
        assert result.borehole.water_table_depth_m == pytest.approx(4.30)

    def test_no_grondwaterstand_means_none(self) -> None:
        result = DovBoringParser().parse(_xml())
        assert result.borehole.water_table_depth_m is None


# ---------------------------------------------------------------------------
# Fatal cases — ParseError is raised
# ---------------------------------------------------------------------------


class TestFatalCases:
    def test_unparseable_xml_raises_parse_error(self) -> None:
        with pytest.raises(ParseError, match="parse error"):
            DovBoringParser().parse(b"<not>valid<xml")

    def test_no_boring_child_raises_parse_error(self) -> None:
        empty = (
            f'<?xml version="1.0"?><ns4:dov-schema xmlns:ns4="{_NS}"><sondering/></ns4:dov-schema>'
        ).encode()
        with pytest.raises(ParseError, match="missing <boring>"):
            DovBoringParser().parse(empty)


# ---------------------------------------------------------------------------
# Resilience to unknown extra elements
# ---------------------------------------------------------------------------


class TestResilience:
    def test_unknown_extra_elements_ignored(self) -> None:
        # DOV may add new optional elements; we silently ignore them.
        extra = "<some_new_element_we_dont_know>value</some_new_element_we_dont_know>"
        result = DovBoringParser().parse(_xml(extra_inside_boring=extra))
        # Parse still succeeds with no issues.
        assert result.has_errors is False
        assert result.borehole.name == "GEO-25/001-B1"

    def test_fallback_name_when_identificatie_empty(self) -> None:
        result = DovBoringParser().parse(_xml(name=""), name="fallback-name")
        assert result.borehole.name == "fallback-name"

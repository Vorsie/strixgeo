"""Unit tests for DovBoringFileParser — a LOCAL DOV ``dov-schema`` XML file.

Owner ruling 2026-09-28: "write an import function ... based off these .xml
files, flag everything that is weird". A file saved from DOV can hold ONE OR
SEVERAL borings plus every interpretation of each of them, so the file parser
splits it per boring, attaches every interpretation whose ``<boring>`` names
that boring, names the boring by its alternative name when DOV has one, and
raises a flag for everything an engineer should look at before trusting it.

The five real fixture files are the owner's own project data
(``tests/fixtures/dov_boring_files``); the per-file flag sets below were
written down from the owner's files and pin what the importer tells him.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from groundmodel.domain.value_objects.observation_type import ObservationType
from groundmodel.infrastructure.parsers.borehole.dov.dov_boring_file_parser import (
    DovBoringFileParser,
)
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel
from groundmodel.shared.exceptions import ParseError

FIXTURES = Path(__file__).resolve().parents[4] / "fixtures" / "dov_boring_files"
TODAY = date(2026, 9, 28)


def _parse(filename: str):
    """Parse one real fixture file with a pinned 'today'."""
    return DovBoringFileParser().parse(
        (FIXTURES / filename).read_bytes(), name=filename, today=TODAY
    )


def _codes(entry) -> set[str]:
    """Return the set of flag codes an imported boring carries."""
    return {issue.code for issue in entry.issues}


def _by_name(result) -> dict:
    """Index the file's borings by display name."""
    return {entry.name: entry for entry in result.borings}


# ---------------------------------------------------------------------------
# The five real files — which borings, which names, which flags
# ---------------------------------------------------------------------------


def test_one_file_with_four_borings_yields_four_boreholes_named_by_their_alternative_name():
    """GEO-25-121 holds B3, B4, B5 and B6 — all four come out, none is dropped."""
    result = _parse("GEO-25-121-B3-B4-B5-B6-onbewerkt.xml")
    assert sorted(e.name for e in result.borings) == [
        "GEO-25/121-B3",
        "GEO-25/121-B4",
        "GEO-25/121-B5",
        "GEO-25/121-B6",
    ]
    # identificatie stays the identity; the alternative name is only the label.
    b4 = _by_name(result)["GEO-25/121-B4"]
    assert b4.test_id == "1411-BORGEO2600027-20-04-2026-B4"
    assert b4.permkey == "2026-245349"
    assert b4.borehole.borehole.name == "GEO-25/121-B4"
    assert b4.borehole.borehole.total_depth_m == 7.0


def test_many_borings_file_flags_every_boring_with_the_count():
    """Every boring of a multi-boring file carries FILE_HOLDS_MANY_BORINGS (4)."""
    result = _parse("GEO-25-121-B3-B4-B5-B6-onbewerkt.xml")
    for entry in result.borings:
        flag = next(i for i in entry.issues if i.code == "FILE_HOLDS_MANY_BORINGS")
        assert "4" in flag.message
        assert entry.name in flag.message


@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        (
            "GEO-25-110-B1onbewerkt.xml",
            {
                "GEO-25/110-B1": {
                    "NAME_FROM_ALTERNATIVE",
                    "STRATIGRAPHY_PRESENT",
                    "GROUNDWATER_ASSUMED",
                },
            },
        ),
        (
            "GEO-25-110-B2onbewerkt.xml",
            {"GEO-25/110-B2": {"NAME_FROM_ALTERNATIVE", "STRATIGRAPHY_PRESENT"}},
        ),
        (
            "GEO-25-121-B3-B4-B5-B6-onbewerkt.xml",
            {
                name: {
                    "FILE_HOLDS_MANY_BORINGS",
                    "NAME_FROM_ALTERNATIVE",
                    "NO_LITHOLOGICAL_DESCRIPTION",
                    "NO_FIELD_LOG",
                    "REMARK_PRESENT",
                    "ATTACHMENT_PRESENT",
                }
                for name in ("GEO-25/121-B3", "GEO-25/121-B4", "GEO-25/121-B5", "GEO-25/121-B6")
            },
        ),
        (
            "boring van Sialtech.xml",
            {
                "15Abcert019-B2": {
                    "PURPOSE_NOT_GEOTECHNICAL",
                    "DRILLMASTER_UNKNOWN",
                    "ELEVATION_ZERO",
                    "REMARK_PRESENT",
                    "NO_FIELD_LOG",
                    "MULTIPLE_LITHOLOGICAL_DESCRIPTIONS",
                    "STRATIGRAPHY_PRESENT",
                    "GROUNDWATER_ASSUMED",
                    "INVALID_INTERVAL",
                    "LITHOLOGY_GAPS_OR_OVERLAPS",
                },
            },
        ),
        (
            "boring van Smet GWT Europe.xml",
            {
                "BGD024E0220": {
                    "NAME_FROM_ALTERNATIVE",
                    "PURPOSE_NOT_GEOTECHNICAL",
                    "NO_FIELD_LOG",
                    "MULTIPLE_LITHOLOGICAL_DESCRIPTIONS",
                    "STRATIGRAPHY_PRESENT",
                    "RELIABILITY_NOT_GOOD",
                    "DEPTH_MISMATCH",
                    "ATTACHMENT_PRESENT",
                },
            },
        ),
    ],
)
def test_each_real_file_raises_exactly_the_flags_an_engineer_should_see(filename, expected):
    """The flag set per boring is pinned: nothing weird goes unflagged, nothing normal is."""
    result = _parse(filename)
    assert {e.name: _codes(e) for e in result.borings} == expected
    assert result.issues == []


def test_every_flag_names_its_boring():
    """Each flag message carries the boring's display name, so a list of flags reads alone."""
    for filename in sorted(p.name for p in FIXTURES.glob("*.xml")):
        for entry in _parse(filename).borings:
            for issue in entry.issues:
                assert entry.name in issue.message, (filename, issue.code, issue.message)


# ---------------------------------------------------------------------------
# Interpretations — every one, attached to its own boring
# ---------------------------------------------------------------------------


def test_every_interpretation_of_the_boring_is_kept_not_only_the_first():
    """B1 carries informal stratigraphy AND a lithological description — both come in."""
    entry = _parse("GEO-25-110-B1onbewerkt.xml").borings[0]
    kinds = sorted(i.observation_type.value for i in entry.interpretations)
    assert kinds == ["informal_stratigraphy", "lithological_description"]
    litho = entry.primary_lithology
    assert litho is not None
    assert litho.permkey == "2026-410970"
    assert len(litho.result.observation.layers) == 70


def test_two_lithological_descriptions_use_the_one_with_most_layers_and_keep_the_other():
    """Smet has a 4-layer and a 47-layer description: the 47 one is used, the 4 one kept."""
    entry = _parse("boring van Smet GWT Europe.xml").borings[0]
    descriptions = [
        i
        for i in entry.interpretations
        if i.observation_type == ObservationType.LITHOLOGICAL_DESCRIPTION
    ]
    assert sorted(len(d.result.observation.layers) for d in descriptions) == [4, 47]
    assert entry.primary_lithology is not None
    assert len(entry.primary_lithology.result.observation.layers) == 47
    assert [d.is_primary for d in descriptions].count(True) == 1
    flag = next(i for i in entry.issues if i.code == "MULTIPLE_LITHOLOGICAL_DESCRIPTIONS")
    assert "2" in flag.message and "47" in flag.message


def test_the_primary_description_is_the_first_interpretation():
    """The used description is listed first, so it persists (and shows) before the others."""
    entry = _parse("boring van Sialtech.xml").borings[0]
    first_litho = next(
        i
        for i in entry.interpretations
        if i.observation_type == ObservationType.LITHOLOGICAL_DESCRIPTION
    )
    assert first_litho.is_primary
    assert len(first_litho.result.observation.layers) == 13


def test_a_boring_without_description_is_a_warning():
    """No lithological description → WARNING, the boring still imports."""
    entry = _parse("GEO-25-121-B3-B4-B5-B6-onbewerkt.xml").borings[0]
    flag = next(i for i in entry.issues if i.code == "NO_LITHOLOGICAL_DESCRIPTION")
    assert flag.level == ValidationLevel.WARNING
    assert entry.primary_lithology is None


def test_reliability_other_than_good_is_a_warning_naming_the_value():
    """Smet's short description says betrouwbaarheid 'onbekend' — flagged, WARNING."""
    entry = _parse("boring van Smet GWT Europe.xml").borings[0]
    flag = next(i for i in entry.issues if i.code == "RELIABILITY_NOT_GOOD")
    assert flag.level == ValidationLevel.WARNING
    assert "onbekend" in flag.message


def test_elevation_zero_is_a_warning_quoting_the_method_never_a_rejection():
    """0 m TAW is a real value (owner ruling) — Sialtech keeps z=0 and is flagged to check."""
    entry = _parse("boring van Sialtech.xml").borings[0]
    assert entry.borehole.borehole.elevation_m == 0.0
    flag = next(i for i in entry.issues if i.code == "ELEVATION_ZERO")
    assert flag.level == ValidationLevel.WARNING
    assert "uit dossier" in flag.message
    assert not entry.borehole.has_errors


def test_depth_mismatch_names_both_depths():
    """Smet: diepte_tot 44 m, description runs to 47 m → WARNING with both numbers."""
    entry = _parse("boring van Smet GWT Europe.xml").borings[0]
    flag = next(i for i in entry.issues if i.code == "DEPTH_MISMATCH")
    assert flag.level == ValidationLevel.WARNING
    assert "44.00" in flag.message and "47.00" in flag.message


def test_remark_is_quoted_and_truncated():
    """The remark text rides along, whitespace collapsed, at most 200 characters."""
    entry = _parse("boring van Sialtech.xml").borings[0]
    flag = next(i for i in entry.issues if i.code == "REMARK_PRESENT")
    assert "Geen overschrijding NAD" in flag.message
    b4 = _by_name(_parse("GEO-25-121-B3-B4-B5-B6-onbewerkt.xml"))["GEO-25/121-B4"]
    remark = next(i for i in b4.issues if i.code == "REMARK_PRESENT")
    assert "spoelboring" in remark.message
    assert len(remark.message) < 200 + len(b4.name) + 60


def test_attachment_names_title_and_url():
    """The attachment flag carries the title and the url so the engineer can open it."""
    b4 = _by_name(_parse("GEO-25-121-B3-B4-B5-B6-onbewerkt.xml"))["GEO-25/121-B4"]
    flag = next(i for i in b4.issues if i.code == "ATTACHMENT_PRESENT")
    assert "25-121 - alle weerstandsdiagrammen_finaal-4.pdf" in flag.message
    assert "https://www.dov.vlaanderen.be/proeven-ocdov/proxy/bestand/161585/inhoud" in (
        flag.message
    )


# ---------------------------------------------------------------------------
# Inline documents — boundaries the real files do not reach
# ---------------------------------------------------------------------------

_NS = "http://kern.schemas.dov.vlaanderen.be"
_GML = "http://www.opengis.net/gml/3.2"


def _boring(
    ident: str = "X-B1",
    *,
    z: str = "5.00",
    datum: str = "2025-06-13",
    doel: str = "Geotechnisch onderzoek",
    diepte_tot: str = "3.00",
    extra: str = "",
) -> str:
    """Build a minimal but valid ``<boring>`` element."""
    return f"""
    <boring>
      <identificatie>{ident}</identificatie>
      <dataidentifier><permkey>2025-1</permkey></dataidentifier>
      <ligging>
        <gml:Point srsName="urn:ogc:def:crs:EPSG::6190" srsDimension="3">
          <gml:pos>150000.00 200000.00 {z}</gml:pos>
        </gml:Point>
        <metadata_hoogtebepaling><methode>waterpassing</methode>
          <betrouwbaarheid>goed</betrouwbaarheid></metadata_hoogtebepaling>
      </ligging>
      <diepte_tot>{diepte_tot}</diepte_tot>
      <datum_aanvang>{datum}</datum_aanvang>
      <doel>{doel}</doel>
      <boormeester><naam>Peeters</naam></boormeester>
      <details>
        <boormethode><van>0.00</van><tot>{diepte_tot}</tot><methode>spade</methode></boormethode>
        <kleur><van>0.00</van><tot>{diepte_tot}</tot><kleur>bruin</kleur></kleur>
      </details>
      {extra}
    </boring>"""


def _description(boring: str, tag: str = "lithologischebeschrijving", to: str = "3.00") -> str:
    """Build one interpretation stream element for *boring*."""
    return f"""
    <{tag}>
      <boring>{boring}</boring>
      <dataidentifier><permkey>2025-9</permkey></dataidentifier>
      <betrouwbaarheid>goed</betrouwbaarheid>
      <laag><van>0.00</van><tot>{to}</tot><beschrijving>zand</beschrijving></laag>
    </{tag}>"""


def _doc(borings: str, interpretations: str = "") -> bytes:
    """Wrap borings + interpretations in a dov-schema root."""
    interp = f"<interpretaties>{interpretations}</interpretaties>" if interpretations else ""
    return (
        f'<ns4:dov-schema xmlns:ns4="{_NS}" xmlns:gml="{_GML}">{borings}{interp}</ns4:dov-schema>'
    ).encode()


def test_a_clean_boring_raises_no_flag():
    """Near-miss: a geotechnical boring with a known drillmaster and one description is clean."""
    result = DovBoringFileParser().parse(
        _doc(_boring(), _description("X-B1")), name="clean.xml", today=TODAY
    )
    assert [i.code for i in result.borings[0].issues] == []
    assert result.borings[0].name == "X-B1"


def test_a_start_date_after_today_is_a_warning():
    """datum_aanvang in the future → DATE_IN_FUTURE WARNING; today itself is not."""
    future = DovBoringFileParser().parse(
        _doc(_boring(datum="2026-09-29"), _description("X-B1")), name="f.xml", today=TODAY
    )
    flag = next(i for i in future.borings[0].issues if i.code == "DATE_IN_FUTURE")
    assert flag.level == ValidationLevel.WARNING
    same_day = DovBoringFileParser().parse(
        _doc(_boring(datum="2026-09-28"), _description("X-B1")), name="f.xml", today=TODAY
    )
    assert "DATE_IN_FUTURE" not in _codes(same_day.borings[0])


def test_depth_within_a_centimetre_is_not_a_mismatch():
    """Boundary: a description ending 4 mm off the total depth is rounding, not a mismatch."""
    result = DovBoringFileParser().parse(
        _doc(_boring(diepte_tot="3.00"), _description("X-B1", to="3.004")),
        name="d.xml",
        today=TODAY,
    )
    assert "DEPTH_MISMATCH" not in _codes(result.borings[0])


def test_interpretations_attach_to_their_own_boring_only():
    """Two borings, each with its own description: none crosses over."""
    result = DovBoringFileParser().parse(
        _doc(
            _boring("X-B1") + _boring("X-B2"),
            _description("X-B2", to="3.00") + _description("X-B1", to="3.00"),
        ),
        name="two.xml",
        today=TODAY,
    )
    for entry in result.borings:
        assert len(entry.interpretations) == 1
        assert entry.interpretations[0].result.observation.borehole_id == entry.borehole_key


def test_an_interpretation_for_a_boring_not_in_the_file_is_a_file_level_warning():
    """An orphan interpretation is not silently dropped: a file-level WARNING names it."""
    result = DovBoringFileParser().parse(
        _doc(_boring("X-B1"), _description("X-B1") + _description("ELSEWHERE-B9")),
        name="orphan.xml",
        today=TODAY,
    )
    flag = next(i for i in result.issues if i.code == "INTERPRETATION_WITHOUT_BORING")
    assert flag.level == ValidationLevel.WARNING
    assert "ELSEWHERE-B9" in flag.message


def test_an_unknown_interpretation_stream_is_a_warning_not_a_crash():
    """A stream tag we have no type for is skipped with a named WARNING."""
    result = DovBoringFileParser().parse(
        _doc(_boring("X-B1"), _description("X-B1") + _description("X-B1", tag="nieuwestroom")),
        name="unknown.xml",
        today=TODAY,
    )
    entry = result.borings[0]
    flag = next(i for i in entry.issues if i.code == "UNKNOWN_INTERPRETATION_STREAM")
    assert "nieuwestroom" in flag.message
    assert len(entry.interpretations) == 1


def test_not_xml_is_a_parse_error():
    """Garbage bytes raise ParseError (the route answers 400)."""
    with pytest.raises(ParseError):
        DovBoringFileParser().parse(b"not xml at all", name="bad.xml", today=TODAY)


def test_a_document_without_any_boring_is_a_parse_error():
    """A dov-schema with no <boring> (e.g. a CPT export) is refused, named."""
    with pytest.raises(ParseError, match="boring"):
        DovBoringFileParser().parse(_doc(""), name="empty.xml", today=TODAY)

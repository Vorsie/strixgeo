"""Every import flag carries its variable parts as structured ``params``.

Owner dogfeed 2026-10-03: the NL import report printed the backend's English
flag sentences. The fix translates at the presentation boundary — one catalogue
entry per flag code — and the catalogue can only say "{count} boringen" when the
finding hands it the count. So the rule, in the ruling's words: every emitted
finding carries its params (names, counts, depths, permkeys) as structured
fields next to the English ``message``; the message stays as the tooltip.

The table below is the contract the desktop catalogue reads: code → the param
keys its NL sentence fills in. A code with no variable part carries ``{}``.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from groundmodel.infrastructure.parsers.borehole.dov.dov_boring_file_parser import (
    DovBoringFileParser,
)
from groundmodel.infrastructure.parsers.validation.validation_issue import ValidationIssue

FIXTURES = Path(__file__).resolve().parents[4] / "fixtures" / "dov_boring_files"
TODAY = date(2026, 9, 28)

# code → the param keys the desktop catalogue needs (subset check: a code may
# carry more, never fewer).
REQUIRED_PARAMS: dict[str, set[str]] = {
    "FILE_HOLDS_MANY_BORINGS": {"count"},
    "NAME_FROM_ALTERNATIVE": {"alternatives", "test_id"},
    "NO_LITHOLOGICAL_DESCRIPTION": set(),
    "MULTIPLE_LITHOLOGICAL_DESCRIPTIONS": {
        "count",
        "used_layers",
        "used_permkey",
        "other_layers",
    },
    "STRATIGRAPHY_PRESENT": {"stream", "layers", "permkey"},
    "RELIABILITY_NOT_GOOD": {"subject", "reliability"},
    "ELEVATION_ZERO": {"method"},
    "NO_FIELD_LOG": set(),
    "DRILLMASTER_UNKNOWN": {"drillmaster"},
    "PURPOSE_NOT_GEOTECHNICAL": {"purpose", "expected"},
    "REMARK_PRESENT": {"remark"},
    "ATTACHMENT_PRESENT": {"title", "url"},
    "DEPTH_MISMATCH": {"total_m", "end_m", "against"},
    "DATE_IN_FUTURE": {"date", "today"},
    "GROUNDWATER_ASSUMED": {"depth_m"},
    "START_DEPTH_NOT_ZERO": {"depth_m"},
    "LITHOLOGY_GAPS_OR_OVERLAPS": {"count", "places", "more"},
    "UNKNOWN_INTERPRETATION_STREAM": {"tag"},
    "INTERPRETATION_WITHOUT_BORING": {"file", "count", "tags", "boring"},
    "INVALID_INTERVAL": {"part", "top_m", "base_m"},
}

_NS = "http://kern.schemas.dov.vlaanderen.be"
_GML = "http://www.opengis.net/gml/3.2"

# One synthetic document that reaches the codes the owner's five files do not:
# a future date, a non-zero start depth, a drill segment shorter than the total
# depth, an unknown stream, an orphan interpretation, an unreliable position.
_EDGE_DOC = f"""
<ns4:dov-schema xmlns:ns4="{_NS}" xmlns:gml="{_GML}">
  <boring>
    <identificatie>X-B1</identificatie>
    <dataidentifier><permkey>2025-1</permkey></dataidentifier>
    <ligging>
      <gml:Point srsName="urn:ogc:def:crs:EPSG::6190" srsDimension="3">
        <gml:pos>150000.00 200000.00 5.00</gml:pos>
      </gml:Point>
      <metadata_locatiebepaling><betrouwbaarheid>onbekend</betrouwbaarheid>
      </metadata_locatiebepaling>
    </ligging>
    <diepte_van>0.50</diepte_van>
    <diepte_tot>3.00</diepte_tot>
    <datum_aanvang>2026-12-01</datum_aanvang>
    <doel>Geotechnisch onderzoek</doel>
    <boormeester><naam>Peeters</naam></boormeester>
    <details>
      <boormethode><van>0.50</van><tot>2.00</tot><methode>spade</methode></boormethode>
      <kleur><van>0.50</van><tot>2.00</tot><kleur>bruin</kleur></kleur>
    </details>
  </boring>
  <interpretaties>
    <lithologischebeschrijving>
      <boring>X-B1</boring>
      <dataidentifier><permkey>2025-9</permkey></dataidentifier>
      <laag><van>0.00</van><tot>3.00</tot><beschrijving>zand</beschrijving></laag>
    </lithologischebeschrijving>
    <nieuwestroom><boring>X-B1</boring></nieuwestroom>
    <lithologischebeschrijving><boring>ELSEWHERE-B9</boring></lithologischebeschrijving>
  </interpretaties>
</ns4:dov-schema>
""".encode()


def _all_findings() -> list[ValidationIssue]:
    """Every finding the parser raises on the five real files + the edge document."""
    parser = DovBoringFileParser()
    findings: list[ValidationIssue] = []
    sources = [(p.name, p.read_bytes()) for p in sorted(FIXTURES.glob("*.xml"))]
    sources.append(("edge.xml", _EDGE_DOC))
    for name, data in sources:
        result = parser.parse(data, name=name, today=TODAY)
        findings.extend(result.issues)
        for entry in result.borings:
            findings.extend(entry.issues)
    return findings


def test_every_flag_code_of_the_table_is_reached_by_the_inputs():
    """Guard: the inputs raise every code in the table, so the next test checks them all."""
    reached = {f.code for f in _all_findings()}
    assert set(REQUIRED_PARAMS) <= reached, sorted(set(REQUIRED_PARAMS) - reached)


@pytest.mark.parametrize("code", sorted(REQUIRED_PARAMS))
def test_every_emitted_finding_carries_its_params(code):
    """Each finding of *code* hands the catalogue its variable parts as params."""
    findings = [f for f in _all_findings() if f.code == code]
    assert findings, f"no {code} finding raised"
    for finding in findings:
        missing = REQUIRED_PARAMS[code] - set(finding.params)
        assert not missing, f"{code} lacks params {sorted(missing)}: {finding.message}"


def test_params_carry_the_values_not_a_rendered_sentence():
    """Happy path: the numbers and names are the raw values the message quotes."""
    findings = _all_findings()
    many = next(f for f in findings if f.code == "FILE_HOLDS_MANY_BORINGS")
    assert many.params["count"] == 4
    alt = next(
        f
        for f in findings
        if f.code == "NAME_FROM_ALTERNATIVE" and f.params["test_id"].endswith("B1")
    )
    assert alt.params["alternatives"][0]["name"] == "GEO-25/110-B1"
    gaps = next(f for f in findings if f.code == "LITHOLOGY_GAPS_OR_OVERLAPS")
    assert gaps.params["count"] == len(gaps.params["places"]) + gaps.params["more"]
    assert {p["kind"] for p in gaps.params["places"]} <= {"start", "gap", "overlap"}
    future = next(f for f in findings if f.code == "DATE_IN_FUTURE")
    assert future.params == {"date": "2026-12-01", "today": "2026-09-28"}
    mismatch = next(
        f for f in findings if f.code == "DEPTH_MISMATCH" and f.params["against"] == "drill_segment"
    )
    assert (mismatch.params["total_m"], mismatch.params["end_m"]) == (3.0, 2.0)

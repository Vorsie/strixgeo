"""Unit tests for the DXF section exporter (v1.0 MVP gate #5).

The exporter is a pure ``SectionSnapshot → bytes`` transform — no DB,
no network, fully unit-testable. We build small synthetic snapshots
and assert:

* The exporter produces parseable DXF.
* The expected entities show up on the expected layers.
* Per-formation polylines connect contacts sorted by along-distance.
* Per-investigation columns emit one line + one label each.
* Formation colours land on the layer's ``rgb`` triplet.
* Helpers behave on malformed input.
"""

from __future__ import annotations

import io
from uuid import UUID, uuid4

import ezdxf
import pytest

from groundmodel.application.section_snapshot import (
    SectionFormation,
    SectionFormationContact,
    SectionInvestigationProjection,
    SectionSnapshot,
)
from groundmodel.infrastructure.exporters.dxf_section_exporter import (
    DxfSectionExporter,
    _formation_layer_name,
    _parse_hex_color,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _snapshot(
    *,
    investigations: list[SectionInvestigationProjection] | None = None,
    formations: list[SectionFormation] | None = None,
    contacts: list[SectionFormationContact] | None = None,
) -> SectionSnapshot:
    return SectionSnapshot(
        project_id=UUID("00000000-0000-0000-0000-000000000001"),
        project_name="Antwerp port — quay 7",
        section_id=UUID("00000000-0000-0000-0000-000000000002"),
        section_name="Section A-A'",
        section_length_m=100.0,
        crs_epsg=31370,
        vertical_datum_label="m TAW",
        investigations=investigations or [],
        formations=formations or [],
        contacts=contacts or [],
    )


def _parse_dxf(payload: bytes):  # type: ignore[no-untyped-def]
    """Reload the exported bytes through ezdxf so the test reads
    semantic DXF entities, not raw text. Catches malformed output
    that happens to grep-pass."""
    return ezdxf.read(io.StringIO(payload.decode("utf-8")))


# ---------------------------------------------------------------------------
# Smoke — empty snapshot
# ---------------------------------------------------------------------------


def test_empty_snapshot_produces_valid_dxf() -> None:
    """A section with no investigations and no contacts still exports
    cleanly — title block + an empty model space. Useful for the
    initial "I just created the section, let me see what comes out"
    flow before the user has placed anything."""
    payload = DxfSectionExporter().export(_snapshot())
    assert payload, "exporter produced no bytes"
    doc = _parse_dxf(payload)
    # The title block lands on the Investigations layer (it's a
    # bottom-of-canvas annotation owned by the columns track).
    titles = [e for e in doc.modelspace().query("TEXT") if "Project:" in e.dxf.text]
    assert len(titles) == 1


# ---------------------------------------------------------------------------
# Investigation columns
# ---------------------------------------------------------------------------


def test_each_investigation_emits_one_line_and_one_label() -> None:
    snap = _snapshot(
        investigations=[
            SectionInvestigationProjection(
                investigation_id=uuid4(),
                kind="cpt",
                name="CPT-01",
                along_distance_m=10.0,
                surface_elevation_m=15.0,
                total_depth_m=20.0,
            ),
            SectionInvestigationProjection(
                investigation_id=uuid4(),
                kind="borehole",
                name="BH-1",
                along_distance_m=50.0,
                surface_elevation_m=14.0,
                total_depth_m=30.0,
            ),
        ],
    )
    doc = _parse_dxf(DxfSectionExporter().export(snap))
    msp = doc.modelspace()
    lines = list(msp.query("LINE[layer=='Investigations']"))
    assert len(lines) == 2
    labels = [
        e.dxf.text
        for e in msp.query("TEXT[layer=='Investigations']")
        if "Project:" not in e.dxf.text
        and "Section:" not in e.dxf.text
        and "Length:" not in e.dxf.text
        and "NB:" not in e.dxf.text
    ]
    assert sorted(labels) == ["BH-1", "CPT-01"]


def test_column_line_runs_from_surface_to_total_depth() -> None:
    snap = _snapshot(
        investigations=[
            SectionInvestigationProjection(
                investigation_id=uuid4(),
                kind="cpt",
                name="CPT-01",
                along_distance_m=10.0,
                surface_elevation_m=20.0,
                total_depth_m=12.0,
            ),
        ],
    )
    doc = _parse_dxf(DxfSectionExporter().export(snap))
    line = next(iter(doc.modelspace().query("LINE[layer=='Investigations']")))
    # Top at (10, 20), bottom at (10, 20 - 12) = (10, 8).
    assert (line.dxf.start.x, line.dxf.start.y) == pytest.approx((10.0, 20.0))
    assert (line.dxf.end.x, line.dxf.end.y) == pytest.approx((10.0, 8.0))


def test_missing_surface_elevation_anchors_column_at_level_zero() -> None:
    """Without a Z, anchor the column at level 0. The title block
    annotates that the column's vertical position is indicative."""
    snap = _snapshot(
        investigations=[
            SectionInvestigationProjection(
                investigation_id=uuid4(),
                kind="cpt",
                name="CPT-noZ",
                along_distance_m=10.0,
                surface_elevation_m=None,
                total_depth_m=15.0,
            ),
        ],
    )
    payload = DxfSectionExporter().export(snap)
    doc = _parse_dxf(payload)
    line = next(iter(doc.modelspace().query("LINE[layer=='Investigations']")))
    assert line.dxf.start.y == pytest.approx(0.0)
    assert line.dxf.end.y == pytest.approx(-15.0)
    # Title block carries the NB warning.
    nb = [
        e
        for e in doc.modelspace().query("TEXT[layer=='Investigations']")
        if e.dxf.text.startswith("NB:")
    ]
    assert len(nb) == 1
    assert "1 column(s) lack surface elevation" in nb[0].dxf.text


# ---------------------------------------------------------------------------
# Formation surfaces
# ---------------------------------------------------------------------------


def test_per_formation_polyline_with_sorted_along_distance() -> None:
    """Contacts arrive in arbitrary order — the polyline emits them
    sorted by along-distance so the surface reads left-to-right."""
    f_id = uuid4()
    snap = _snapshot(
        investigations=[
            SectionInvestigationProjection(
                investigation_id=uuid4(),
                kind="cpt",
                name="left",
                along_distance_m=0.0,
                surface_elevation_m=10.0,
                total_depth_m=20.0,
            ),
            SectionInvestigationProjection(
                investigation_id=uuid4(),
                kind="cpt",
                name="middle",
                along_distance_m=50.0,
                surface_elevation_m=10.0,
                total_depth_m=20.0,
            ),
            SectionInvestigationProjection(
                investigation_id=uuid4(),
                kind="cpt",
                name="right",
                along_distance_m=100.0,
                surface_elevation_m=10.0,
                total_depth_m=20.0,
            ),
        ],
        formations=[
            SectionFormation(
                formation_id=f_id,
                name="Boom Klei",
                code="BmK",
                color="#ff8800",
                display_order=0,
            )
        ],
        # Intentionally out of order so we can verify sorting.
        contacts=[
            SectionFormationContact(
                contact_id=uuid4(),
                formation_id=f_id,
                investigation_id=uuid4(),
                along_distance_m=100.0,
                depth_m=3.0,
                level_m=7.0,
            ),
            SectionFormationContact(
                contact_id=uuid4(),
                formation_id=f_id,
                investigation_id=uuid4(),
                along_distance_m=0.0,
                depth_m=2.0,
                level_m=8.0,
            ),
            SectionFormationContact(
                contact_id=uuid4(),
                formation_id=f_id,
                investigation_id=uuid4(),
                along_distance_m=50.0,
                depth_m=2.5,
                level_m=7.5,
            ),
        ],
    )
    doc = _parse_dxf(DxfSectionExporter().export(snap))
    polylines = list(doc.modelspace().query("LWPOLYLINE"))
    assert len(polylines) == 1
    points = [(p[0], p[1]) for p in polylines[0].get_points()]
    assert points == pytest.approx([(0.0, 8.0), (50.0, 7.5), (100.0, 7.0)])


def test_single_contact_renders_as_circle_marker() -> None:
    """One pick → degenerate polyline; emit a circle marker so the
    contact is still visible in CAD."""
    f_id = uuid4()
    snap = _snapshot(
        formations=[
            SectionFormation(
                formation_id=f_id,
                name="Boom Klei",
                code=None,
                color="#ff8800",
                display_order=0,
            )
        ],
        contacts=[
            SectionFormationContact(
                contact_id=uuid4(),
                formation_id=f_id,
                investigation_id=uuid4(),
                along_distance_m=50.0,
                depth_m=2.0,
                level_m=8.0,
            )
        ],
    )
    doc = _parse_dxf(DxfSectionExporter().export(snap))
    circles = list(doc.modelspace().query("CIRCLE"))
    assert len(circles) == 1
    assert (circles[0].dxf.center.x, circles[0].dxf.center.y) == pytest.approx((50.0, 8.0))


def test_contact_without_level_is_skipped() -> None:
    """No surface_elevation on the anchor → contact has level_m=None;
    we can't place it on a level-axis DXF. Skip rather than emit a
    polyline with a fake Y."""
    f_id = uuid4()
    snap = _snapshot(
        formations=[
            SectionFormation(
                formation_id=f_id,
                name="Boom Klei",
                code=None,
                color="#ff8800",
                display_order=0,
            )
        ],
        contacts=[
            SectionFormationContact(
                contact_id=uuid4(),
                formation_id=f_id,
                investigation_id=uuid4(),
                along_distance_m=50.0,
                depth_m=2.0,
                level_m=None,
            )
        ],
    )
    doc = _parse_dxf(DxfSectionExporter().export(snap))
    assert len(list(doc.modelspace().query("LWPOLYLINE"))) == 0
    assert len(list(doc.modelspace().query("CIRCLE"))) == 0


# ---------------------------------------------------------------------------
# Layer colours + naming
# ---------------------------------------------------------------------------


def test_each_formation_gets_its_own_layer_with_rgb_colour() -> None:
    snap = _snapshot(
        formations=[
            SectionFormation(
                formation_id=uuid4(),
                name="Boom Klei",
                code="BmK",
                color="#ff8800",
                display_order=0,
            ),
            SectionFormation(
                formation_id=uuid4(),
                name="Diest Zand",
                code="Di",
                color="#33aa44",
                display_order=1,
            ),
        ],
    )
    doc = _parse_dxf(DxfSectionExporter().export(snap))
    layer_names = {layer.dxf.name for layer in doc.layers}
    assert "GeoModel-Boom Klei" in layer_names
    assert "GeoModel-Diest Zand" in layer_names

    boom = doc.layers.get("GeoModel-Boom Klei")
    assert boom.rgb == (0xFF, 0x88, 0x00)
    diest = doc.layers.get("GeoModel-Diest Zand")
    assert diest.rgb == (0x33, 0xAA, 0x44)


def test_layer_description_carries_formation_code() -> None:
    snap = _snapshot(
        formations=[
            SectionFormation(
                formation_id=uuid4(),
                name="Boom Klei",
                code="BmK",
                color="#ff8800",
                display_order=0,
            ),
        ],
    )
    doc = _parse_dxf(DxfSectionExporter().export(snap))
    layer = doc.layers.get("GeoModel-Boom Klei")
    assert "BmK" in layer.description


# ---------------------------------------------------------------------------
# Module helpers
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("normal name", "GeoModel-normal name"),
        ("Boom Klei / Diest", "GeoModel-Boom Klei  Diest"),
        ("Bad<chars>:test", "GeoModel-Badcharstest"),
        ('Quote"thing', "GeoModel-Quotething"),
    ],
)
def test_formation_layer_name_strips_dxf_forbidden_chars(raw, expected) -> None:
    assert _formation_layer_name(raw) == expected


def test_formation_layer_name_truncates_at_dxf_limit() -> None:
    long = "x" * 400
    name = _formation_layer_name(long)
    assert len(name) <= 255
    assert name.startswith("GeoModel-")


@pytest.mark.parametrize(
    "hex_str, expected",
    [
        ("#ff8800", (255, 136, 0)),
        ("ff8800", (255, 136, 0)),
        ("#f80", (255, 136, 0)),
        ("#FFFFFF", (255, 255, 255)),
    ],
)
def test_parse_hex_color_round_trips(hex_str, expected) -> None:
    rgb = _parse_hex_color(hex_str)
    assert rgb is not None
    assert (rgb.r, rgb.g, rgb.b) == expected


@pytest.mark.parametrize(
    "bogus",
    [
        "",
        "not a color",
        "#xxxxxx",
        "#ff",
        "#fffffff",  # 7 chars
    ],
)
def test_parse_hex_color_returns_none_on_bogus_input(bogus) -> None:
    assert _parse_hex_color(bogus) is None

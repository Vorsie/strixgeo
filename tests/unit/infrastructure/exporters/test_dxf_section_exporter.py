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


def test_draw_formation_surfaces_returns_drop_tally() -> None:
    """The dropped-contact counts on the success/warning lines derive from
    this return tuple; pin the arithmetic so a third drop reason can't
    silently desync ``drawn = total - no_level - no_formation``.

    One valid contact, one with no level, one referencing a formation that
    isn't in the snapshot (unresolvable) → (no_level=1, no_formation=1)."""
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
            # valid — has a level and a known formation.
            SectionFormationContact(
                contact_id=uuid4(),
                formation_id=f_id,
                investigation_id=uuid4(),
                along_distance_m=10.0,
                depth_m=2.0,
                level_m=8.0,
            ),
            # no level — can't sit on the absolute-level axis.
            SectionFormationContact(
                contact_id=uuid4(),
                formation_id=f_id,
                investigation_id=uuid4(),
                along_distance_m=20.0,
                depth_m=2.0,
                level_m=None,
            ),
            # unresolvable formation — id not present in snapshot.formations.
            SectionFormationContact(
                contact_id=uuid4(),
                formation_id=uuid4(),
                investigation_id=uuid4(),
                along_distance_m=30.0,
                depth_m=2.0,
                level_m=6.0,
            ),
        ],
    )
    doc = ezdxf.new(dxfversion="R2018", setup=True)
    exporter = DxfSectionExporter()
    layer_by_formation_id = exporter._setup_layers(doc, snap)
    dropped_no_level, dropped_no_formation = exporter._draw_formation_surfaces(
        doc.modelspace(), snap, layer_by_formation_id
    )
    assert dropped_no_level == 1
    assert dropped_no_formation == 1
    drawn = len(snap.contacts) - dropped_no_level - dropped_no_formation
    assert drawn == 1


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


def test_two_formations_with_the_same_name_still_export() -> None:
    """Two formations named the same must not make the DXF unreachable.

    Duplicate formation names are an EXPECTED state in this app — the
    seed-from-stratigraphy flow deliberately leaves the duplicate for the
    engineer to resolve from the row dropdown, and nothing in the schema
    or the create endpoint enforces uniqueness.  Exporting a section that
    carries both must still produce a DXF: each formation keeps a surface
    of its own, and neither is silently dropped.
    """
    a = uuid4()
    b = uuid4()
    snap = _snapshot(
        formations=[
            SectionFormation(
                formation_id=a, name="Zand van Mol", code=None, color="#ff8800", display_order=1
            ),
            SectionFormation(
                formation_id=b, name="Zand van Mol", code=None, color="#33aa44", display_order=0
            ),
        ],
        contacts=[
            SectionFormationContact(
                contact_id=uuid4(),
                formation_id=a,
                investigation_id=uuid4(),
                along_distance_m=0.0,
                depth_m=2.0,
                level_m=8.0,
            ),
            SectionFormationContact(
                contact_id=uuid4(),
                formation_id=a,
                investigation_id=uuid4(),
                along_distance_m=50.0,
                depth_m=3.0,
                level_m=7.0,
            ),
            SectionFormationContact(
                contact_id=uuid4(),
                formation_id=b,
                investigation_id=uuid4(),
                along_distance_m=0.0,
                depth_m=6.0,
                level_m=4.0,
            ),
            SectionFormationContact(
                contact_id=uuid4(),
                formation_id=b,
                investigation_id=uuid4(),
                along_distance_m=50.0,
                depth_m=7.0,
                level_m=3.0,
            ),
        ],
    )
    doc = _parse_dxf(DxfSectionExporter().export(snap))

    # Two distinct formations → two distinct layers, so the engineer can
    # still toggle them apart in CAD.
    formation_layers = {
        layer.dxf.name for layer in doc.layers if layer.dxf.name.startswith("GeoModel-")
    }
    assert len(formation_layers) == 2, formation_layers

    # And two separate surfaces — the two formations' contacts must never
    # be welded into one zig-zag polyline.
    polylines = list(doc.modelspace().query("LWPOLYLINE"))
    assert len(polylines) == 2
    drawn = sorted(sorted((p[0], p[1]) for p in poly.get_points()) for poly in polylines)
    assert drawn == [[(0.0, 4.0), (50.0, 3.0)], [(0.0, 8.0), (50.0, 7.0)]]


def test_two_formations_differing_only_by_case_still_export() -> None:
    """DXF layer names are case-folded, so ``Zand`` and ``ZAND`` collide.

    The names are distinct to the engineer but map onto one DXF table key,
    which is exactly the collision the layer table rejects.
    """
    a = uuid4()
    b = uuid4()
    snap = _snapshot(
        formations=[
            SectionFormation(
                formation_id=a, name="Zand", code=None, color="#ff8800", display_order=1
            ),
            SectionFormation(
                formation_id=b, name="ZAND", code=None, color="#33aa44", display_order=0
            ),
        ],
    )
    doc = _parse_dxf(DxfSectionExporter().export(snap))
    formation_layers = {
        layer.dxf.name for layer in doc.layers if layer.dxf.name.startswith("GeoModel-")
    }
    assert len(formation_layers) == 2, formation_layers


def test_two_formations_colliding_after_forbidden_char_stripping_still_export() -> None:
    """Stripping DXF-forbidden characters can collapse two names onto one.

    ``"Formatie: Boom"`` loses its colon and becomes the same layer name as
    ``"Formatie Boom"`` — a collision created by the exporter itself, not
    by duplicate data.
    """
    a = uuid4()
    b = uuid4()
    snap = _snapshot(
        formations=[
            SectionFormation(
                formation_id=a, name="Formatie: Boom", code=None, color="#ff8800", display_order=1
            ),
            SectionFormation(
                formation_id=b, name="Formatie Boom", code=None, color="#33aa44", display_order=0
            ),
        ],
    )
    doc = _parse_dxf(DxfSectionExporter().export(snap))
    formation_layers = {
        layer.dxf.name for layer in doc.layers if layer.dxf.name.startswith("GeoModel-")
    }
    assert len(formation_layers) == 2, formation_layers


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


# ---------------------------------------------------------------------------
# Line-break safety — a newline in a name must never reach the DXF stream.
#
# DXF is line-oriented; a raw newline in a layer-name value splits the record
# and corrupts the file. ezdxf backstops this with a plain ``assert '\n' not in
# value`` at write time — which ``python -O`` strips, so a packaged/optimised
# build would emit the corrupt DXF instead of failing. We strip CR/LF ourselves
# so the guard never depends on assertions being enabled.
# ---------------------------------------------------------------------------


def test_strip_dxf_line_breaks_removes_cr_lf_but_is_otherwise_byte_identical() -> None:
    """CR/LF are removed; every break-free string is returned unchanged."""
    from groundmodel.infrastructure.exporters.dxf_text_safety import strip_dxf_line_breaks

    # CR/LF are removed…
    assert strip_dxf_line_breaks("Zand\r\nKlei") == "ZandKlei"
    assert strip_dxf_line_breaks("a\nb\rc") == "abc"
    # …and any string without a line break is returned unchanged (byte-identical).
    for clean in ("GeoModel-Boom Klei  Diest", "Zand/Klei", "", "CPT-01", "x" * 300):
        assert strip_dxf_line_breaks(clean) == clean


def test_formation_layer_name_strips_line_breaks() -> None:
    """A formation name with CR/LF yields a layer name with neither."""
    name = _formation_layer_name("Zand\nKlei\rSilt")
    assert "\n" not in name
    assert "\r" not in name
    assert name == "GeoModel-ZandKleiSilt"


def test_section_export_with_newline_name_writes_valid_dxf() -> None:
    """A formation whose name carries a newline still produces a readable DXF.

    Before the fix, the raw newline reached ezdxf's layer-name export and tripped
    its ``assert '\\n' not in value`` — which ``python -O`` would have stripped,
    corrupting the file. The exporter must strip the break itself.
    """
    snap = _snapshot(
        formations=[
            SectionFormation(
                formation_id=uuid4(),
                name="Boom\nKlei",
                code=None,
                color="#ff8800",
                display_order=0,
            ),
        ],
        investigations=[
            SectionInvestigationProjection(
                investigation_id=uuid4(),
                kind="cpt",
                name="CPT\n-01",
                along_distance_m=10.0,
                surface_elevation_m=15.0,
                total_depth_m=20.0,
            ),
        ],
    )
    payload = DxfSectionExporter().export(snap)
    doc = _parse_dxf(payload)  # ezdxf re-read proves the stream is well-formed
    assert all("\n" not in layer.dxf.name for layer in doc.layers)


def test_colliding_layer_names_stay_distinct_at_the_dxf_length_limit() -> None:
    """A very long formation name must not truncate its own disambiguator off.

    Layer names are capped at 255 characters. If the suffix were appended
    and only then truncated, two 400-character duplicates would come back
    as the same 255-character name — reproducing the collision the suffix
    exists to resolve.
    """
    long_name = "x" * 400
    a = uuid4()
    b = uuid4()
    snap = _snapshot(
        formations=[
            SectionFormation(
                formation_id=a, name=long_name, code=None, color="#ff8800", display_order=1
            ),
            SectionFormation(
                formation_id=b, name=long_name, code=None, color="#33aa44", display_order=0
            ),
        ],
    )
    doc = _parse_dxf(DxfSectionExporter().export(snap))
    formation_layers = {
        layer.dxf.name for layer in doc.layers if layer.dxf.name.startswith("GeoModel-")
    }
    assert len(formation_layers) == 2, formation_layers
    assert all(len(name) <= 255 for name in formation_layers)


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

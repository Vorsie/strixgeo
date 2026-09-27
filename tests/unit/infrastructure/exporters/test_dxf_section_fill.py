"""The DXF section export carries the litho fill and the CPT curves.

Owner 2026-09-26, on a DXF of a litho fill: *"where are the litho fills, where
are the test graphs... it should literally look like litho fill in app if i
export a litho fill."* Until then the DXF carried the formation-pick polylines
and the column lines only. Now:

* every drawn region is a closed LWPOLYLINE plus a solid HATCH on its unit's
  layer, in the unit's colour, the same layer naming as the contact lines;
* every CPT column with a stored series gets its qc curve to the right of the
  column axis and its Rf curve to the left, on the section-wide qc full scale
  the app uses, with the app's 2 / 10 MPa and 2 / 4 % gridlines and labels.

The fixtures are hand-built so the geometry is exact.
"""

from __future__ import annotations

import io
from uuid import UUID, uuid4

import ezdxf

from groundmodel.application.section_cpt_trace import SectionCptTrace
from groundmodel.application.section_polygon_set import (
    SectionPolygon,
    SectionPolygonSet,
    SectionPolygonUnit,
)
from groundmodel.application.section_snapshot import (
    SectionFormation,
    SectionFormationContact,
    SectionInvestigationProjection,
    SectionSnapshot,
)
from groundmodel.infrastructure.exporters.cpt_trace_scale_constants import (
    CPT_GRID_LAYER,
    CPT_QC_LAYER,
    CPT_RF_LAYER,
)
from groundmodel.infrastructure.exporters.dxf_section_exporter import DxfSectionExporter

PROJECT_ID = UUID("00000000-0000-0000-0000-000000000001")
SECTION_ID = UUID("00000000-0000-0000-0000-000000000002")


def _snapshot(
    *,
    investigations: list[SectionInvestigationProjection] | None = None,
    formations: list[SectionFormation] | None = None,
) -> SectionSnapshot:
    return SectionSnapshot(
        project_id=PROJECT_ID,
        project_name="Antwerp port — quay 7",
        section_id=SECTION_ID,
        section_name="Section A-A'",
        section_length_m=100.0,
        crs_epsg=31370,
        vertical_datum_label="m TAW",
        investigations=investigations or [],
        formations=formations or [],
        contacts=[],
    )


def _fill(units: list[SectionPolygonUnit], polygons: list[SectionPolygon]) -> SectionPolygonSet:
    return SectionPolygonSet(
        project_id=PROJECT_ID,
        project_name="Antwerp port — quay 7",
        section_id=SECTION_ID,
        section_name="Section A-A'",
        section_length_m=100.0,
        crs_epsg=31370,
        vertical_datum_label="m TAW",
        column_positions_m=(10.0, 60.0),
        units=tuple(units),
        polygons=tuple(polygons),
    )


def _cpt(name: str, along: float, surface: float, depth: float) -> SectionInvestigationProjection:
    return SectionInvestigationProjection(
        investigation_id=uuid4(),
        kind="cpt",
        name=name,
        along_distance_m=along,
        surface_elevation_m=surface,
        total_depth_m=depth,
    )


def _parse(payload: bytes):  # type: ignore[no-untyped-def]
    return ezdxf.read(io.StringIO(payload.decode("utf-8")))


# ---------------------------------------------------------------------------
# The fill
# ---------------------------------------------------------------------------


def test_f1_each_region_is_an_outline_plus_a_solid_hatch_on_its_units_layer() -> None:
    """Each region is a closed outline plus a solid see-through hatch on its unit's layer."""
    sand = uuid4()
    unit = SectionPolygonUnit(
        formation_id=sand,
        name="Zand",
        nad_class=6,
        litho_main_soil_code="ZAND",
        color="#ffcc00",
        display_order=0,
    )
    region = SectionPolygon(
        formation_id=sand,
        points=((10.0, 12.0), (60.0, 11.5), (60.0, 5.5), (10.0, 6.0)),
        gap_index=0,
    )
    snap = _snapshot(
        formations=[
            SectionFormation(
                formation_id=sand,
                name="Zand",
                code=None,
                color="#ffcc00",
                display_order=0,
                nad_class=6,
                litho_main_soil_code="ZAND",
            )
        ]
    )
    doc = _parse(DxfSectionExporter().export(snap, fill=_fill([unit], [region])))
    msp = doc.modelspace()
    layer = "GeoModel-NAD-06_ZAND - Zand"
    outlines = list(msp.query(f"LWPOLYLINE[layer=='{layer}']"))
    assert len(outlines) == 1 and outlines[0].closed
    # The union may start the ring at another corner; the corner SET is the region.
    assert sorted(tuple(float(v) for v in p[:2]) for p in outlines[0].get_points()) == [
        (10.0, 6.0),
        (10.0, 12.0),
        (60.0, 5.5),
        (60.0, 11.5),
    ]
    hatches = list(msp.query(f"HATCH[layer=='{layer}']"))
    assert len(hatches) == 1
    assert hatches[0].dxf.solid_fill == 1
    assert hatches[0].rgb == (0xFF, 0xCC, 0x00)
    # The fill is see-through, so the contact lines and the curves stay readable.
    assert 0.0 < hatches[0].transparency < 1.0


def test_f2_a_unit_the_contact_snapshot_does_not_carry_still_gets_its_layer() -> None:
    """A fill unit the contact snapshot does not carry gets its layer and a mapping row."""
    # A litho fill can draw a unit that has no formation-pick contact on this
    # section (a lens from a neighbouring test). It must not be dropped, and
    # it keeps the same layer naming as every other unit.
    clay = uuid4()
    unit = SectionPolygonUnit(
        formation_id=clay,
        name="Klei",
        nad_class=None,
        litho_main_soil_code="KLEI",
        color="#8899aa",
        display_order=1,
    )
    region = SectionPolygon(
        formation_id=clay,
        points=((10.0, 6.0), (60.0, 5.5), (60.0, -2.5), (10.0, -2.0)),
        gap_index=0,
    )
    doc = _parse(DxfSectionExporter().export(_snapshot(), fill=_fill([unit], [region])))
    names = {layer.dxf.name for layer in doc.layers}
    assert "GeoModel-Klei" in names
    assert len(list(doc.modelspace().query("HATCH[layer=='GeoModel-Klei']"))) == 1
    # And the mapping table names it, so the DXF still says what the layer is.
    texts = [e.dxf.text for e in doc.modelspace().query("TEXT")]
    assert any("GeoModel-Klei" in t and "KLEI" in t for t in texts)


def test_f3_the_fill_is_drawn_under_the_lines() -> None:
    """The fill is drawn before the lines so CAD draws it under them."""
    # Entity order is draw order in CAD: hatches first, then the column lines.
    sand = uuid4()
    unit = SectionPolygonUnit(sand, "Zand", None, "ZAND", "#ffcc00", 0)
    region = SectionPolygon(sand, ((10.0, 12.0), (60.0, 11.5), (60.0, 5.5), (10.0, 6.0)), 0)
    snap = _snapshot(investigations=[_cpt("CPT-1", 10.0, 12.0, 6.0)])
    doc = _parse(DxfSectionExporter().export(snap, fill=_fill([unit], [region])))
    kinds = [e.dxftype() for e in doc.modelspace()]
    assert kinds.index("HATCH") < kinds.index("LINE")


def test_f4_with_a_fill_the_contact_to_contact_lines_are_not_drawn() -> None:
    """The fill's outlines carry every boundary; pick-to-pick lines are not the section.

    Owner 2026-09-27 on a DXF of CS1: "what are those weird lines in the dxf,
    those are not correlations I drew, nor are they the stratigraphical
    backdrop". They were the line drawing's per-unit polylines joining a
    unit's picks at consecutive columns, cutting across the hatched regions.
    """
    sand = uuid4()
    c1, c2 = _cpt("CPT-1", 10.0, 12.0, 8.0), _cpt("CPT-2", 60.0, 12.0, 8.0)
    contacts = [
        SectionFormationContact(uuid4(), sand, c1.investigation_id, 10.0, 0.0, 12.0),
        SectionFormationContact(uuid4(), sand, c2.investigation_id, 60.0, 2.0, 10.0),
    ]
    snap = _snapshot(
        investigations=[c1, c2],
        formations=[
            SectionFormation(sand, "Zand", None, "#ffcc00", 0, litho_main_soil_code="ZAND")
        ],
    )
    snap.contacts.extend(contacts)
    unit = SectionPolygonUnit(sand, "Zand", None, "ZAND", "#ffcc00", 0)
    region = SectionPolygon(sand, ((10.0, 12.0), (60.0, 10.0), (60.0, 5.0), (10.0, 6.0)), 0)
    doc = _parse(DxfSectionExporter().export(snap, fill=_fill([unit], [region])))
    on_unit_layer = list(doc.modelspace().query("LWPOLYLINE[layer=='GeoModel-Zand']"))
    # Only the region's closed outline; no open pick-to-pick line.
    assert [pl.closed for pl in on_unit_layer] == [True]
    # Without a fill (the stratigraphy axis, the legacy GET) the line stays.
    doc = _parse(DxfSectionExporter().export(snap))
    assert [pl.closed for pl in doc.modelspace().query("LWPOLYLINE[layer=='GeoModel-Zand']")] == [
        False
    ]


def test_f5_touching_regions_of_one_unit_are_one_body_with_no_seam_line() -> None:
    """Two clay regions that share an edge print as ONE outline and ONE hatch.

    Owner 2026-09-27 on the CS1 DXF, right of S8: "the constructor lines for
    the clay lenses are still there... it was merged into the clay body, so
    the lines disappear. that is fine in the app." The app hides the seam by
    colour; a DXF outline per region prints it. Per unit, touching regions
    are unioned before drawing.
    """
    clay = uuid4()
    unit = SectionPolygonUnit(clay, "Klei", None, "KLEI", "#8899aa", 1)
    band = SectionPolygon(clay, ((10.0, 6.0), (60.0, 5.5), (60.0, -2.5), (10.0, -2.0)), 0)
    # A clay "lens" that was merged into the band: shares the edge along x=10..40
    # at the band's top, and pokes 2 m above it.
    bump = SectionPolygon(clay, ((10.0, 8.0), (40.0, 5.7), (10.0, 6.0)), 0)
    doc = _parse(DxfSectionExporter().export(_snapshot(), fill=_fill([unit], [band, bump])))
    msp = doc.modelspace()
    assert len(list(msp.query("HATCH[layer=='GeoModel-Klei']"))) == 1
    outlines = list(msp.query("LWPOLYLINE[layer=='GeoModel-Klei']"))
    assert len(outlines) == 1 and outlines[0].closed
    # One ring whose area is the band plus the bump: the union, not one of them.
    from shapely.geometry import Polygon

    ring = Polygon([tuple(float(v) for v in p[:2]) for p in outlines[0].get_points()])
    expected = Polygon(band.points).area + Polygon(bump.points).area
    assert abs(ring.area - expected) < 1e-6


def test_f6_two_separate_bodies_of_one_unit_stay_two_hatches() -> None:
    """Union never glues regions that do not touch: two sand bodies stay two."""
    sand = uuid4()
    unit = SectionPolygonUnit(sand, "Zand", None, "ZAND", "#ffcc00", 0)
    top = SectionPolygon(sand, ((10.0, 12.0), (60.0, 11.5), (60.0, 9.5), (10.0, 10.0)), 0)
    deep = SectionPolygon(sand, ((10.0, -6.0), (60.0, -6.5), (60.0, -9.0), (10.0, -8.5)), 0)
    doc = _parse(DxfSectionExporter().export(_snapshot(), fill=_fill([unit], [top, deep])))
    assert len(list(doc.modelspace().query("HATCH[layer=='GeoModel-Zand']"))) == 2


# ---------------------------------------------------------------------------
# The CPT curves
# ---------------------------------------------------------------------------


def test_t1_qc_reads_to_the_right_of_the_column_and_rf_to_the_left_on_the_apps_scales() -> None:
    """qc reads rightward on the 40 MPa scale, Rf leftward on 10 %, inside a 4 m band."""
    cpt = _cpt("CPT-1", 10.0, 12.0, 2.0)
    trace = SectionCptTrace(
        investigation_id=cpt.investigation_id,
        depths_m=(0.0, 1.0, 2.0),
        qc_mpa=(0.0, 20.0, 40.0),  # 0, half, full of the 40 MPa scale
        rf_pct=(0.0, 5.0, 10.0),  # 0, half, full of the 10 % scale
    )
    snap = _snapshot(investigations=[cpt, _cpt("CPT-2", 30.0, 12.0, 2.0)])
    doc = _parse(DxfSectionExporter().export(snap, cpt_traces=[trace]))
    msp = doc.modelspace()
    qc = list(msp.query(f"LWPOLYLINE[layer=='{CPT_QC_LAYER}']"))
    rf = list(msp.query(f"LWPOLYLINE[layer=='{CPT_RF_LAYER}']"))
    assert len(qc) == 1 and len(rf) == 1
    # Band half-width: 4 m, but never more than 45 % of the 20 m to the neighbour → 4 m.
    qc_pts = [tuple(round(v, 6) for v in p[:2]) for p in qc[0].get_points()]
    assert qc_pts == [(10.0, 12.0), (12.0, 11.0), (14.0, 10.0)]
    rf_pts = [tuple(round(v, 6) for v in p[:2]) for p in rf[0].get_points()]
    assert rf_pts == [(10.0, 12.0), (8.0, 11.0), (6.0, 10.0)]


def test_t2_the_band_narrows_next_to_a_close_neighbour_and_a_value_off_scale_is_clamped() -> None:
    """The band narrows next to a close neighbour and an off-scale value clamps to the edge."""
    cpt = _cpt("CPT-1", 10.0, 12.0, 1.0)
    trace = SectionCptTrace(cpt.investigation_id, (0.0, 1.0), (80.0, 80.0), None)
    # Neighbour 4 m away → half-width 45 % of 4 m = 1.8 m.
    snap = _snapshot(investigations=[cpt, _cpt("CPT-2", 14.0, 12.0, 1.0)])
    doc = _parse(DxfSectionExporter().export(snap, cpt_traces=[trace]))
    qc = list(doc.modelspace().query(f"LWPOLYLINE[layer=='{CPT_QC_LAYER}']"))
    xs = {round(p[0], 6) for p in qc[0].get_points()}
    assert xs == {11.8}  # 80 MPa on a 40 MPa scale sits on the band's right edge
    assert not list(doc.modelspace().query(f"LWPOLYLINE[layer=='{CPT_RF_LAYER}']"))


def test_t3_a_missing_sample_breaks_the_curve_into_two_polylines() -> None:
    """A missing sample lifts the pen: two polylines."""
    cpt = _cpt("CPT-1", 10.0, 12.0, 4.0)
    trace = SectionCptTrace(
        cpt.investigation_id, (0.0, 1.0, 2.0, 3.0, 4.0), (5.0, 5.0, None, 5.0, 5.0), None
    )
    doc = _parse(DxfSectionExporter().export(_snapshot(investigations=[cpt]), cpt_traces=[trace]))
    qc = list(doc.modelspace().query(f"LWPOLYLINE[layer=='{CPT_QC_LAYER}']"))
    assert len(qc) == 2


def test_t4_the_scale_lines_and_labels_are_the_apps() -> None:
    """The 2 / 10 MPa and 2 / 4 % gridlines and the scale labels are the app's."""
    cpt = _cpt("CPT-1", 10.0, 12.0, 2.0)
    trace = SectionCptTrace(cpt.investigation_id, (0.0, 2.0), (5.0, 5.0), (1.0, 1.0))
    doc = _parse(DxfSectionExporter().export(_snapshot(investigations=[cpt]), cpt_traces=[trace]))
    msp = doc.modelspace()
    grid_x = sorted(round(e.dxf.start.x, 6) for e in msp.query(f"LINE[layer=='{CPT_GRID_LAYER}']"))
    # Rf 4 % and 2 % to the left (of 10 %), qc 2 and 10 MPa and the 40 MPa edge to the right.
    assert grid_x == [8.4, 9.2, 10.2, 11.0, 14.0]
    labels = sorted(e.dxf.text for e in msp.query(f"TEXT[layer=='{CPT_GRID_LAYER}']"))
    assert labels == ["10", "2", "2%", "4%", "40 MPa"]


def test_t5_a_borehole_and_a_cpt_without_a_series_draw_no_curve() -> None:
    """A borehole and a CPT without a series draw no curve."""
    cpt = _cpt("CPT-1", 10.0, 12.0, 2.0)
    bh = SectionInvestigationProjection(uuid4(), "borehole", "BH-1", 50.0, 12.0, 8.0)
    doc = _parse(DxfSectionExporter().export(_snapshot(investigations=[cpt, bh]), cpt_traces=[]))
    assert not list(doc.modelspace().query(f"LWPOLYLINE[layer=='{CPT_QC_LAYER}']"))

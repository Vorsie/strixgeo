"""Unit tests for the fence-diagram DXF exporter (v1.0 MVP gate, owner
ballot 2026-08-26).

The exporter is a pure ``Sequence[FenceExportPanel] -> bytes`` transform —
no DB, no network. We build small synthetic panels and assert:

* Happy path: two panels round-trip through ``ezdxf`` with the right
  3DFACE count, layer names, and vertex coordinates.
* The interior-edge helper hides exactly the shared diagonal of a quad
  (two triangles) and hides nothing for a single triangle.
* The layer-name sanitiser strips forbidden DXF characters, truncates
  over-long names, and disambiguates two names that collide after
  sanitising.
* A structural error (out-of-range triangle vertex index) is rejected by
  the request schema's validator rather than reaching the exporter.
* An empty panel list still produces a valid, parseable (empty) DXF.
"""

from __future__ import annotations

import io

import ezdxf
import pytest
from pydantic import ValidationError

from groundmodel.api.schemas.project.fence_export_request import (
    FenceExportPanel,
    FenceExportRequest,
)
from groundmodel.infrastructure.exporters.dxf_fence_exporter import (
    DxfFenceExporter,
    _disambiguate_layer_name,
    _sanitise_layer_name,
    interior_triangle_edges,
)
from groundmodel.infrastructure.exporters.dxf_layer_style import THIN_LAYER_LINEWEIGHT

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _panel(
    *,
    formation_id: str = "fm-1",
    body_id: str | None = None,
    name: str = "Sand",
    color: str = "#c2a15b",
    vertices: list[tuple[float, float, float]] | None = None,
    triangles: list[tuple[int, int, int]] | None = None,
) -> FenceExportPanel:
    return FenceExportPanel(
        formation_id=formation_id,
        body_id=body_id,
        name=name,
        color=color,
        vertices=vertices
        if vertices is not None
        else [(0.0, 0.0, 10.0), (1.0, 0.0, 10.0), (1.0, 0.0, 8.0), (0.0, 0.0, 8.0)],
        triangles=triangles if triangles is not None else [(0, 1, 2), (0, 2, 3)],
    )


def _parse_dxf(payload: bytes):  # type: ignore[no-untyped-def]
    """Reload the exported bytes through ezdxf so the test reads semantic
    DXF entities, not raw text. Catches malformed output that happens to
    grep-pass."""
    return ezdxf.read(io.StringIO(payload.decode("utf-8")))


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


def test_two_panels_round_trip_faces_layers_and_vertices() -> None:
    """Two panels on two formations -> two layers, 4 faces total, and every
    vertex round-trips byte-identical through the DXF."""
    panel_a = _panel(formation_id="fm-sand", name="Sand", color="#c2a15b")
    panel_b = _panel(
        formation_id="fm-clay",
        name="Clay",
        color="#4a7d3c",
        vertices=[(5.0, 5.0, 3.0), (6.0, 5.0, 3.0), (6.0, 5.0, 1.0)],
        triangles=[(0, 1, 2)],
    )

    payload = DxfFenceExporter().export(
        [panel_a, panel_b], project_name="Antwerp port — quay 7", crs_epsg=31370
    )
    assert payload, "exporter produced no bytes"

    doc = _parse_dxf(payload)
    faces = list(doc.modelspace().query("3DFACE"))
    assert len(faces) == 3  # panel_a has 2 triangles, panel_b has 1

    layer_names = {doc.layers.get(name).dxf.name for name in ("Fence-Sand", "Fence-Clay")}
    assert layer_names == {"Fence-Sand", "Fence-Clay"}

    sand_faces = [f for f in faces if f.dxf.layer == "Fence-Sand"]
    clay_faces = [f for f in faces if f.dxf.layer == "Fence-Clay"]
    assert len(sand_faces) == 2
    assert len(clay_faces) == 1

    clay_face = clay_faces[0]
    got_vertices = {
        (round(v.x, 6), round(v.y, 6), round(v.z, 6))
        for v in (clay_face.dxf.vtx0, clay_face.dxf.vtx1, clay_face.dxf.vtx2)
    }
    assert got_vertices == {(5.0, 5.0, 3.0), (6.0, 5.0, 3.0), (6.0, 5.0, 1.0)}

    assert doc.header.custom_vars.get("EPSG") == "31370"


def test_empty_panel_list_produces_valid_dxf() -> None:
    """No panels -> a valid, parseable DXF with zero faces (not a crash)."""
    payload = DxfFenceExporter().export([], project_name="Empty project", crs_epsg=None)
    assert payload
    doc = _parse_dxf(payload)
    assert list(doc.modelspace().query("3DFACE")) == []


def test_malformed_color_falls_back_to_default_rgb_without_crashing() -> None:
    """An unparseable colour string from the renderer must not block the
    export of otherwise-valid geometry — it lands on the default grey."""
    panel = _panel(color="not-a-color")
    payload = DxfFenceExporter().export([panel], project_name="p", crs_epsg=None)
    doc = _parse_dxf(payload)
    layer = doc.layers.get("Fence-Sand")
    assert layer.rgb == (128, 128, 128)


def test_missing_crs_omits_epsg_header_without_crashing() -> None:
    """A project with no resolvable EPSG still exports — just without the
    custom property, rather than raising."""
    payload = DxfFenceExporter().export([_panel()], project_name="Legacy project", crs_epsg=None)
    doc = _parse_dxf(payload)
    assert doc.header.custom_vars.get("EPSG") is None


def test_shared_diagonal_is_the_only_invisible_edge_in_the_dxf() -> None:
    """The quad's two triangles share the diagonal (0, 2) — after the
    round trip through DXF, exactly that edge is invisible on both
    faces; every boundary edge stays visible."""
    payload = DxfFenceExporter().export([_panel()], project_name="p", crs_epsg=None)
    doc = _parse_dxf(payload)
    faces = list(doc.modelspace().query("3DFACE"))
    assert len(faces) == 2
    # Each face hides exactly 2 edges: the degenerate closing edge (always
    # zero-length, ezdxf's vtx3 duplicates vtx2 for a 3-vertex face) + the
    # one shared diagonal edge. Total across both faces: 4.
    for f in faces:
        assert f.get_edges_visibility().count(False) == 2
    assert sum(f.get_edges_visibility().count(False) for f in faces) == 4


# ---------------------------------------------------------------------------
# interior_triangle_edges — pure topology helper
# ---------------------------------------------------------------------------


def test_interior_triangle_edges_quad_hides_only_the_shared_diagonal() -> None:
    """Two triangles forming a quad via diagonal (0, 2): triangle 0 is
    (0, 1, 2) -> its 'ca' edge is (2, 0); triangle 1 is (0, 2, 3) -> its
    'ab' edge is (0, 2). Both alias the same undirected diagonal, so both
    must flag interior=True there and nowhere else."""
    triangles = [(0, 1, 2), (0, 2, 3)]
    flags = interior_triangle_edges(triangles)
    assert flags == [
        (False, False, True),  # (0,1)=boundary, (1,2)=boundary, (2,0)=diagonal
        (True, False, False),  # (0,2)=diagonal, (2,3)=boundary, (3,0)=boundary
    ]


def test_interior_triangle_edges_single_triangle_hides_nothing() -> None:
    """A lone triangle has no neighbour to share an edge with — nothing hidden."""
    flags = interior_triangle_edges([(0, 1, 2)])
    assert flags == [(False, False, False)]


def test_interior_triangle_edges_empty_input() -> None:
    """No triangles -> no flags, and no crash on the empty Counter."""
    assert interior_triangle_edges([]) == []


# ---------------------------------------------------------------------------
# Layer-name sanitiser + disambiguation
# ---------------------------------------------------------------------------


def test_sanitise_layer_name_strips_forbidden_characters() -> None:
    """DXF-forbidden characters are stripped, not substituted."""
    assert _sanitise_layer_name('Sand/Clay:"lens"') == "Fence-SandClaylens"


def test_sanitise_layer_name_truncates_over_long_name() -> None:
    """AutoCAD truncates layer names at 255 characters; the sanitiser matches."""
    long_name = "x" * 400
    result = _sanitise_layer_name(long_name)
    assert len(result) == 255
    assert result.startswith("Fence-")


def test_disambiguate_layer_name_produces_a_free_name() -> None:
    """Two distinct formations whose display names sanitise to the same
    layer name must not collide — the second gets a short-id suffix."""
    taken = {"Fence-Sand"}
    result = _disambiguate_layer_name("Fence-Sand", "aaaaaaaa-bbbb-cccc", taken.__contains__)
    assert result != "Fence-Sand"
    assert result not in taken
    assert "aaaaaaaa" in result


def test_disambiguate_layer_name_widens_suffix_on_repeat_collision() -> None:
    """If even the short-id-suffixed name is taken, the helper keeps
    widening the suffix instead of looping forever or raising."""
    short_id = "deadbeef"
    first_candidate = f"Fence-Sand ({short_id})"
    taken = {"Fence-Sand", first_candidate}
    result = _disambiguate_layer_name("Fence-Sand", f"{short_id}-rest-of-uuid", taken.__contains__)
    assert result not in taken


def test_two_distinct_names_colliding_after_sanitising_land_on_different_layers() -> None:
    """End-to-end through the exporter: two panels whose names differ only
    by a forbidden character both sanitise to 'Fence-Sand' — they must not
    silently merge onto one layer."""
    panel_a = _panel(formation_id="fm-a", name="Sand")
    panel_b = _panel(formation_id="fm-b", name="Sand/")  # sanitises to the same "Sand"

    payload = DxfFenceExporter().export([panel_a, panel_b], project_name="p", crs_epsg=None)
    doc = _parse_dxf(payload)
    layer_names = {layer.dxf.name for layer in doc.layers if layer.dxf.name.startswith("Fence-")}
    assert len(layer_names) == 2


# ---------------------------------------------------------------------------
# Structural error — out-of-range triangle index
# ---------------------------------------------------------------------------


def test_out_of_range_triangle_index_rejected_by_request_validation() -> None:
    """A triangle referencing a vertex index beyond the panel's vertex list
    must fail request validation (-> HTTP 422) naming the panel and the
    offending index, never silently drop or clamp the face."""
    bad_panel = {
        "formation_id": "fm-1",
        "name": "Sand",
        "color": "#ffffff",
        "vertices": [(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (1.0, 1.0, 0.0)],
        "triangles": [(0, 1, 5)],  # 5 is out of range for a 3-vertex panel
    }
    with pytest.raises(ValidationError) as exc_info:
        FenceExportRequest(panels=[bad_panel])

    message = str(exc_info.value)
    assert "panel 0" in message
    assert "vertex index 5" in message


def test_in_range_triangle_indices_pass_validation() -> None:
    """Sanity check the validator's happy path: no false positives on a
    well-formed request."""
    request = FenceExportRequest(panels=[_panel()])
    assert len(request.panels) == 1


def test_ls5_exported_layers_carry_a_material_index_colour_and_a_thin_weight() -> None:
    """Owner 2026-08-28: "the white bounding lines are a bit thick".

    A 3DFACE's visible edges are drawn from the layer's INDEX colour and line
    weight, not from its true colour. Leaving those at their defaults (aci 7 =
    white, lineweight -3 = LWDEFAULT) outlined an ochre sand panel in a heavy
    white line. Both must now be set from the material.
    """
    panel = _panel(formation_id="fm-sand", name="Sand", color="#d4b84a")

    payload = DxfFenceExporter().export([panel], project_name="P", crs_epsg=31370)
    doc = ezdxf.read(io.StringIO(payload.decode("utf-8")))

    layer = next(lay for lay in doc.layers if lay.dxf.name.startswith("Fence-"))
    assert layer.rgb == (0xD4, 0xB8, 0x4A)
    # Not the default white/black index — the edge reads as the material.
    assert layer.color != 7
    # A real weight in 1/100 mm, not LWDEFAULT (-3).
    assert layer.dxf.lineweight == THIN_LAYER_LINEWEIGHT

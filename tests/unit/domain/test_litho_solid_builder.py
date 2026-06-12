"""Unit tests for the litho body-solid builder (no DB, no I/O)."""

from __future__ import annotations

import math

import pytest

from groundmodel.domain.services.litho_solid_builder import (
    BodyLayerPick,
    build_body_solids,
)
from groundmodel.domain.services.litho_solid_builder_constants import (
    MARKER_DISK_MIN_THICKNESS_M,
    MARKER_DISK_RADIUS_M,
    MARKER_DISK_SIDES,
)
from tests.unit.domain.mesh_test_helpers import (
    inside as _inside,
)
from tests.unit.domain.mesh_test_helpers import (
    is_closed_manifold as _is_closed_manifold,
)
from tests.unit.domain.mesh_test_helpers import (
    is_consistently_wound as _is_consistently_wound,
)
from tests.unit.domain.mesh_test_helpers import (
    make_pick as _pick,
)

# Six investigations forming a 2×3 grid — enough spread for a real TIN
# (non-collinear, no degenerate cases when all 6 are used).
PTS = [
    (0.0, 0.0),
    (50.0, 0.0),
    (100.0, 0.0),
    (0.0, 80.0),
    (50.0, 80.0),
    (100.0, 80.0),
]


def _slab_picks(body_id: str, formation_id: str, top: float, base: float) -> list[BodyLayerPick]:
    """Build one :class:`BodyLayerPick` per investigation in ``PTS``."""
    return [
        BodyLayerPick(
            investigation_id=f"inv{i}",
            x_m=x,
            y_m=y,
            surface_elev_m=12.0,
            body_id=body_id,
            formation_id=formation_id,
            top_depth_m=top,
            base_depth_m=base,
        )
        for i, (x, y) in enumerate(PTS)
    ]


def _one_pick(
    *,
    x: float = 10.0,
    y: float = 20.0,
    surface_elev: float = 5.0,
    top_depth: float = 1.0,
    base_depth: float = 4.0,
) -> list[BodyLayerPick]:
    """One pick at a configurable location + depth."""
    return [
        BodyLayerPick(
            investigation_id="inv0",
            x_m=x,
            y_m=y,
            surface_elev_m=surface_elev,
            body_id="b1",
            formation_id="ZAND",
            top_depth_m=top_depth,
            base_depth_m=base_depth,
        )
    ]


def test_through_going_body_is_a_closed_watertight_solid() -> None:
    """A body present on every investigation builds one closed manifold solid."""
    picks = _slab_picks("b1", "ZAND", top=2.0, base=6.0)
    meshes = build_body_solids(picks)
    assert len(meshes) == 1
    m = meshes[0]
    assert m.body_id == "b1"
    assert not m.is_flagged
    assert _is_closed_manifold(m.triangles)
    assert _is_consistently_wound(m.triangles)


def test_pinch_out_keeps_the_solid_watertight_and_zero_thickness_at_the_pinch() -> None:
    """Where the base meets the top the body thins to zero and stays watertight."""
    picks = _slab_picks("b1", "ZAND", top=2.0, base=6.0)
    # Make the last investigation a pinch: base depth == top depth (zero thickness).
    picks[5] = BodyLayerPick(
        investigation_id="inv5",
        x_m=100.0,
        y_m=80.0,
        surface_elev_m=12.0,
        body_id="b1",
        formation_id="ZAND",
        top_depth_m=2.0,
        base_depth_m=2.0,
    )
    meshes = build_body_solids(picks)
    assert len(meshes) == 1
    assert _is_closed_manifold(meshes[0].triangles)
    assert _is_consistently_wound(meshes[0].triangles)
    # A vertex pair (top, base) at the pinch has the same z — zero-thickness present.
    zs = [v[2] for v in meshes[0].vertices]
    assert any(abs(z - (12.0 - 2.0)) < 1e-9 for z in zs)


def test_degenerate_body_emits_disk_markers_not_empty_mesh() -> None:
    """A body on 2 investigations (can't fit a TIN) emits two closed cylinder
    disk markers — is_flagged=True with non-empty, manifold + wound geometry.
    """
    picks = _slab_picks("b1", "ZAND", top=2.0, base=6.0)[:2]  # only 2 points
    meshes = build_body_solids(picks)
    assert len(meshes) == 1
    m = meshes[0]
    assert m.is_flagged is True
    # Non-empty: two cylinders concatenated.
    assert len(m.vertices) > 0
    assert len(m.triangles) > 0
    # Two disjoint closed cylinders satisfy both manifold + winding invariants.
    assert _is_closed_manifold(m.triangles)
    assert _is_consistently_wound(m.triangles)


def test_single_pick_body_renders_one_disk_marker() -> None:
    """A body with exactly 1 pick emits one closed cylinder with the correct
    vertex/triangle counts.

    Vertex count = 2 cap centres + 2 * SIDES rim vertices = 2 + 2*SIDES.
    Triangle count = SIDES top cap + SIDES bottom cap + 2*SIDES wall = 4*SIDES.
    """
    picks = _one_pick()
    meshes = build_body_solids(picks)
    assert len(meshes) == 1
    m = meshes[0]
    assert m.is_flagged is True

    expected_verts = 2 + 2 * MARKER_DISK_SIDES
    expected_tris = 4 * MARKER_DISK_SIDES
    assert len(m.vertices) == expected_verts, (
        f"Expected {expected_verts} vertices; got {len(m.vertices)}"
    )
    assert len(m.triangles) == expected_tris, (
        f"Expected {expected_tris} triangles; got {len(m.triangles)}"
    )
    assert _is_closed_manifold(m.triangles)
    assert _is_consistently_wound(m.triangles)


def test_disk_marker_uses_real_thickness() -> None:
    """A pick with 4 m thickness (base_depth - top_depth = 4.0) produces a
    cylinder whose z-extent equals 4.0 m.
    """
    picks = _one_pick(surface_elev=10.0, top_depth=2.0, base_depth=6.0)
    meshes = build_body_solids(picks)
    m = meshes[0]
    assert m.is_flagged is True
    zs = [v[2] for v in m.vertices]
    assert max(zs) - min(zs) == pytest.approx(4.0, abs=1e-6)


def test_zero_thickness_pick_gets_min_thickness_disk() -> None:
    """A pick with top_depth == base_depth emits a cylinder with z-extent equal
    to MARKER_DISK_MIN_THICKNESS_M, centred on the pick's elevation.
    """
    surface_elev = 8.0
    depth = 3.0
    elev = surface_elev - depth
    picks = _one_pick(surface_elev=surface_elev, top_depth=depth, base_depth=depth)
    meshes = build_body_solids(picks)
    m = meshes[0]
    assert m.is_flagged is True
    zs = [v[2] for v in m.vertices]
    z_extent = max(zs) - min(zs)
    assert z_extent == pytest.approx(MARKER_DISK_MIN_THICKNESS_M, abs=1e-6)
    # Cylinder is centred on the pick elevation.
    z_mid = (max(zs) + min(zs)) / 2.0
    assert z_mid == pytest.approx(elev, abs=1e-6)
    assert _is_closed_manifold(m.triangles)
    assert _is_consistently_wound(m.triangles)


def test_disk_radius_matches_constant() -> None:
    """Rim vertices of a disk marker lie at exactly MARKER_DISK_RADIUS_M from
    the pick's (x, y) centre.
    """
    x, y = 100.0, 200.0
    picks = _one_pick(x=x, y=y, surface_elev=5.0, top_depth=1.0, base_depth=3.0)
    meshes = build_body_solids(picks)
    m = meshes[0]
    # The 2 centre vertices are at (x, y); all rim vertices are at radius R.
    # Filter out centre vertices (exactly at x, y) and measure radii of the rest.
    rim_verts = [v for v in m.vertices if not (abs(v[0] - x) < 1e-9 and abs(v[1] - y) < 1e-9)]
    assert len(rim_verts) == 2 * MARKER_DISK_SIDES, (
        f"Expected {2 * MARKER_DISK_SIDES} rim vertices; got {len(rim_verts)}"
    )
    for vx, vy, _vz in rim_verts:
        r = math.sqrt((vx - x) ** 2 + (vy - y) ** 2)
        assert r == pytest.approx(MARKER_DISK_RADIUS_M, abs=1e-6), (
            f"Rim vertex radius {r} != MARKER_DISK_RADIUS_M={MARKER_DISK_RADIUS_M}"
        )


def test_adjacent_bodies_share_the_contact_surface_exactly() -> None:
    """Body A's base picks == body B's top picks → the shared surface coincides
    vertex-for-vertex (watertight stack), because the builder caches one surface
    per contact."""
    sand = _slab_picks("sand", "ZAND", top=0.0, base=4.0)
    clay = _slab_picks("clay", "KLEI", top=4.0, base=9.0)  # clay top == sand base
    meshes = build_body_solids(sand + clay)
    by_id = {m.body_id: m for m in meshes}
    shared_elev = 12.0 - 4.0  # surface_elev_m - depth_m
    # Extract the full (x, y, z) vertex set that each body places on the shared contact.
    # The cache guarantee is that they reference IDENTICAL surface geometry, so the
    # sorted vertex sets must be equal — not merely overlapping.
    sand_shared = sorted(v for v in by_id["sand"].vertices if abs(v[2] - shared_elev) < 1e-6)
    clay_shared = sorted(v for v in by_id["clay"].vertices if abs(v[2] - shared_elev) < 1e-6)
    assert sand_shared, "sand mesh has no vertices at the shared contact elevation"
    assert clay_shared, "clay mesh has no vertices at the shared contact elevation"
    assert sand_shared == clay_shared, (
        "shared-contact vertex sets differ — cache did not produce identical surface geometry"
    )


def test_shared_interface_has_zero_gap_between_stacked_bodies() -> None:
    """M3: SAND.base and CLAY.top are the same shared surface (vertices coincide)."""
    quad = [(0, 0), (40, 0), (40, 40), (0, 40), (18, 22)]  # extra interior point
    picks = []
    for i, (x, y) in enumerate(quad):
        inv = f"q{i}"
        picks.append(
            BodyLayerPick(
                investigation_id=inv,
                x_m=x,
                y_m=y,
                surface_elev_m=0.0,
                body_id="SAND",
                formation_id="f1",
                top_depth_m=0.0,
                base_depth_m=4.0,
            )
        )
        picks.append(
            BodyLayerPick(
                investigation_id=inv,
                x_m=x,
                y_m=y,
                surface_elev_m=0.0,
                body_id="CLAY",
                formation_id="f2",
                top_depth_m=4.0,
                base_depth_m=14.0,
            )
        )
    meshes = {m.body_id: m for m in build_body_solids(picks)}
    sand_base = {
        (round(x, 5), round(y, 5)) for (x, y, z) in meshes["SAND"].vertices if abs(z + 4) < 1e-6
    }
    clay_top = {
        (round(x, 5), round(y, 5)) for (x, y, z) in meshes["CLAY"].vertices if abs(z + 4) < 1e-6
    }
    assert sand_base == clay_top and len(sand_base) == 5


def test_orchestrator_lens_void() -> None:
    """M3: an enclosed SILT lens is carved out of its CLAY matrix as a void."""
    outer = [("A", 0, 0), ("B", 20, 0), ("C", 20, 20), ("D", 0, 20)]
    inner = [("E", 8, 10), ("F", 12, 10), ("G", 10, 8), ("H", 10, 12)]
    picks = []
    for inv, x, y in outer:
        picks.append(
            BodyLayerPick(
                investigation_id=inv,
                x_m=x,
                y_m=y,
                surface_elev_m=0.0,
                body_id="CLAY",
                formation_id="f2",
                top_depth_m=4.0,
                base_depth_m=14.0,
            )
        )
    for inv, x, y in inner:
        for body, td, bd, fm in [
            ("CLAY", 4.0, 8.0, "f2"),
            ("SILT", 8.0, 10.0, "f3"),
            ("CLAY", 10.0, 14.0, "f2"),
        ]:
            picks.append(
                BodyLayerPick(
                    investigation_id=inv,
                    x_m=x,
                    y_m=y,
                    surface_elev_m=0.0,
                    body_id=body,
                    formation_id=fm,
                    top_depth_m=td,
                    base_depth_m=bd,
                )
            )
    meshes = {m.body_id: m for m in build_body_solids(picks)}
    clay = meshes["CLAY"]
    assert _is_closed_manifold(clay.triangles) and _is_consistently_wound(clay.triangles)
    assert not _inside(clay.vertices, clay.triangles, (10.0, 10.0, -9.0))  # in the lens void
    assert _inside(clay.vertices, clay.triangles, (2.0, 2.0, -9.0))  # in the clay


def test_no_two_body_solids_overlap():
    """M3 partition: every sampled interior point is inside at most one body solid."""
    holes = [(0, 0), (40, 0), (40, 40), (0, 40), (20, 20)]
    layers = [("SAND", 0, 4, "f1"), ("CLAY", 4, 14, "f2"), ("SAND2", 14, 24, "f3")]
    picks = []
    for i, (x, y) in enumerate(holes):
        for body, td, bd, fm in layers:
            picks.append(
                BodyLayerPick(
                    investigation_id=f"h{i}",
                    x_m=x,
                    y_m=y,
                    surface_elev_m=0.0,
                    body_id=body,
                    formation_id=fm,
                    top_depth_m=td,
                    base_depth_m=bd,
                )
            )
    meshes = build_body_solids(picks)
    for px in (5, 20, 35):
        for py in (5, 20, 35):
            for pz in (-2, -9, -19):
                hits = [m.body_id for m in meshes if _inside(m.vertices, m.triangles, (px, py, pz))]
                assert len(hits) <= 1, f"point {(px, py, pz)} in {hits}"


def test_lens_and_matrix_do_not_overlap() -> None:
    """M3 partition: SILT lens + CLAY matrix tile — every sampled point is in <=1 body.

    Geometry: 4 outer CLAY-only investigations (A–D on a 20×20 square) + 4
    inner investigations (E–H near the centre) that each carry CLAY/SILT/CLAY
    layers — identical to test_orchestrator_lens_void.  The lens void test
    confirms the CLAY mesh has a hole at the lens location; this test confirms
    the SILT mesh fills that hole without overlapping the surrounding CLAY.
    """
    outer = [("A", 0, 0), ("B", 20, 0), ("C", 20, 20), ("D", 0, 20)]
    inner = [("E", 8, 10), ("F", 12, 10), ("G", 10, 8), ("H", 10, 12)]
    picks = []
    for inv, x, y in outer:
        picks.append(
            BodyLayerPick(
                investigation_id=inv,
                x_m=x,
                y_m=y,
                surface_elev_m=0.0,
                body_id="CLAY",
                formation_id="f2",
                top_depth_m=4.0,
                base_depth_m=14.0,
            )
        )
    for inv, x, y in inner:
        for body, td, bd, fm in [
            ("CLAY", 4.0, 8.0, "f2"),
            ("SILT", 8.0, 10.0, "f3"),
            ("CLAY", 10.0, 14.0, "f2"),
        ]:
            picks.append(
                BodyLayerPick(
                    investigation_id=inv,
                    x_m=x,
                    y_m=y,
                    surface_elev_m=0.0,
                    body_id=body,
                    formation_id=fm,
                    top_depth_m=td,
                    base_depth_m=bd,
                )
            )
    meshes = build_body_solids(picks)

    # Partition invariant: no sampled point sits inside more than one body.
    # Points are chosen to exercise: lens interior, clay above/below the lens,
    # clay away from the lens, and the near-boundary clay zone.
    samples = [
        (10.0, 10.0, -9.0),  # inside the SILT lens (depth 8–10 m → z -8 to -10)
        (10.0, 10.0, -6.0),  # clay above the lens (depth 4–8 m)
        (10.0, 10.0, -12.0),  # clay below the lens (depth 10–14 m)
        (3.0, 3.0, -9.0),  # clay away from the lens (outer corner zone)
        (10.0, 10.0, -5.0),  # clay near the lens top boundary
    ]
    for pt in samples:
        hits = [m.body_id for m in meshes if _inside(m.vertices, m.triangles, pt)]
        assert len(hits) <= 1, f"point {pt} is inside multiple bodies: {hits}"

    # Sanity: the lens point must be owned by the SILT body — the partition is
    # not vacuously satisfied by both meshes being empty there.
    silt = next((m for m in meshes if m.body_id == "SILT"), None)
    assert silt is not None, "SILT body mesh was not produced"
    assert _inside(silt.vertices, silt.triangles, (10.0, 10.0, -9.0)), (
        "SILT mesh does not contain the lens-interior sample point — lens solid is hollow"
    )


def test_no_overlap_invariant_multi_patch_facies_model() -> None:
    """No sampled 3-D point is inside more than one solid in a two-shared-body facies model.

    Stack (shallowest → deepest, depth from ground surface at 0 m elevation):
    - CLAY  (depth 0–2): competitor above UPPER on A/B/C
    - SILT  (depth 0–2): competitor above UPPER on D/E/F
    - UPPER (depth 2–6): first shared body (≥2 neighbours above → facies path)
    - LOWER (depth 6–11): second shared body (≥2 neighbours below → facies path)
    - ZAND  (depth 11–16): competitor below LOWER on A/B/C
    - VEEN  (depth 11–16): competitor below LOWER on D/E/F

    Partition invariant: every interior 3-D sample point is inside AT MOST one body
    solid.  This is the model-wide no-overlap guarantee for the facies path.
    """
    ring = [
        ("A", 0, 0),
        ("B", 6, 1),
        ("C", 10, 6),
        ("D", 7, 11),
        ("E", 1, 10),
        ("F", -3, 5),
    ]
    all_picks: list[BodyLayerPick] = []
    for inv, x, y in ring:
        upper_comp = "CLAY" if inv in ("A", "B", "C") else "SILT"
        lower_comp = "ZAND" if inv in ("A", "B", "C") else "VEEN"
        surface_elev = 0.0
        all_picks.append(
            BodyLayerPick(
                investigation_id=inv,
                x_m=x,
                y_m=y,
                surface_elev_m=surface_elev,
                body_id=upper_comp,
                formation_id=upper_comp,
                top_depth_m=0.0,
                base_depth_m=2.0,
            )
        )
        all_picks.append(
            BodyLayerPick(
                investigation_id=inv,
                x_m=x,
                y_m=y,
                surface_elev_m=surface_elev,
                body_id="UPPER",
                formation_id="UPPER",
                top_depth_m=2.0,
                base_depth_m=6.0,
            )
        )
        all_picks.append(
            BodyLayerPick(
                investigation_id=inv,
                x_m=x,
                y_m=y,
                surface_elev_m=surface_elev,
                body_id="LOWER",
                formation_id="LOWER",
                top_depth_m=6.0,
                base_depth_m=11.0,
            )
        )
        all_picks.append(
            BodyLayerPick(
                investigation_id=inv,
                x_m=x,
                y_m=y,
                surface_elev_m=surface_elev,
                body_id=lower_comp,
                formation_id=lower_comp,
                top_depth_m=11.0,
                base_depth_m=16.0,
            )
        )

    meshes = build_body_solids(all_picks)
    # Expect 6 distinct body meshes: CLAY, SILT, UPPER, LOWER, ZAND, VEEN.
    by_id = {m.body_id: m for m in meshes}
    assert {"CLAY", "SILT", "UPPER", "LOWER", "ZAND", "VEEN"} <= set(by_id), (
        f"missing body meshes; got {set(by_id)}"
    )
    # Facies competitors must not be flagged disk markers.
    for comp in ("CLAY", "SILT", "ZAND", "VEEN"):
        assert not by_id[comp].is_flagged, (
            f"{comp} was built as disk markers — facies path not taken"
        )

    # Model-wide partition invariant: no sampled 3-D point is inside >1 body solid.
    # Sample a grid covering the entire column depth.
    all_meshes = list(by_id.values())
    # Points sampled at each layer's midpoint elevation (ground at z=0, depths go negative).
    claimed = 0  # count of sample points owned by exactly one body (partition coverage check)
    for px in (0, 3, 5, 7):
        for py in (2, 5, 8):
            for pz in (
                -1.0,  # inside the upper-competitor band (depth 0–2 → z 0..−2)
                -4.0,  # inside UPPER (depth 2–6 → z −2..−6)
                -8.5,  # inside LOWER (depth 6–11 → z −6..−11)
                -13.5,  # inside the lower-competitor band (depth 11–16 → z −11..−16)
            ):
                hits = [
                    m.body_id
                    for m in all_meshes
                    if _inside(m.vertices, m.triangles, (float(px), float(py), float(pz)))
                ]
                assert len(hits) <= 1, (
                    f"point ({px},{py},{pz}) is inside {len(hits)} bodies: {hits}"
                )
                if len(hits) == 1:
                    claimed += 1
    # Non-vacuity: the solids must actually cover interior points, not just be empty.
    # A model that built nothing would pass the <=1 check above trivially.
    assert claimed > 0, (
        "no sampled point fell inside any body solid — "
        "meshes appear to be empty or non-overlapping vacuously"
    )


def test_build_body_solids_facies_competitors_dont_overlap():
    """A multi-patch SAND with CLAY/SILT/PEAT above builds competitors that don't overlap.

    The 6 investigations form a ring — SAND is present on every one (multi-patch,
    ≥2 distinct bodies above it), so CLAY/SILT/PEAT must be built as clipped facies
    prisms (is_flagged=False), not degenerate disk markers, and they must partition
    the footprint without overlap.
    """
    ring = [
        ("A", 0, 0, "CLAY"),
        ("B", 6, 1, "CLAY"),
        ("C", 10, 6, "SILT"),
        ("D", 7, 11, "SILT"),
        ("E", 1, 10, "PEAT"),
        ("F", -3, 5, "PEAT"),
    ]
    picks = []
    for inv, x, y, up in ring:
        picks.append(
            BodyLayerPick(
                investigation_id=inv,
                x_m=x,
                y_m=y,
                surface_elev_m=0.0,
                body_id=up,
                formation_id=up,
                top_depth_m=0.0,
                base_depth_m=2.0,
            )
        )
        picks.append(
            BodyLayerPick(
                investigation_id=inv,
                x_m=x,
                y_m=y,
                surface_elev_m=0.0,
                body_id="SAND",
                formation_id="SAND",
                top_depth_m=2.0,
                base_depth_m=9.0,
            )
        )
    meshes = {m.body_id: m for m in build_body_solids(picks)}
    assert {"SAND", "CLAY", "SILT", "PEAT"} <= set(meshes)
    comps = [meshes[b] for b in ("CLAY", "SILT", "PEAT")]

    # Competitors must be real clipped prisms, not degenerate disk markers.
    # Disk markers are produced when the legacy path is taken for a <3-pick body
    # (2 investigations per competitor body here); the facies path must build
    # full coverage prisms instead.
    for m in comps:
        assert not m.is_flagged, (
            f"body {m.body_id} was built as disk markers (is_flagged=True); "
            "expected a real facies prism — facies path not taken"
        )

    # Each competitor must be a closed manifold (watertight prism).
    for b in ("CLAY", "SILT", "PEAT"):
        assert _is_closed_manifold(meshes[b].triangles), (
            f"body {b} facies prism is not a closed manifold"
        )

    # No two competitors cover the same point.
    for x in (0, 3, 5, 7):
        for y in (2, 5, 8):
            hits = [
                m.body_id
                for m in comps
                if _inside(m.vertices, m.triangles, (float(x), float(y), -1.0))
            ]
            assert len(hits) <= 1, (x, y, hits)
    assert _is_closed_manifold(meshes["SAND"].triangles)  # SAND continuous underneath


def test_facies_competitor_spanning_two_shared_bodies_concat() -> None:
    """One competitor lithology above TWO different shared bodies → a 2-part concat mesh.

    Two spatially separate hole-clusters, each a facies competition above its own
    shared body:

    * Cluster 1 (holes a0–a3): a shared body ``SH1`` with WEDGE above on a0/a1 and
      ``X`` above on a2/a3 → ``SH1`` has two distinct upper neighbours (multi-patch)
      → the facies path fires and emits a WEDGE prism for cluster 1.
    * Cluster 2 (holes b0–b3, offset far away): a shared body ``SH2`` with WEDGE
      above on b0/b1 and ``Y`` above on b2/b3 → emits a SECOND WEDGE prism.

    Because the competitor ``body_id`` is the SAME (``"WEDGE"``) in both clusters,
    ``build_body_solids`` accumulates both prisms under ``facies_meshes["WEDGE"]``
    and stitches them via ``_concat_meshes`` into ONE two-component mesh.  The gate:
    the WEDGE mesh exists, each of its two components is a closed manifold (the
    concat did not corrupt indices), and WEDGE does not overlap any other body.
    """
    # Cluster 1 around the origin; cluster 2 shifted far away (+1000 m x, +500 m y)
    # so the two footprints never share a Delaunay edge and are non-collinear.
    cluster1 = [
        ("a0", 0.0, 0.0, "WEDGE"),
        ("a1", 8.0, 0.0, "WEDGE"),
        ("a2", 8.0, 10.0, "X"),
        ("a3", 0.0, 10.0, "X"),
    ]
    # Cluster 2 is also offset in y so the two WEDGE patches are not collinear
    # with cluster 1 (a single flat line would make WEDGE's own footprint
    # un-triangulable).
    cluster2 = [
        ("b0", 1000.0, 500.0, "WEDGE"),
        ("b1", 1008.0, 500.0, "WEDGE"),
        ("b2", 1008.0, 510.0, "Y"),
        ("b3", 1000.0, 510.0, "Y"),
    ]
    picks: list[BodyLayerPick] = []
    for inv, x, y, upper in cluster1:
        picks.append(
            BodyLayerPick(
                investigation_id=inv,
                x_m=x,
                y_m=y,
                surface_elev_m=0.0,
                body_id=upper,
                formation_id=upper,
                top_depth_m=0.0,
                base_depth_m=2.0,
            )
        )
        picks.append(
            BodyLayerPick(
                investigation_id=inv,
                x_m=x,
                y_m=y,
                surface_elev_m=0.0,
                body_id="SH1",
                formation_id="SH1",
                top_depth_m=2.0,
                base_depth_m=9.0,
            )
        )
    for inv, x, y, upper in cluster2:
        picks.append(
            BodyLayerPick(
                investigation_id=inv,
                x_m=x,
                y_m=y,
                surface_elev_m=0.0,
                body_id=upper,
                formation_id=upper,
                top_depth_m=0.0,
                base_depth_m=2.0,
            )
        )
        picks.append(
            BodyLayerPick(
                investigation_id=inv,
                x_m=x,
                y_m=y,
                surface_elev_m=0.0,
                body_id="SH2",
                formation_id="SH2",
                top_depth_m=2.0,
                base_depth_m=9.0,
            )
        )

    meshes = {m.body_id: m for m in build_body_solids(picks)}
    assert "WEDGE" in meshes, "competitor WEDGE mesh was not produced"
    wedge = meshes["WEDGE"]
    assert not wedge.is_flagged, "WEDGE was built as disk markers — facies path not taken"
    assert len(wedge.vertices) > 0 and len(wedge.triangles) > 0

    # The concat is two disjoint closed solids: the whole-mesh edge-pairing check
    # (each undirected edge shared by exactly 2 triangles) holds iff the index
    # offsetting in _concat_meshes did not weld or corrupt the two parts.
    assert _is_closed_manifold(wedge.triangles), (
        "WEDGE concat mesh is not a closed 2-manifold — two-part index offset corrupted"
    )
    assert _is_consistently_wound(wedge.triangles)

    # WEDGE actually occupies BOTH clusters (non-vacuous: not just one prism).
    assert _inside(wedge.vertices, wedge.triangles, (2.0, 2.0, -1.0)), (
        "WEDGE mesh empty over cluster 1"
    )
    assert _inside(wedge.vertices, wedge.triangles, (1002.0, 502.0, -1.0)), (
        "WEDGE mesh empty over cluster 2"
    )

    # WEDGE does not overlap any other body across either cluster.
    others = [m for bid, m in meshes.items() if bid != "WEDGE"]
    for base_x, base_y in ((0.0, 0.0), (1000.0, 500.0)):
        for dx in (1.0, 4.0, 6.0):
            for dy in (2.0, 5.0, 8.0):
                pt = (base_x + dx, base_y + dy, -1.0)
                if not _inside(wedge.vertices, wedge.triangles, pt):
                    continue
                clashes = [m.body_id for m in others if _inside(m.vertices, m.triangles, pt)]
                assert not clashes, f"WEDGE overlaps {clashes} at {pt}"


def test_no_body_solid_dips_below_its_own_deepest_pick():
    """Builder invariant: every body mesh stays at or above its own deepest pick.

    A facies fixture (shallow SILT + deep CLAY competing below a shared SAND, on a
    non-collinear ring) is exactly the configuration that used to make the silt
    mesh sink below the clay.  For every returned body, the deepest mesh vertex
    must be no deeper than that body's own deepest member-pick base.
    """
    ring = [
        ("A", 0, 0, "SILT", 2.0, 4.0),
        ("B", 6, 1, "SILT", 2.0, 4.0),
        ("C", 10, 6, "SILT", 2.0, 4.0),
        ("D", 7, 11, "CLAY", 2.0, 12.0),
        ("E", 1, 10, "CLAY", 2.0, 12.0),
        ("F", -3, 5, "CLAY", 2.0, 12.0),
    ]
    picks = []
    for inv, x, y, lo, top_d, base_d in ring:
        picks.append(_pick(inv, x, y, "SAND", 0.0, 2.0))
        picks.append(_pick(inv, x, y, lo, top_d, base_d))

    deepest_pick: dict[str, float] = {}
    for p in picks:
        elev = p.surface_elev_m - p.base_depth_m
        deepest_pick[p.body_id] = min(deepest_pick.get(p.body_id, elev), elev)

    for mesh in build_body_solids(picks):
        if not mesh.vertices:
            continue
        mesh_min = min(z for (_x, _y, z) in mesh.vertices)
        assert mesh_min >= deepest_pick[mesh.body_id] - 1e-6, (
            f"body {mesh.body_id} mesh dips to {mesh_min}, "
            f"below its own deepest pick {deepest_pick[mesh.body_id]}"
        )

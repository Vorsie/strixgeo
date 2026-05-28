"""Unit tests for the lens-boundary geometry helper (#163f Slice 2 core).

Pure-domain: turns a lens boundary's anchor contacts + user control nodes +
a render style into the renderable polyline. No I/O, no ORM. See the design
spec docs/superpowers/specs/2026-05-28-litho-suggestion-handles-and-lens-shaping-design.md.
"""

from __future__ import annotations

from groundmodel.domain.services.lens_boundary_geometry import (
    LensBoundaryNode,
    compute_lens_boundary_polyline,
)


def test_straight_with_only_anchors_returns_anchors_sorted() -> None:
    """No control nodes + straight → the anchor endpoints, sorted by along_m."""
    pts = compute_lens_boundary_polyline(
        anchor_contacts=[(20.0, 15.0), (0.0, 10.0)],
        nodes=[],
        render_style="straight",
    )
    assert pts == [(0.0, 10.0), (20.0, 15.0)]


def test_straight_merges_nodes_sorted_by_along() -> None:
    """Interior control nodes merge with the anchors, sorted ascending by along_m."""
    pts = compute_lens_boundary_polyline(
        anchor_contacts=[(0.0, 10.0), (20.0, 10.0)],
        nodes=[LensBoundaryNode(along_m=10.0, elevation_m=18.0)],
        render_style="straight",
    )
    assert pts == [(0.0, 10.0), (10.0, 18.0), (20.0, 10.0)]


def test_nodes_in_any_input_order_are_sorted() -> None:
    """Nodes supplied out of order still come back sorted by along_m."""
    pts = compute_lens_boundary_polyline(
        anchor_contacts=[(0.0, 0.0), (30.0, 0.0)],
        nodes=[
            LensBoundaryNode(along_m=20.0, elevation_m=5.0),
            LensBoundaryNode(along_m=10.0, elevation_m=8.0),
        ],
        render_style="straight",
    )
    assert pts == [(0.0, 0.0), (10.0, 8.0), (20.0, 5.0), (30.0, 0.0)]


def test_blocky_expands_each_segment_into_a_midpoint_step() -> None:
    """Blocky style turns each segment into a staircase: a vertical step at the
    segment midpoint along_m. For P0=(0,10) P1=(10,20) the boundary becomes
    (0,10) (5,10) (5,20) (10,20)."""
    pts = compute_lens_boundary_polyline(
        anchor_contacts=[(0.0, 10.0), (10.0, 20.0)],
        nodes=[],
        render_style="blocky",
    )
    assert pts == [(0.0, 10.0), (5.0, 10.0), (5.0, 20.0), (10.0, 20.0)]


def test_blocky_chains_across_three_points() -> None:
    """Three points produce a continuous staircase with no duplicate vertices."""
    pts = compute_lens_boundary_polyline(
        anchor_contacts=[(0.0, 10.0), (20.0, 15.0)],
        nodes=[LensBoundaryNode(along_m=10.0, elevation_m=20.0)],
        render_style="blocky",
    )
    assert pts == [
        (0.0, 10.0),
        (5.0, 10.0),
        (5.0, 20.0),
        (10.0, 20.0),
        (15.0, 20.0),
        (15.0, 15.0),
        (20.0, 15.0),
    ]


def test_rounded_returns_verbatim_merged_points() -> None:
    """Rounded is a render-only detail (the frontend applies the Catmull-Rom
    curve), so the domain function returns the merged points verbatim — same
    point list as straight."""
    args = dict(
        anchor_contacts=[(0.0, 10.0), (20.0, 10.0)],
        nodes=[LensBoundaryNode(along_m=10.0, elevation_m=18.0)],
    )
    assert compute_lens_boundary_polyline(**args, render_style="rounded") == (
        compute_lens_boundary_polyline(**args, render_style="straight")
    )


def test_single_anchor_is_returned_as_is() -> None:
    """Degenerate one-point boundary (e.g. fully pinched) returns that point."""
    assert compute_lens_boundary_polyline(
        anchor_contacts=[(5.0, 12.0)], nodes=[], render_style="blocky"
    ) == [(5.0, 12.0)]

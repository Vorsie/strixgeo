"""T-A: prove the voxel-path watertight-flag is structurally zero.

``extract_body_solids`` hardcodes ``is_flagged=False`` on line 822 of
``extract_body_solids.py``.  The partition guarantee makes this correct BY
CONSTRUCTION: labelling 3-D space with body indices produces a partition; the
boundary of each body's voxel-set is a closed 2-manifold; a defective (non-
watertight) mesh cannot be emitted.  There is no runtime manifold checker that
could toggle the flag — the guarantee is structural, not checked.

This test verifies the invariant end-to-end for the public API surface:

* A 2x2x2 single-body cube → every returned mesh has ``is_flagged=False``.
* A two-body grid (each body 1 cell) → both meshes have ``is_flagged=False``.

``is_flagged=True`` could only be emitted by the retired strat-field
builder's ``_handle_flag_all`` fall-back (deleted with #237 — git history);
on the voxel path the column is structurally always ``False``.

How to verify this test has teeth: if ``extract_body_solids`` were modified to
set ``is_flagged=True`` on any body, the assertions below would immediately
fail.  The structural-zero claim is falsifiable by inspection of source line 822;
the test pins the *observed* output so any future change that breaks the
invariant surfaces as a regression.
"""

from __future__ import annotations

import numpy as np

from groundmodel.domain.services.voxel_litho.extract_body_solids import extract_body_solids
from groundmodel.domain.services.voxel_litho.voxel_types import LabelGrid


def _single_body_2x2x2_grid() -> LabelGrid:
    """A 2×2×2 grid fully occupied by one body (index 0).

    Produces a closed cube mesh with 12 triangles.  The body spans both
    label-index 0, so every cell is labelled 0.
    """
    body_id = "body-cube"
    labels = np.zeros((2, 2, 2), dtype=np.intp)  # all cells = body 0
    return LabelGrid(
        gx=np.array([0.0, 2.0]),
        gy=np.array([0.0, 2.0]),
        gz=np.array([0.0, 2.0]),
        labels=labels,
        body_id_by_index=(body_id,),
        formation_by_body={body_id: "SAND"},
    )


def _two_body_1x1x2_grid() -> LabelGrid:
    """A 1×1×2 grid: body 0 in the BOTTOM cell (gz=−1.0), body 1 in the TOP cell (gz=0.0).

    gz is an elevation coordinate (increases upward), so gz=−1.0 is the deeper
    cell and gz=0.0 is the shallower cell.  The body ids ("body-top" for the
    bottom cell, "body-bot" for the top cell) are inverted relative to their
    elevations — they are stable test identifiers, not semantic labels.

    Produces two touching cubes.  The shared face cancels (each body's XOR
    rule drops interior faces), so each body's mesh is a closed 5-faced box
    (6 faces minus the shared one → 5 quads → 10 triangles per body).
    """
    labels = np.array([[[0, 1]]], dtype=np.intp)  # shape (1, 1, 2)
    return LabelGrid(
        gx=np.array([0.0]),
        gy=np.array([0.0]),
        gz=np.array([-1.0, 0.0]),
        labels=labels,
        body_id_by_index=("body-top", "body-bot"),
        formation_by_body={"body-top": "KLEI", "body-bot": "ZAND"},
    )


def test_single_body_cube_is_flagged_false() -> None:
    """A single 2x2x2 body → the returned mesh has is_flagged=False.

    This is the voxel-path structural-zero: extract_body_solids hardcodes
    is_flagged=False (source line 822).  No runtime detector exists; the
    partition guarantee means the mesh is always watertight.
    """
    grid = _single_body_2x2x2_grid()
    meshes = extract_body_solids(grid)

    assert len(meshes) == 1, "expected exactly one mesh for the single body"
    mesh = meshes[0]
    assert mesh.is_flagged is False, (
        "is_flagged must be False on the voxel path — "
        "the partition guarantee makes non-watertight bodies impossible"
    )
    assert mesh.body_id == "body-cube"
    assert mesh.formation_id == "SAND"
    assert len(mesh.vertices) > 0, "mesh must have geometry"
    assert len(mesh.triangles) > 0, "mesh must have triangles"


def test_two_adjacent_bodies_both_flagged_false() -> None:
    """Two touching single-cell bodies → both meshes have is_flagged=False.

    The shared interior face cancels under the XOR rule, leaving closed
    5-face boxes.  Both bodies are structurally watertight regardless.
    """
    grid = _two_body_1x1x2_grid()
    meshes = extract_body_solids(grid)

    assert len(meshes) == 2, "expected one mesh per body"
    for mesh in meshes:
        assert mesh.is_flagged is False, (
            f"body {mesh.body_id}: is_flagged must be False — "
            "partition boundary is a closed 2-manifold by construction"
        )
    body_ids = {m.body_id for m in meshes}
    assert body_ids == {"body-top", "body-bot"}


def test_empty_body_label_is_skipped_not_flagged() -> None:
    """A body index that labels no voxel is silently skipped (no mesh emitted).

    ``extract_body_solids`` skips body indices with ``present.any() == False``
    rather than emitting an empty flagged placeholder — an empty flagged row
    was a persistence-layer concern of the retired strat builder, NOT a
    mesher concern.
    """
    # Body 0 occupies all cells; body 1 is registered but labels no cell.
    labels = np.zeros((1, 1, 1), dtype=np.intp)  # only body 0
    grid = LabelGrid(
        gx=np.array([0.0]),
        gy=np.array([0.0]),
        gz=np.array([0.0]),
        labels=labels,
        body_id_by_index=("body-present", "body-absent"),
        formation_by_body={"body-present": "SAND", "body-absent": "KLEI"},
    )
    meshes = extract_body_solids(grid)

    present_ids = {m.body_id for m in meshes}
    assert "body-present" in present_ids, "present body must produce a mesh"
    assert "body-absent" not in present_ids, (
        "body with no labelled voxels must be SKIPPED, not emitted as flagged"
    )
    for mesh in meshes:
        assert mesh.is_flagged is False

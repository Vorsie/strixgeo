groundmodel.domain.services.voxel_litho.extract_body_solids
===========================================================

.. CG-PAGE source=src/groundmodel/domain/services/voxel_litho/extract_body_solids.py complete=true

*Source file:* ``src/groundmodel/domain/services/voxel_litho/extract_body_solids.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-74

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/extract_body_solids.py
   :language: python
   :lines: 1-74
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the mesher of the 3-D litho builder: given a grid of voxels (cube-shaped cells) each already labelled with the body that fills it, this file extracts, for every body, the surface of its block of voxels as a watertight triangle mesh. It imports numpy, the greedy-meshing helpers, the labelled-grid value object and the body-mesh value object.

**Why it is here.** The design order is 'label space, then extract boundaries', and the docstring explains why that makes the result correct by construction: a labelling of space is a partition, so each body's block of voxels has a closed surface with no holes, and because any voxel can carry any body, interfingering and pinch-out are drawn exactly (which the earlier smooth-field builder could not do). A face is emitted only where the body is present on one side and absent on the other, so every interior face cancels and every boundary face appears once. A closed 2-manifold means a watertight surface with exactly two triangles along every edge; the docstring records the care taken over vertex welding so a diagonal voxel touch does not fuse four faces onto one edge and break that rule. Greedy meshing (merging many small same-body flat faces into a few big rectangles) then slashes the triangle count without moving any surface. A pure domain module that computes and does not act, so nothing inherits the logging base.

.. CG-EXPLANATION-END id=module-header

Function ``def _corner_coords``
-------------------------------

.. CG-BLOCK id=function:_corner_coords lines=75-104

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/extract_body_solids.py
   :language: python
   :lines: 75-104
   :lineno-match:

.. CG-EXPLANATION-START id=function:_corner_coords

**What this does.** Turns the n cell-centre coordinates of one grid axis into the n+1 coordinates of the cell corners, by stepping half a cell out on each side. A single-cell axis falls back to a unit half-width so the result is still well-formed.

**Why it is here.** The mesh is drawn on the cell corners, not the centres, and adjacent cells must share a corner coordinate bit-for-bit identical (the docstring's point), because that exact match is what makes two neighbouring bodies' touching faces weld watertight rather than leave a hairline crack. A private helper computed once and reused for all bodies.

.. CG-EXPLANATION-END id=function:_corner_coords

Function ``def _emit_merged_z_faces``
-------------------------------------

.. CG-BLOCK id=function:_emit_merged_z_faces lines=105-141

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/extract_body_solids.py
   :language: python
   :lines: 105-141
   :lineno-match:

.. CG-EXPLANATION-START id=function:_emit_merged_z_faces

**What this does.** For each horizontal (constant-height) plane of the grid, takes the body's top-or-bottom boundary faces in that plane, merges them into the largest possible rectangles, and appends each rectangle as one four-cornered quad (a four-sided face, two triangles) wound so it faces outward. It records a representative source cell alongside each quad.

**Why it is here.** Emitting one quad per merged rectangle instead of one per cell is the greedy meshing that cuts the triangle count, and the merged rectangle is the exact union of the cells it replaces, so no surface moves. The winding is set outward so the solid's inside and outside are unambiguous. The recorded source cell is needed later to weld a diagonal touch correctly. A private helper for the ±height faces.

.. CG-EXPLANATION-END id=function:_emit_merged_z_faces

Function ``def _emit_merged_y_faces``
-------------------------------------

.. CG-BLOCK id=function:_emit_merged_y_faces lines=142-174

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/extract_body_solids.py
   :language: python
   :lines: 142-174
   :lineno-match:

.. CG-EXPLANATION-START id=function:_emit_merged_y_faces

**What this does.** The same greedy merge for the north-and-south boundary faces: for each north-south plane it merges the body's faces into maximal rectangles and appends each as one outward-wound quad at that plane, with a representative source cell.

**Why it is here.** The three axes are handled by three near-identical helpers rather than one general one because each axis has its own corner-ordering for outward winding; keeping them separate keeps each winding literal and checkable. Same reason as the height faces: fewer triangles, identical surface. A private helper.

.. CG-EXPLANATION-END id=function:_emit_merged_y_faces

Function ``def _emit_merged_x_faces``
-------------------------------------

.. CG-BLOCK id=function:_emit_merged_x_faces lines=175-207

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/extract_body_solids.py
   :language: python
   :lines: 175-207
   :lineno-match:

.. CG-EXPLANATION-START id=function:_emit_merged_x_faces

**What this does.** The same greedy merge for the east-and-west boundary faces: for each east-west plane it merges the body's faces into maximal rectangles and appends each as one outward-wound quad at that plane, with a representative source cell.

**Why it is here.** Completes the set of three per-axis emitters, one per grid direction, each with its own outward winding written out literally. Same purpose: collapse coplanar same-body faces so a flat wall becomes a few triangles, not hundreds. A private helper.

.. CG-EXPLANATION-END id=function:_emit_merged_x_faces

Function ``def _build_body_mesh``
---------------------------------

.. CG-BLOCK id=function:_build_body_mesh lines=208-329

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/extract_body_solids.py
   :language: python
   :lines: 208-329
   :lineno-match:

.. CG-EXPLANATION-START id=function:_build_body_mesh

**What this does.** Builds the closed watertight surface of one body's block of voxels. It pads the presence mask with empty cells on every side, then for each of the six directions marks a face as boundary only where the body is present on one side and absent on the other. In greedy mode it merges those faces into rectangles and welds them by world position; in the plain mode it emits one quad per cell face and welds them edge by edge. It returns the welded corners and the outward-wound triangles.

**Why it is here.** The present-on-one-side rule (the docstring's XOR-presence test) is what guarantees the surface is closed: every shared interior face is present on both sides and cancels, every true boundary face survives once. The pad is what lets a body voxel sitting on the very edge of the grid still see an absent neighbour just outside, so the grid boundary does not leave an open face. All six directions use the rule because height is now a real axis: a body can occupy two separate depth ranges at one map point (vertical interfingering), so the top and bottom faces are not always boundaries. The winding table in the docstring fixes outward-facing triangles for every direction.

.. CG-EXPLANATION-END id=function:_build_body_mesh

Function ``def _coord_weld_subdivided``
---------------------------------------

.. CG-BLOCK id=function:_coord_weld_subdivided lines=330-388

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/extract_body_solids.py
   :language: python
   :lines: 330-388
   :lineno-match:

.. CG-EXPLANATION-START id=function:_coord_weld_subdivided

**What this does.** Takes the merged rectangles, splits each rectangle's outline at every point that is a corner of any rectangle in the whole model, welds the resulting corners together by their exact world position, and fan-triangulates each split outline into triangles.

**Why it is here.** Merging breaks the tidy whole-edge-to-whole-edge sharing that the per-cell weld relied on: a big merged face's long edge can be met in its middle by a perpendicular wall's corner, which would leave a T-junction (a vertex landing in the middle of another face's edge) and break watertightness. Splitting every merged edge at every rectangle corner turns that mid-edge meeting point into a genuine shared vertex, so no T-junction can survive (the docstring's Strategy A). Welding by exact world position works because two faces meeting at a lattice node hold a bit-identical coordinate triple there, so a dict keyed on the exact triple reproduces the shared vertices with no tolerance.

.. CG-EXPLANATION-END id=function:_coord_weld_subdivided

Function ``def _emit_per_cell_faces``
-------------------------------------

.. CG-BLOCK id=function:_emit_per_cell_faces lines=389-449

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/extract_body_solids.py
   :language: python
   :lines: 389-449
   :lineno-match:

.. CG-EXPLANATION-START id=function:_emit_per_cell_faces

**What this does.** The un-merged baseline: appends one outward-wound quad for every single boundary voxel face, with no greedy merging.

**Why it is here.** This is kept only so a regression test can prove the greedy merge moves no surface: it compares the merged mesh against this per-cell version. Production always uses the merged path; this exists as the honest reference the merge is checked against.

.. CG-EXPLANATION-END id=function:_emit_per_cell_faces

Function ``def _weld_and_triangulate``
--------------------------------------

.. CG-BLOCK id=function:_weld_and_triangulate lines=450-568

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/extract_body_solids.py
   :language: python
   :lines: 450-568
   :lineno-match:

.. CG-EXPLANATION-START id=function:_weld_and_triangulate

**What this does.** For the per-cell path, fuses the four independent corners of each quad into shared vertices, then triangulates. It uses union-find (a bookkeeping structure that groups items and can quickly report which group an item is in) to merge corner copies of the same lattice node, but only across proper seams: an edge shared by exactly two faces is welded, while an edge shared by four faces (a diagonal touch of two same-body cells) welds each cell's own two faces but never across the two cells.

**Why it is here.** A naive weld that fused every copy of a lattice node would turn a diagonal touch into an edge touched by four triangles, which the watertightness check rejects. Welding only across two-face seams, and closing each cell's own corner at a four-face touch, keeps the two boundary sheets pinched apart there, so every edge stays a proper two-triangle edge. A genuinely intrinsic pinch that still survives is handed to the sheet-splitter next.

.. CG-EXPLANATION-END id=function:_weld_and_triangulate

Function ``def _split_pinched_sheets``
--------------------------------------

.. CG-BLOCK id=function:_split_pinched_sheets lines=569-673

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/extract_body_solids.py
   :language: python
   :lines: 569-673
   :lineno-match:

.. CG-EXPLANATION-START id=function:_split_pinched_sheets

**What this does.** Repairs any remaining place where two of the body's boundary sheets touch only along one edge, leaving that edge shared by four triangles. It runs two passes: first it rebuilds vertex identity using only proper two-triangle adjacency, so two sheets that meet only at the pinch fall into separate pieces and get their own coincident vertices; then, for a pinch where the sheets reconnect elsewhere into one fan, it gives each pair of triangles its own midpoint on the shared edge so that edge is no longer a single four-triangle edge.

**Why it is here.** This is the last guarantee that the surface is a closed 2-manifold (exactly two triangles per edge), which the tests demand. Both fixes are geometrically silent: the extra vertices sit exactly on the original edge, so the surface does not move, only its bookkeeping splits. It is needed only on the per-cell path; the merged path's perimeter subdivision already leaves no such edges.

.. CG-EXPLANATION-END id=function:_split_pinched_sheets

Function ``def _split_pinched_edges_by_midpoint``
-------------------------------------------------

.. CG-BLOCK id=function:_split_pinched_edges_by_midpoint lines=674-768

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/extract_body_solids.py
   :language: python
   :lines: 674-768
   :lineno-match:

.. CG-EXPLANATION-START id=function:_split_pinched_edges_by_midpoint

**What this does.** The shared half of the pinch repair: for each edge still shared by four triangles, it splits the four into two dihedral pairs and gives each pair its own coincident midpoint on the edge, replacing that pair's edge with two half-edges.

**Why it is here.** Both the per-cell path and the greedy path can leave a genuine three-dimensional self-touch along one edge; this is the one routine both use to resolve it. The two midpoints sit at the same point but are distinct vertices, so the single four-triangle edge becomes two ordinary two-triangle edges without moving the surface.

.. CG-EXPLANATION-END id=function:_split_pinched_edges_by_midpoint

Function ``def _directed``
--------------------------

.. CG-BLOCK id=function:_directed lines=769-773

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/extract_body_solids.py
   :language: python
   :lines: 769-773
   :lineno-match:

.. CG-EXPLANATION-START id=function:_directed

**What this does.** A one-line test: returns true when a triangle walks a given edge in a given direction (from one named vertex to the other).

**Why it is here.** The pinch repair has to tell the two dihedral pairs apart by which way each triangle traverses the shared edge; this names that check in one place so the split logic reads cleanly. A private helper.

.. CG-EXPLANATION-END id=function:_directed

Function ``def extract_body_solids``
------------------------------------

.. CG-BLOCK id=function:extract_body_solids lines=774-832

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/extract_body_solids.py
   :language: python
   :lines: 774-832
   :lineno-match:

.. CG-EXPLANATION-START id=function:extract_body_solids

**What this does.** The public entry point. For every body in the labelled grid, in stable index order and skipping the void, it builds that body's presence mask, extracts its watertight surface, and packages the corners and triangles into a body-mesh object carrying the body id and its formation. A body whose index labels no voxel is skipped. A flag chooses the greedy path (production) or the un-merged baseline (the regression test).

**Why it is here.** Because each body's voxels are a slice of one partition of space, its surface is closed and no two bodies share an interior, so the whole model is watertight and non-overlapping by construction, which is the property the docstring and the design note stand on. Skipping an empty body yields no mesh rather than a degenerate one. The corner lattice is computed once and shared by every body so touching bodies weld exactly.

.. CG-EXPLANATION-END id=function:extract_body_solids


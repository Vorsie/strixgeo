groundmodel.domain.services.voxel_litho.smooth_body_solids
==========================================================

.. CG-PAGE source=src/groundmodel/domain/services/voxel_litho/smooth_body_solids.py complete=true

*Source file:* ``src/groundmodel/domain/services/voxel_litho/smooth_body_solids.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-69

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/smooth_body_solids.py
   :language: python
   :lines: 1-69
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces an optional post-process that relaxes the voxel mesher's staircase surface into a smoother one. It moves vertices only: no label, no triangle and no body identity changes. It imports numpy, the smoother's tuning constants and the body-mesh value object.

**Why it is here.** The mesher's surfaces are made of axis-aligned voxel faces, so a contact that dips across the model is drawn as a staircase that reads as blockiness rather than geology. This is debt #220, which the owner has ruled is NOT part of the first release, and nothing in the production build calls it, so the default model is bit-for-bit unchanged. The docstring explains why a relaxation is chosen over re-extracting with marching cubes: marching cubes gaps and overlaps at the triple junctions a stratigraphic model is full of and throws away the greedy merge. Because the mesher gives abutting bodies coincident faces, the smoother can weld all bodies' vertices into one set of world positions, relax once, and write the result back to every body that touched each position, so a contact moves as one surface and no crack can open and no body can cross another. The half-a-voxel displacement bound keeps it honest: that is exactly the rounding error being corrected, so the smoother can never claim more ground than the voxelisation cost. A pure domain module that computes and does not act, so nothing inherits the logging base.

.. CG-EXPLANATION-END id=module-header

Function ``def _rectangle_corners``
-----------------------------------

.. CG-BLOCK id=function:_rectangle_corners lines=70-103

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/smooth_body_solids.py
   :language: python
   :lines: 70-103
   :lineno-match:

.. CG-EXPLANATION-START id=function:_rectangle_corners

**What this does.** Tests whether four positions are the four corners of one axis-aligned rectangle, and if so reports which axis is constant. It rejects anything else.

**Why it is here.** The diagonal-canonicalising pass below only wants to re-cut faces that really are flat lattice rectangles; a bent or degenerate quad it does not understand is left alone. A private helper.

.. CG-EXPLANATION-END id=function:_rectangle_corners

Function ``def _traversal``
---------------------------

.. CG-BLOCK id=function:_traversal lines=104-126

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/smooth_body_solids.py
   :language: python
   :lines: 104-126
   :lineno-match:

.. CG-EXPLANATION-START id=function:_traversal

**What this does.** Given a triangle and the two ends of an edge, reports the direction the triangle walks that edge plus its third vertex, or nothing when the triangle does not carry the edge.

**Why it is here.** Re-cutting a shared square along a chosen diagonal needs to know how each of the two triangles is wound relative to the shared edge; this names that lookup once. A private helper.

.. CG-EXPLANATION-END id=function:_traversal

Function ``def canonicalise_shared_diagonals``
----------------------------------------------

.. CG-BLOCK id=function:canonicalise_shared_diagonals lines=127-220

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/smooth_body_solids.py
   :language: python
   :lines: 127-220
   :lineno-match:

.. CG-EXPLANATION-START id=function:canonicalise_shared_diagonals

**What this does.** Re-cuts every shared voxel face so both bodies that meet at it split the square along the SAME diagonal, choosing the diagonal by a property of the corner positions so both sides pick it independently. It moves no vertex and adds or drops no triangle, and it leaves any face the pinch repair already re-cut untouched.

**Why it is here.** The mesher triangulates each body's copy of a shared face from that body's own outward corner order, which runs opposite ways on the two sides, so the two copies split along opposite diagonals. That is harmless while the corners are flat on the lattice, but once the smoother moves them the two surfaces part company, gapping along the contact and interpenetrating beside it by up to a quarter of a voxel. Choosing the diagonal from the positions makes both bodies agree. It leaves already-repaired faces alone because churning geometry it does not understand would trade a known state for an unknown one. Intended for the un-merged extraction, since a merged face can span several partners and has no single partner to agree with.

.. CG-EXPLANATION-END id=function:canonicalise_shared_diagonals

Function ``def signed_volume_m3``
---------------------------------

.. CG-BLOCK id=function:signed_volume_m3 lines=221-248

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/smooth_body_solids.py
   :language: python
   :lines: 221-248
   :lineno-match:

.. CG-EXPLANATION-START id=function:signed_volume_m3

**What this does.** Computes the volume a closed outward-wound mesh encloses, by summing the signed volumes of the tetrahedra from the origin to each triangle (the divergence theorem).

**Why it is here.** It measures a voxel body and its smoothed version on exactly the same footing regardless of shape, so a volume difference between them is a statement about the smoother rather than about the measuring method. Used to check the relaxation is roughly volume-preserving.

.. CG-EXPLANATION-END id=function:signed_volume_m3

Function ``def boundary_area_m2``
---------------------------------

.. CG-BLOCK id=function:boundary_area_m2 lines=249-272

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/smooth_body_solids.py
   :language: python
   :lines: 249-272
   :lineno-match:

.. CG-EXPLANATION-START id=function:boundary_area_m2

**What this does.** Sums the area of every triangle of a mesh, in square metres.

**Why it is here.** A staircase covers strictly more surface than the ramp between its two ends, so total surface area is the direct measure of how much blockiness remains after smoothing. Used to quantify the smoother's effect.

.. CG-EXPLANATION-END id=function:boundary_area_m2

Function ``def _weld_positions``
--------------------------------

.. CG-BLOCK id=function:_weld_positions lines=273-308

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/smooth_body_solids.py
   :language: python
   :lines: 273-308
   :lineno-match:

.. CG-EXPLANATION-START id=function:_weld_positions

**What this does.** Fuses every body's vertices into one set of distinct world positions, and returns those positions, a map from each stacked vertex to its position, and one slice per body into the stacked list.

**Why it is here.** Abutting bodies hold bit-identical coordinate triples where they meet, because the mesher derives every vertex from the same shared corner arrays, so grouping on the exact triple recovers the model's contact surfaces with no tolerance and moving a group moves both its bodies identically. This is what lets the smoother treat a contact as a single shared surface. A private helper.

.. CG-EXPLANATION-END id=function:_weld_positions

Function ``def _neighbour_sums``
--------------------------------

.. CG-BLOCK id=function:_neighbour_sums lines=309-332

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/smooth_body_solids.py
   :language: python
   :lines: 309-332
   :lineno-match:

.. CG-EXPLANATION-START id=function:_neighbour_sums

**What this does.** For every node, computes the average position of its edge-neighbours, or leaves an isolated node at its own position. It does this in bulk with numpy's scatter-add (vectorisation, meaning one array operation over all edges at once rather than a Python loop).

**Why it is here.** Smoothing pulls each vertex toward the average of its neighbours, so this neighbour-mean is the core of every pass; doing it as a vectorised array operation keeps it fast on the real model's roughly 1.6 million edges. A private helper.

.. CG-EXPLANATION-END id=function:_neighbour_sums

Function ``def _distinct_edges``
--------------------------------

.. CG-BLOCK id=function:_distinct_edges lines=333-379

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/smooth_body_solids.py
   :language: python
   :lines: 333-379
   :lineno-match:

.. CG-EXPLANATION-START id=function:_distinct_edges

**What this does.** Collects the distinct undirected edges of the whole model's surface, taken as the union across all bodies, each edge stored once as a low/high node pair. It keys each edge as a single integer for a fast unique.

**Why it is here.** Taking the union across bodies is deliberate: at a contact both bodies contribute the same edges and away from it each contributes its own, so a node on a contact is relaxed against every surface that actually meets there rather than one body's private view. The single-integer key is chosen because a sort on scalars is far cheaper than a sort on pairs at the real model's edge count. A private helper.

.. CG-EXPLANATION-END id=function:_distinct_edges

Function ``def _pin_mask``
--------------------------

.. CG-BLOCK id=function:_pin_mask lines=380-411

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/smooth_body_solids.py
   :language: python
   :lines: 380-411
   :lineno-match:

.. CG-EXPLANATION-START id=function:_pin_mask

**What this does.** Marks the nodes that must be held exactly in place, being those within a given radius of any supplied map-plane column position. With no columns or a zero radius it pins nothing.

**Why it is here.** An honoured investigation's own column is ground the model was told, not ground it estimated, so vertices there should not drift under smoothing. The docstring warns a pin can only catch vertices that exist: the greedy merge may collapse a flat stretch into one rectangle with no vertex at the column, so a caller depending on the hold must count the nodes actually caught rather than assume the radius covered any. A private helper.

.. CG-EXPLANATION-END id=function:_pin_mask

Function ``def smooth_body_solids``
-----------------------------------

.. CG-BLOCK id=function:smooth_body_solids lines=412-529

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/smooth_body_solids.py
   :language: python
   :lines: 412-529
   :lineno-match:

.. CG-EXPLANATION-START id=function:smooth_body_solids

**What this does.** The public entry point. It welds all bodies' vertices into one set of positions, runs the requested number of Taubin smoothing passes over the combined surface, clamps each node's total move to half a voxel per axis, optionally holds nodes near honoured columns fixed, and writes the moved positions back into every body that touched them. The triangle lists and vertex counts are unchanged.

**Why it is here.** Keeping the topology untouched means each body is still the closed watertight surface the mesher made and no two bodies can interpenetrate across a shared contact, which is the whole reason the smoother relaxes shared positions rather than re-meshing. Taubin's alternating pair is used instead of a plain smoothing pass because a plain pass would shrink every body a little on every iteration. The per-axis half-voxel clamp is applied per axis because the vertical grid is usually much finer than the horizontal, and it is the faithfulness bound: no vertex ends further from where the mesher put it than the rounding error being corrected. Zero iterations returns the input unchanged, which is the opt-out.

.. CG-EXPLANATION-END id=function:smooth_body_solids


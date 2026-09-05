groundmodel.domain.services.voxel_litho.greedy_mesh
===================================================

.. CG-PAGE source=src/groundmodel/domain/services/voxel_litho/greedy_mesh.py complete=true

*Source file:* ``src/groundmodel/domain/services/voxel_litho/greedy_mesh.py``

.. contents::
   :local:
   :depth: 1

Module header — docstring, imports and constants
------------------------------------------------

.. CG-BLOCK id=module-header lines=1-86

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/greedy_mesh.py
   :language: python
   :lines: 1-86
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Introduces the greedy mesher and imports its tools. *Greedy meshing* means collapsing many small, flat, same-body cell faces of one direction into a few large rectangles, so a flat wall that would naively become hundreds of triangles becomes a handful. The docstring explains the merge moves no surface — each merged rectangle is the exact union of the cell faces it replaces — so the result stays *watertight* (a closed surface with exactly two triangles meeting at every edge, called a closed 2-manifold).

**Why it is here.** The docstring records the real difficulty and the chosen strategy. Merging flat faces is the easy nine tenths; the hard part is a T-junction, where a merged face's long edge is met in its middle by a perpendicular wall's corner, leaving that edge shared by the wrong number of triangles — which the watertightness check rejects, and which real blobby bodies hit in their hundreds. The fix is subdivide-then-pinch-split: insert a shared vertex at every rectangle corner that lands on another rectangle's edge, so no T-junction can survive, then resolve genuine 3-D self-touches with a midpoint split. A known minor limit is honestly recorded: the fan triangulation emits some zero-area sliver triangles that are inert but load-bearing, so they cannot simply be filtered. The last paragraph flags the one Numba-compiled hot kernel — Numba is a library that compiles a heavy number-crunching Python function to fast machine code — compiled lazily so it stays off the boot path.

.. CG-EXPLANATION-END id=module-header

Function ``def _maximal_rectangles_kernel``
-------------------------------------------

.. CG-BLOCK id=function:_maximal_rectangles_kernel lines=87-153

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/greedy_mesh.py
   :language: python
   :lines: 87-153
   :lineno-match:

.. CG-EXPLANATION-START id=function:_maximal_rectangles_kernel

**What this does.** The native greedy rectangle-cover kernel. It scans the boolean face mask row by row; at the first uncovered face cell it grows a rectangle as far right as the row of present cells allows, then as far down as every cell of the next row over that span is also present, records the rectangle, marks its cells covered, and repeats until none remain. It returns the rectangles as a compact integer array.

**Why it is here.** The docstring records that this is the voxel build's dominant hotspot — mesh extraction was measured at 93.6 percent this one function — so it is compiled to native code with Numba, running 38.6 times faster than the pure-numpy version on the real workload while producing byte-identical rectangles over 113,796 masks. This is exactly the CLAUDE.md rule that Numba is adopted only for a profiled hotspot. Two details are Numba's own constraints: the code must preallocate its output array rather than grow a list, so it first counts an upper bound on the rectangle count, and ``cache=True`` on the compiled form persists the kernel so only the first call of a session pays the roughly 0.6 second warm-up.

.. CG-EXPLANATION-END id=function:_maximal_rectangles_kernel

Function ``def _maximal_rectangles_compiled``
---------------------------------------------

.. CG-BLOCK id=function:_maximal_rectangles_compiled lines=154-176

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/greedy_mesh.py
   :language: python
   :lines: 154-176
   :lineno-match:

.. CG-EXPLANATION-START id=function:_maximal_rectangles_compiled

**What this does.** Compiles the kernel above with Numba the first time it is asked for, and hands back the compiled function. It caches the result so the compilation happens once per session, and imports Numba only inside the function body.

**Why it is here.** The docstring is explicit: importing this module happens at boot, when the engine registers its routes, and boot must NOT drag in Numba, because Numba's compiler back-end is a large slice of the packaged cold-start budget (about 119 MB of shared libraries scanned off disk on first touch) and boot never meshes anything. Deferring the import to the first Build keeps it off the boot path. ``cache=True`` persists the compiled kernel across sessions exactly as the older always-compiled form did, so the mesh output stays byte-identical.

.. CG-EXPLANATION-END id=function:_maximal_rectangles_compiled

Function ``def maximal_rectangles``
-----------------------------------

.. CG-BLOCK id=function:maximal_rectangles lines=177-216

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/greedy_mesh.py
   :language: python
   :lines: 177-216
   :lineno-match:

.. CG-EXPLANATION-START id=function:maximal_rectangles

**What this does.** The public wrapper around the kernel. It makes the mask a contiguous boolean block, runs the compiled greedy cover on it, and converts the compact integer result into the list of rectangle tuples the mesher expects. Each rectangle is given as a half-open cell range.

**Why it is here.** This is the core primitive of greedy meshing: it exactly partitions the present cells of a face mask with no overlap and full coverage, collapsing a full block to one rectangle and an L-shape to two, which is all the boundary-face sets need. The docstring notes it is greedy (it takes the biggest rectangle at each anchor) rather than provably minimal, which is good enough here. A comment explains it must hand the kernel a contiguous boolean array because the mesher passes in strided slices of the 3-D boundary mask, and it converts the kernel's output back to plain tuples for its callers.

.. CG-EXPLANATION-END id=function:maximal_rectangles

Function ``def subdivision_nodes``
----------------------------------

.. CG-BLOCK id=function:subdivision_nodes lines=217-244

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/greedy_mesh.py
   :language: python
   :lines: 217-244
   :lineno-match:

.. CG-EXPLANATION-START id=function:subdivision_nodes

**What this does.** Collects every lattice corner across all the merged boundary rectangles into one set. A *set* is an unordered collection with no duplicates. It simply gathers the four corners of every rectangle.

**Why it is here.** This is the heart of the anti-T-junction strategy. The docstring explains a node that is a corner of one rectangle but lands in the middle of another rectangle's edge is exactly a T-junction site; inserting a vertex there turns it into a shared, paired vertex. Taking the union over all six face directions is what catches the breaking case: a perpendicular wall's corner touching a flat cap's merged edge is included, which is what the naive merge got wrong.

.. CG-EXPLANATION-END id=function:subdivision_nodes

Function ``def triangulate_subdivided_rect``
--------------------------------------------

.. CG-BLOCK id=function:triangulate_subdivided_rect lines=245-303

.. literalinclude:: ../../../src/groundmodel/domain/services/voxel_litho/greedy_mesh.py
   :language: python
   :lines: 245-303
   :lineno-match:

.. CG-EXPLANATION-START id=function:triangulate_subdivided_rect

**What this does.** Turns one merged rectangle into triangles, splitting each of its four edges at every subdivision node that lies on it. It walks the four edges to build the ordered list of perimeter nodes (each corner, plus any subdivision node strictly between two corners), then fans triangles out from the first perimeter node, all wound the same way outward.

**Why it is here.** This is where the T-junction fix actually reshapes the mesh: because every inserted node lies exactly on the rectangle's edge, the triangles still cover the rectangle exactly (no surface moves) and every unit sub-edge becomes a triangle edge that pairs with the perpendicular wall, so no T-junction survives. The docstring is honest about the cost: because the fan apex sits on its two subdivided edges, the fan emits some zero-area sliver triangles; they move no surface and ray-casting ignores them, but they are load-bearing (each carries a boundary sub-edge that must pair with a neighbour) so they must not be filtered, and removing them properly is a deferred quality refinement, not a correctness fix.

.. CG-EXPLANATION-END id=function:triangulate_subdivided_rect


desktop.renderer.src.utils.geotechHierarchicalFill.constructive.faceAdjacency
=============================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/faceAdjacency.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/faceAdjacency.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-31

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/faceAdjacency.ts
   :language: typescript
   :lines: 1-31
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the module that gives the arrangement's own adjacency — which loops lie against which — on the merge's own grid. A planar arrangement is the complete tiling of the gap into faces (closed loops) that the drawn lines produce; two faces are adjacent when they share a boundary edge. It imports the face-point type.

**Why it is here.** The docstring records that two rules — the pocket rule and the least-dense leftover — both ask which faces border which, and both must read it the way the merge will: an exact shared-edge test on the vertex grid, with no distance test and no tolerance. Read any other way, a face re-owned on this evidence would land beside its new mass as a second region with an invisible seam instead of welding into it.

.. CG-EXPLANATION-END id=module-header

``const GRID``
--------------

.. CG-BLOCK id=const:GRID lines=32-33

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/faceAdjacency.ts
   :language: typescript
   :lines: 32-33
   :lineno-match:

.. CG-EXPLANATION-START id=const:GRID

**What this does.** A constant, 1e7 — the vertex quantisation, the same grid the merge welds on.

**Why it is here.** Two faces are counted adjacent here exactly when the merge would call their shared edge interior, so using the merge's own grid is what lets a re-owned face weld into its new mass rather than sit beside it as a separate region.

.. CG-EXPLANATION-END id=const:GRID

``const vertexKey``
-------------------

.. CG-BLOCK id=const:vertexKey lines=34-37

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/faceAdjacency.ts
   :language: typescript
   :lines: 34-37
   :lineno-match:

.. CG-EXPLANATION-START id=const:vertexKey

**What this does.** Turns a face point into a string key by rounding its fraction and elevation to the grid.

**Why it is here.** Quantising the coordinates makes two points that are meant to be the same vertex land on the same key despite float noise.

.. CG-EXPLANATION-END id=const:vertexKey

``const edgeKey``
-----------------

.. CG-BLOCK id=const:edgeKey lines=38-49

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/faceAdjacency.ts
   :language: typescript
   :lines: 38-49
   :lineno-match:

.. CG-EXPLANATION-START id=const:edgeKey

**What this does.** Builds the undirected identity of a ring edge from its two vertex keys, ordered so either direction produces the same string.

**Why it is here.** An edge shared by two faces is the same edge seen from either side, so its key must be independent of which way round it is walked.

.. CG-EXPLANATION-END id=const:edgeKey

``function dedupe``
-------------------

.. CG-BLOCK id=function:dedupe lines=50-71

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/faceAdjacency.ts
   :language: typescript
   :lines: 50-71
   :lineno-match:

.. CG-EXPLANATION-START id=function:dedupe

**What this does.** Drops consecutive duplicate vertices, and the wrap-around duplicate, from a ring.

**Why it is here.** So the loop's edges are real edges and not zero-length ones, which would otherwise confuse the shared-edge test.

.. CG-EXPLANATION-END id=function:dedupe

``function sharedEdgePairs``
----------------------------

.. CG-BLOCK id=function:sharedEdgePairs lines=72-95

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/faceAdjacency.ts
   :language: typescript
   :lines: 72-95
   :lineno-match:

.. CG-EXPLANATION-START id=function:sharedEdgePairs

**What this does.** Returns every pair of loops that share an edge, one entry per shared edge.

**Why it is here.** A planar arrangement gives each edge exactly two faces, so one entry per shared edge is the whole of the adjacency. Pairs come back in the order the second face of each was met, which makes the result a function of the input order alone and therefore reproducible.

.. CG-EXPLANATION-END id=function:sharedEdgePairs

``function connectedComponents``
--------------------------------

.. CG-BLOCK id=function:connectedComponents lines=96-110

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/faceAdjacency.ts
   :language: typescript
   :lines: 96-110
   :lineno-match:

.. CG-EXPLANATION-START id=function:connectedComponents

**What this does.** A union-find over a fixed set of indices. Union-find (or connected components) is a way to group things that are linked, directly or through a chain: it merges every supplied pair and then reports one root index per item, where two items share a root exactly when the pairs connect them.

**Why it is here.** The caller filters the pairs down to the ones it treats as one group — same mass, or both unclassed, and so on — so this generic grouping serves both the pocket rule and the least-dense leftover.

.. CG-EXPLANATION-END id=function:connectedComponents


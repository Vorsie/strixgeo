desktop.renderer.src.utils.geotechHierarchicalFill.crossFamilyWeld
==================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/crossFamilyWeld.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/crossFamilyWeld.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-31

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/crossFamilyWeld.ts
   :language: typescript
   :lines: 1-31
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module welds together touching faces of the same packing class that belong to DIFFERENT litho families — a closed lens touching a same-class mass from another family becomes one mass, in the render and, through the layer ids the welded region carries, in the database. It runs the same weld the per-family merge uses, but over a whole gap's classed faces keyed on the class, first splitting each ring at the other rings' vertices so their shared boundary cancels exactly. It imports the merge helper and the region shape.

**Why it is here.** Owner ruling 2026-08-21, option 3 of the gap0_lens_dissolve_choice page — "option 3 ofcourse", on top of "yes one mass one body". The litho stage closed such a lens with no litho tie, so it is its own family and the per-family merge can never reach it. The docstring notes a component that cannot close into one simple ring keeps its faces (an honest mosaic beats a wrong outline) but still carries the combined layer ids — the evidence welds even where the outline cannot.

.. CG-EXPLANATION-END id=module-header

``const ON_EDGE_EPS``
---------------------

.. CG-BLOCK id=const:ON_EDGE_EPS lines=32-33

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/crossFamilyWeld.ts
   :language: typescript
   :lines: 32-33
   :lineno-match:

.. CG-EXPLANATION-START id=const:ON_EDGE_EPS

**What this does.** A constant: the distance below which a vertex counts as lying ON another face's edge — a few hundred-thousandths.

**Why it is here.** Faces from different family arrangements are snapped independently on the engine's grid, so a lens tip sits up to a few grains off the neighbour's line (measured 3.3e-6 on the H12 scene); the weld must match at the grain the faces disagree by, and inserting a vertex this close bends the edge by less than the snap the geometry already carries.

.. CG-EXPLANATION-END id=const:ON_EDGE_EPS

``type Pt``
-----------

.. CG-BLOCK id=type:Pt lines=34-35

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/crossFamilyWeld.ts
   :language: typescript
   :lines: 34-35
   :lineno-match:

.. CG-EXPLANATION-START id=type:Pt

**What this does.** A short name for a point — a fraction and an elevation.

**Why it is here.** It is a convenience alias used throughout this file so the point type need not be spelled out each time.

.. CG-EXPLANATION-END id=type:Pt

``const vkey``
--------------

.. CG-BLOCK id=const:vkey lines=36-42

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/crossFamilyWeld.ts
   :language: typescript
   :lines: 36-42
   :lineno-match:

.. CG-EXPLANATION-START id=const:vkey

**What this does.** A small function that turns a point into a text key by rounding its fraction and elevation onto a fine grid.

**Why it is here.** Two points that round to the same key are the same point, which lets the split step pool identical vertices without comparing every pair by distance.

.. CG-EXPLANATION-END id=const:vkey

``function splitAtSharedVertices``
----------------------------------

.. CG-BLOCK id=function:splitAtSharedVertices lines=43-86

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/crossFamilyWeld.ts
   :language: typescript
   :lines: 43-86
   :lineno-match:

.. CG-EXPLANATION-START id=function:splitAtSharedVertices

**What this does.** Inserts, into each ring, the other rings' vertices that lie on its edges, so a boundary two faces share at different levels of detail cancels edge-for-edge. It pools every distinct vertex, then for each ring's edge inserts any pooled point that lies on it, in order.

**Why it is here.** Faces from different family runs state their shared boundary at different granularities — one long edge against two split halves — and the weld's edge census only cancels when both sides carry the same vertices, so the boundary has to be brought to a common set of points first.

.. CG-EXPLANATION-END id=function:splitAtSharedVertices

``function weldAcrossFamilies``
-------------------------------

.. CG-BLOCK id=function:weldAcrossFamilies lines=87-152

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/crossFamilyWeld.ts
   :language: typescript
   :lines: 87-152
   :lineno-match:

.. CG-EXPLANATION-START id=function:weldAcrossFamilies

**What this does.** The pass. It groups the section's classed faces by gap, and within each gap by class key, pre-splits only the classes carried by two or more faces, then merges touching same-class faces. A welded component is emitted as one region carrying every member's layer ids; a component that could not close into a simple ring keeps its faces but still gains the combined ids; untouched faces pass through verbatim. It returns the swept regions and the number of welds.

**Why it is here.** It honours the one-mass-one-body ruling across families while never moving geometry — only seams dissolve and layer ids combine. It also honours the engineer's Separate rulings (owner 2026-08-31, debt #278 R5): a cross-family weld whose combined layers would hold both sides of a split he drew is skipped so the paint seam survives, and passing no such pairs leaves the sweep byte-identical.

.. CG-EXPLANATION-END id=function:weldAcrossFamilies


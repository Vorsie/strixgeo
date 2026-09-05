desktop.renderer.src.utils.geotechHierarchicalFill.bandParents
==============================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/bandParents.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/bandParents.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-24

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/bandParents.ts
   :language: typescript
   :lines: 1-24
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This is a module — one source file — in the geotech fill. Its long top comment (the module's docstring) states the file's one job: for each geotech packing band, work out which litho unit it subdivides. A litho unit is one soil layer from the litho stage; a packing band is a thinner slice of it, tagged with a NAD packing class (the Belgian annex, NBN EN 1997-1 ANB Tabel 2.1). Each is described by a top and base depth below the test's own surface. The last line is an import — it borrows the ``PartitionColumn`` type from a neighbouring file. A type is just a named shape for a piece of data; ``PartitionColumn`` describes one investigation's top-to-bottom column of units.

**Why it is here.** The docstring records the design decision: the data model already guarantees that a band's depth interval sits inside its parent litho unit's interval, so plain geometric containment can pair the two. That means no formation roster, no soil lookup and no id chasing are needed, which is exactly what lets the whole hierarchical fill run from just the section's two column stacks — the same inputs the live app, the offline gates and the tests all feed it.

.. CG-EXPLANATION-END id=module-header

``interface BandParentResolution``
----------------------------------

.. CG-BLOCK id=interface:BandParentResolution lines=25-41

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/bandParents.ts
   :language: typescript
   :lines: 25-41
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BandParentResolution

**What this does.** Declares an interface — a named shape for a bundle of data — describing the pairing's result. It holds a map (a lookup table) from each band's id to the id of the litho unit it subdivides, plus two counters: how many bands straddled a litho contact (and so had to be parented by their midpoint), and how many had no litho unit at their depth at all.

**Why it is here.** The two counters exist because a band can only straddle a litho contact when the litho model moved under already-committed bands — a contact dragged after the subdivide. Silently dropping such a band would erase a NAD class the engineer can see on the column, so the docstring keeps the count as the honest signal that those columns need re-deriving.

.. CG-EXPLANATION-END id=interface:BandParentResolution

``function resolveBandParents``
-------------------------------

.. CG-BLOCK id=function:resolveBandParents lines=42-81

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/bandParents.ts
   :language: typescript
   :lines: 42-81
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolveBandParents

**What this does.** A function — a named, reusable step — that pairs every band with its parent. It first indexes the litho columns by investigation id, then for each geotech column looks up the matching litho column. For each band it tries to find a litho unit that fully contains the band's depth interval (allowing a tiny 1e-6 m slack); failing that, it parents the band by its midpoint and counts it as straddling; a band with no unit at any of its depths is counted as unparented.

**Why it is here.** It indexes by investigation id, not merely by position, so a caller that handed in mis-aligned lists parents a band against the wrong hole loudly rather than silently against a neighbour. The midpoint fallback plus the counters implement the docstring rule that a straddling band is still parented, never quietly dropped.

.. CG-EXPLANATION-END id=function:resolveBandParents


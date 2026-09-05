desktop.renderer.src.utils.sectionPartition.sectionRegion
=========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/sectionPartition/sectionRegion.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/sectionPartition/sectionRegion.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-9

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/sectionRegion.ts
   :language: typescript
   :lines: 1-9
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file that defines ``SectionRegion`` — a filled region tagged with which gap it belongs to — plus the substrate-quad shapes and one polygon slicer. It imports the point and region shapes from the vocabulary file.

**Why it is here.** The comment records these outlived the old v1 engine (debt #280): ``SectionRegion`` is the currency every fill consumer speaks, and the slicer is still read by the geotech edge-reach tripwire, so they were kept when the rest of the old resolve left with the archived engine.

.. CG-EXPLANATION-END id=module-header

``interface SectionRegion``
---------------------------

.. CG-BLOCK id=interface:SectionRegion lines=10-19

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/sectionRegion.ts
   :language: typescript
   :lines: 10-19
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionRegion

**What this does.** A partition region with one extra field: the ``gapIndex``, the 0-based index of the gap (named by its left column) that the region fills.

**Why it is here.** A region on its own does not say which gap it belongs to; tagging it lets the many regions of a whole section be grouped, sliced and measured per gap. It is the shape the engine's public output is a list of.

.. CG-EXPLANATION-END id=interface:SectionRegion

``interface UnderColumnQuad``
-----------------------------

.. CG-BLOCK id=interface:UnderColumnQuad lines=20-32

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/sectionRegion.ts
   :language: typescript
   :lines: 20-32
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UnderColumnQuad

**What this does.** One fill quad below a column's drilled depth, given as four independent elevations — top and base at the left edge and top and base at the right edge — plus its soil.

**Why it is here.** The docstring explains the independent left/right elevations let the band SLOPE across the column, so a straight deep-test-to-deep-test bridge line continues through a shallow column instead of being flattened.

.. CG-EXPLANATION-END id=interface:UnderColumnQuad

``interface UnderColumnFill``
-----------------------------

.. CG-BLOCK id=interface:UnderColumnFill lines=33-55

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/sectionRegion.ts
   :language: typescript
   :lines: 33-55
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UnderColumnFill

**What this does.** The whole substrate below one column's drilled depth: which column it is, and the top-to-bottom quads that tile the space from the deepest unit down to the drilled depth with no vertical gap.

**Why it is here.** It groups a column's sub-drilled-depth quads together so the deep-to-deep substrate under a shallow test is one tidy stack rather than loose pieces.

.. CG-EXPLANATION-END id=interface:UnderColumnFill

``function slicePolygonAtFraction``
-----------------------------------

.. CG-BLOCK id=function:slicePolygonAtFraction lines=56-75

.. literalinclude:: ../../../desktop/src/renderer/src/utils/sectionPartition/sectionRegion.ts
   :language: typescript
   :lines: 56-75
   :lineno-match:

.. CG-EXPLANATION-START id=function:slicePolygonAtFraction

**What this does.** Given a closed polygon and a horizontal fraction, returns the elevation intervals where a vertical line at that fraction is inside the polygon. It walks each edge, finds where the vertical line crosses it, sorts the crossing elevations, and pairs them up (an even-odd scanline). Vertical edges are skipped.

**Why it is here.** The docstring records this even-odd scanline is what the geotech edge-reach tripwire reads to ask whether the fill covers a column edge; it survived the v1 engine because that check still needs it.

.. CG-EXPLANATION-END id=function:slicePolygonAtFraction


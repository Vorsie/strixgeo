desktop.renderer.src.utils.geotechHierarchicalFill.constructive.coverWeld
=========================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/coverWeld.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/coverWeld.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-62

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/coverWeld.ts
   :language: typescript
   :lines: 1-62
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the module deciding when a LITHO boundary counts as a tied contact for the law. Its rule: a cover boundary reads as tied when, and only when, the far band across it is the same litho and the same packing — the same mass. A mass is the pair of a lithology and a NAD packing class; identity is the class, never the formation row. It imports the same-mass test, the far-band read, and the run types.

**Why it is here.** Owner 2026-08-26, shown two top sands standing as two closed loops with unclassed ground between them: 'the tops of all tests are connected? follow the tie, same nad class, emit nothing'. The docstring is careful this refines ruling A without overturning it: ruling A exists so a litho line can never force a statement between two different packings, a danger that only exists where the ends differ; where they are the same mass there is nothing to state and the answer is 'emit nothing'. It also defines what 'connected' means where no tie is stored (the cover's own envelope edge) and the envelope-only guard that stops two inner boundaries of a merged cover welding six metres apart.

.. CG-EXPLANATION-END id=module-header

``interface CoverContact``
--------------------------

.. CG-BLOCK id=interface:CoverContact lines=63-82

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/coverWeld.ts
   :language: typescript
   :lines: 63-82
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CoverContact

**What this does.** The shape of what one of a band's contacts says when it sits on the cover's own boundary: the line it lies on (a stored litho tie, or the cover's own edge to the facing band); whether that line is a stored, accepted litho correlation; and whether it welds — that is, whether the far band across it is the same mass.

**Why it is here.** The field comments record the split: ruling A already rides a stored litho tie whatever the far mass reads, while an implicit cover edge — one nobody drew — earns its line only by welding to a same-mass band.

.. CG-EXPLANATION-END id=interface:CoverContact

``function coverEdge``
----------------------

.. CG-BLOCK id=function:coverEdge lines=83-107

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/coverWeld.ts
   :language: typescript
   :lines: 83-107
   :lineno-match:

.. CG-EXPLANATION-START id=function:coverEdge

**What this does.** Builds the cover edge between two bands' contacts as a tie line, ordered left-to-right by along-section position, with a synthetic 'cover:' key.

**Why it is here.** It expresses the cover's own boundary as a line the construct code can ride, in exactly the same form as a packing tie, so no special case is needed downstream.

.. CG-EXPLANATION-END id=function:coverEdge

``function envelopeBandOf``
---------------------------

.. CG-BLOCK id=function:envelopeBandOf lines=108-133

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/coverWeld.ts
   :language: typescript
   :lines: 108-133
   :lineno-match:

.. CG-EXPLANATION-START id=function:envelopeBandOf

**What this does.** Returns the band that holds the cover's OWN edge on one column — the shallowest band's top, or the deepest band's base.

**Why it is here.** The docstring records why only these count: a family's cover can merge several litho units into one region, so a column can carry several bands each at its own unit's boundary. Only the outermost pair is the cover region's own edge; every inner contact is a boundary between two packings inside the cover, connected to nothing in particular. Without this test a thin top silt welded its base to a same-class silt six metres away on the facing test, breaking the owner's own S16b reading.

.. CG-EXPLANATION-END id=function:envelopeBandOf

``function coverContactOf``
---------------------------

.. CG-BLOCK id=function:coverContactOf lines=134-171

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/coverWeld.ts
   :language: typescript
   :lines: 134-171
   :lineno-match:

.. CG-EXPLANATION-START id=function:coverContactOf

**What this does.** Reads one contact of a band that is the parent litho unit's own boundary and carries no packing tie across this gap. If a stored litho tie exists there, the contact welds when the far band is the same mass. Otherwise it requires both this contact and the facing one to be the cover's own envelope edge and the far band to be the same mass, and only then welds through an implicit edge; anything else returns nothing.

**Why it is here.** It applies the envelope guard and the implicit-edge rule: different masses keep today's flat fallback to the byte, and an implicit edge (nobody's drawn correlation) earns its line only by welding, whereas a stored litho tie needs no envelope test because it IS the model saying the two contacts are one boundary.

.. CG-EXPLANATION-END id=function:coverContactOf


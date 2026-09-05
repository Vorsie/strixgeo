desktop.renderer.src.utils.geotechHierarchicalFill.constructive.terminationRun
==============================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/terminationRun.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/terminationRun.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-36

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/terminationRun.ts
   :language: typescript
   :lines: 1-36
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This module answers where a band's termination actually measures against, crossing "blind" columns that read nothing. A termination is a statement about where a band meets what a facing test read; a column with no reading at the band's levels states nothing, so the true reading column is the first one in that direction whose bands overlap the band's own elevation window, one gap away or several. Only when no column in that direction ever reads it is the run's own edge the real boundary. This module is the walk alone — it draws nothing. It imports a reading test and the band and column shapes.

**Why it is here.** It is the geotech arm's half of a law the litho arm already carries — owner 2026-08-21: "it should be a continuous band starting from S7 but now it is interrupted at S7A's column". What counts as READING is the section-wide stack, not this family's own bands (owner 2026-08-25): the walk stops at any column that measured this ground whatever class or soil it measured, because a column whose sand belongs to another family still read the levels, and walking past it faked continuity through ground already described.

.. CG-EXPLANATION-END id=module-header

``interface GeotechTerminationRun``
-----------------------------------

.. CG-BLOCK id=interface:GeotechTerminationRun lines=37-62

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/terminationRun.ts
   :language: typescript
   :lines: 37-62
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechTerminationRun

**What this does.** The result shape: the index of the column the termination measures against, and a flag saying whether that column genuinely reads the band's window or whether nothing in that direction ever did — in which case it is the run's own edge.

**Why it is here.** The two cases need different treatment downstream — an ordinary pinch measures against a real reading column, while the run's edge is where today's curtain is the final correct answer — so the flag carries that distinction.

.. CG-EXPLANATION-END id=interface:GeotechTerminationRun

``function terminationRun``
---------------------------

.. CG-BLOCK id=function:terminationRun lines=63-81

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/terminationRun.ts
   :language: typescript
   :lines: 63-81
   :lineno-match:

.. CG-EXPLANATION-START id=function:terminationRun

**What this does.** Walks outward from the terminating band's own column in one direction and returns the first column whose section-wide stack reads the band's top-to-base window; if none does, it returns the outermost column reached and marks it as the run's edge.

**Why it is here.** It crosses blind columns because a column that read nothing is not a boundary. It reads the section-wide stack, not the run column's own bands, because reading the run's own bands let a column carrying another family's soil at these very levels pass as blind (owner ruling 2026-08-25).

.. CG-EXPLANATION-END id=function:terminationRun


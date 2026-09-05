desktop.renderer.src.utils.geotechHierarchicalFill.constructive.nearestFamilyColumns
====================================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/nearestFamilyColumns.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/nearestFamilyColumns.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-50

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/nearestFamilyColumns.ts
   :language: typescript
   :lines: 1-50
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the module that decides, for a gap no run of this family brackets — one at the edge of the family's extent, or between two of its runs — who may speak for the ground: only the nearest carrying test on each side. It imports the run-column type.

**Why it is here.** Owner dogfeed 2026-08-22. The docstring records the defect: the fill used to fall back to every banded column of the family anywhere in the section, and the dominant-mass step ranks 'owns this very level' above nearness — correct between a gap's own two flanks, but wrong over the whole section, where it handed a 16 cm sliver on CS1 to a band 144 m away. The rule this fixes it with: a test that never measured anywhere near this ground states nothing about it, neither its class nor its levels.

.. CG-EXPLANATION-END id=module-header

``function nearestFamilyColumns``
---------------------------------

.. CG-BLOCK id=function:nearestFamilyColumns lines=51-68

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/nearestFamilyColumns.ts
   :language: typescript
   :lines: 51-68
   :lineno-match:

.. CG-EXPLANATION-START id=function:nearestFamilyColumns

**What this does.** Returns the family's nearest banded column on each side of one gap: the nearest column at or left of the gap, and the nearest at or right of it. It returns at most two columns, one for a one-sided gap, and none for a family with no columns.

**Why it is here.** Only the nearest carrying test on each side may speak for the ground beside it, and this one answer serves both jobs a column does in such a gap — stating its own levels as horizontal lines, and offering candidates to the dominant-mass step.

.. CG-EXPLANATION-END id=function:nearestFamilyColumns


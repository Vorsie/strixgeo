desktop.renderer.src.utils.excludeInvestigationsFromBuild
=========================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/excludeInvestigationsFromBuild.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/excludeInvestigationsFromBuild.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-28

.. literalinclude:: ../../../desktop/src/renderer/src/utils/excludeInvestigationsFromBuild.ts
   :language: typescript
   :lines: 1-28
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A docstring explaining what this helper does — drop a set of investigations from a model's build inputs as if they had never been imported — and the import of the three input shapes it works over.

**Why it is here.** The docstring records the owner's ruling (2026-08-26) that building without certain tests should reproduce the model as it was before they were added, and that "plain ignore" means the excluded test must leave nothing behind: no projected column, no layer, and no correlation edge anchored on one of its layers. It records that a dangling edge is the residue that matters most — the partition engine reads an edge as "these two units are one body", and an edge whose far end lost its column is exactly what produced the phantom bands fixed on CS3 (2026-08-25) — and that the geotech build applies it twice (packing bands and litho frame) so the frame never splits a gap the fill has no data for.

.. CG-EXPLANATION-END id=module-header

``interface BuildInputSlice``
-----------------------------

.. CG-BLOCK id=interface:BuildInputSlice lines=29-55

.. literalinclude:: ../../../desktop/src/renderer/src/utils/excludeInvestigationsFromBuild.ts
   :language: typescript
   :lines: 29-55
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BuildInputSlice

**What this does.** Describes one model's build inputs: the investigations that may become columns, the layer rows, and the approved correlation edges grouped by section id.

**Why it is here.** This is the exact bundle the exclusion rewrites, so the same shape describes the inputs before and after the exclusion.

.. CG-EXPLANATION-END id=interface:BuildInputSlice

``function excludeInvestigationsFromBuild``
-------------------------------------------

.. CG-BLOCK id=function:excludeInvestigationsFromBuild lines=56-88

.. literalinclude:: ../../../desktop/src/renderer/src/utils/excludeInvestigationsFromBuild.ts
   :language: typescript
   :lines: 56-88
   :lineno-match:

.. CG-EXPLANATION-START id=function:excludeInvestigationsFromBuild

**What this does.** Removes every trace of the named investigations. It returns the inputs untouched when nothing is excluded; otherwise it drops the layers anchored on an excluded investigation (remembering their ids), then filters out every edge that touches a dropped layer, and finally drops the excluded investigations themselves.

**Why it is here.** The docstring records that an empty exclusion returns the slice unchanged by reference so the default build path pays nothing and risks no rewrite it did not ask for; the comments record the anchor rule (a layer stands on exactly one investigation, and one with neither has no column to exclude) — and dropping the touching edges is the whole point, since a dangling edge is the phantom-band residue the ruling exists to close.

.. CG-EXPLANATION-END id=function:excludeInvestigationsFromBuild


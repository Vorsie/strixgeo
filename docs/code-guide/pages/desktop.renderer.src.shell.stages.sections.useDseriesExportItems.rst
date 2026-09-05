desktop.renderer.src.shell.stages.sections.useDseriesExportItems
================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/useDseriesExportItems.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/useDseriesExportItems.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-33

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useDseriesExportItems.tsx
   :language: tsx
   :lines: 1-33
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the hook that builds the Export menu's two D-Series rows — D-Stability (.stix) and D-Sheet Piling (.shi) — and the handlers behind them.

**Why it is here.** A hook module rather than another block in the giant toolbar file (debt #201). What makes these two different from DXF / PDF / Plaxis is that those are pure GETs the backend rebuilds from the model rows, whereas the D-Series pair is the closed-geometry family: the model they open IS the drawn polygons, computed in the renderer and posted in the request body.

.. CG-EXPLANATION-END id=module-header

``type DseriesKind``
--------------------

.. CG-BLOCK id=type:DseriesKind lines=34-38

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useDseriesExportItems.tsx
   :language: tsx
   :lines: 34-38
   :lineno-match:

.. CG-EXPLANATION-START id=type:DseriesKind

**What this does.** The two artefact kinds a press can be for: 'dstability' or 'dsheetpiling'.

**Why it is here.** One name so the single export function can branch on which artefact it is producing.

.. CG-EXPLANATION-END id=type:DseriesKind

``const ARTEFACTS``
-------------------

.. CG-BLOCK id=const:ARTEFACTS lines=39-75

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useDseriesExportItems.tsx
   :language: tsx
   :lines: 39-75
   :lineno-match:

.. CG-EXPLANATION-START id=const:ARTEFACTS

**What this does.** A lookup keyed by kind holding each artefact's label keys, file extension, filter label, success and failure message keys, test id and tooltip key.

**Why it is here.** Keeping the per-artefact wire facts and message keys in one table lets the two handlers be a single function, and every user-facing string resolve through the active language; only the file extension stays a literal because it is a wire value.

.. CG-EXPLANATION-END id=const:ARTEFACTS

``interface DseriesExportItemsParams``
--------------------------------------

.. CG-BLOCK id=interface:DseriesExportItemsParams lines=76-104

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useDseriesExportItems.tsx
   :language: tsx
   :lines: 76-104
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DseriesExportItemsParams

**What this does.** The axis facts the toolbar already derived and passes in: the active axis model, the open section, whether the panel is on the geotech axis, and the localised axis-level word for the tooltip.

**Why it is here.** Re-deriving these in the hook would risk drift from the toolbar; passing them in keeps the two in step.

.. CG-EXPLANATION-END id=interface:DseriesExportItemsParams

``function useDseriesExportItems``
----------------------------------

.. CG-BLOCK id=function:useDseriesExportItems lines=105-242

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useDseriesExportItems.tsx
   :language: tsx
   :lines: 105-242
   :lineno-match:

.. CG-EXPLANATION-START id=function:useDseriesExportItems

**What this does.** Builds the two menu rows and the export they run. Pressing one assembles the section's partition FIRST — reporting 'nothing drawn' or a load failure before the save dialog — then, if there is a partition, opens the save dialog, fetches the artefact bytes from the matching endpoint and writes them. On the geotech axis it frames the fill on the litho model and threads the packing-class map. Both rows gate exactly like the DXF row (a section open, the axis model present).

**Why it is here.** The partition is built before the save dialog, unlike the pure-GET exports, because it can legitimately have nothing to export — asking the engineer to name a file and only then saying 'there was nothing to write' is the wrong order. Gating identically to the DXF row means the engineer never meets a rule here that does not apply one row above.

.. CG-EXPLANATION-END id=function:useDseriesExportItems


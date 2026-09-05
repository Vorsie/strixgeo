desktop.renderer.src.shell.stages.sections.useSheetPayload
==========================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/useSheetPayload.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/useSheetPayload.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-32

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useSheetPayload.ts
   :language: typescript
   :lines: 1-32
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the code that assembles the PDF sheet's payload from what the Sections stage already has — the drawn partition, the column logs, the axis formations, and every investigation for the little location map. A pure assembler is tested directly; the thin async hook around it picks the axis from the sheet's fill setting so the fill toggle actually re-draws.

**Why it is here.** The sheet reuses the same partition path as the D-Series exports and the same section-log fetch the panel uses, so the printed sheet is the section the engineer is looking at.

.. CG-EXPLANATION-END id=module-header

``interface SheetInvestigation``
--------------------------------

.. CG-BLOCK id=interface:SheetInvestigation lines=33-43

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useSheetPayload.ts
   :language: typescript
   :lines: 33-43
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SheetInvestigation

**What this does.** One investigation as the sheet reads it: id, kind, name, map location, surface elevation, drilled depth and CPT type.

**Why it is here.** The sheet draws each investigation both as a column and as a dot on the map, so it needs the location and the log-identifying fields in one shape.

.. CG-EXPLANATION-END id=interface:SheetInvestigation

``interface AssembleInput``
---------------------------

.. CG-BLOCK id=interface:AssembleInput lines=44-77

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useSheetPayload.ts
   :language: typescript
   :lines: 44-77
   :lineno-match:

.. CG-EXPLANATION-START id=interface:AssembleInput

**What this does.** Everything the pure assembler takes: the language, the section geometry, the drawn partition, the investigations, the fetched CPT and borehole logs, the unit list (with optional NAD class and colour override), the basemap id, and the sheet settings.

**Why it is here.** The unit's NAD class and colour override are optional because only the geotech axis reads them — the sheet colours and labels a region by its packing class there, while litho formations carry a null class and keep their stored colour and name.

.. CG-EXPLANATION-END id=interface:AssembleInput

``function assembleSheetPayload``
---------------------------------

.. CG-BLOCK id=function:assembleSheetPayload lines=78-176

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useSheetPayload.ts
   :language: typescript
   :lines: 78-176
   :lineno-match:

.. CG-EXPLANATION-START id=function:assembleSheetPayload

**What this does.** Turns the partition, logs, units and investigations into the finished sheet payload. It sorts columns along the section, assigns a colour per project code, builds each column (with its log), computes the elevation range from the regions and collars, places every investigation as a map point (on- or off-profile), builds the project-colour legend, and computes the section length. Pure — no React, no input/output — so it is unit-tested directly.

**Why it is here.** Being pure is deliberate: the whole layout is one deterministic transform of its inputs, so a test can pin it exactly. The elevation range is padded so nothing sits flush against the sheet edge.

.. CG-EXPLANATION-END id=function:assembleSheetPayload

``function useSheetPayload``
----------------------------

.. CG-BLOCK id=function:useSheetPayload lines=177-245

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useSheetPayload.ts
   :language: typescript
   :lines: 177-245
   :lineno-match:

.. CG-EXPLANATION-START id=function:useSheetPayload

**What this does.** The async hook the preview dialog calls. It picks the axis model, layers and formations from the sheet's fill setting, builds the partition for the open section, returns null when the chosen fill has no model or nothing is drawn, then fetches the on-profile column logs and calls the pure assembler. On the geotech axis it frames the fill on the litho model and threads the packing-class map.

**Why it is here.** Returning null on an empty fill is how the dialog knows to disable Export. Framing the geotech fill on the litho model is required or the sheet would not be the section the engineer is looking at.

.. CG-EXPLANATION-END id=function:useSheetPayload


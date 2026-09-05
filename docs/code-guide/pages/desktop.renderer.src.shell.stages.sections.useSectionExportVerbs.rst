desktop.renderer.src.shell.stages.sections.useSectionExportVerbs
================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/useSectionExportVerbs.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/useSectionExportVerbs.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-23

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useSectionExportVerbs.ts
   :language: typescript
   :lines: 1-23
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the hook that owns the section-export verbs — DXF, Plaxis 3-D, the PDF sheet, and the two D-Series rows — for the toolbar.

**Why it is here.** Extracted verbatim from ``SectionsToolbar`` (debt #201) to consolidate the export concern that was scattered across the component: the axis-model selector, the busy flags and handlers, the PDF dialog state, and the closed-geometry items. Bodies unchanged.

.. CG-EXPLANATION-END id=module-header

``interface UseSectionExportVerbsDeps``
---------------------------------------

.. CG-BLOCK id=interface:UseSectionExportVerbsDeps lines=24-37

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useSectionExportVerbs.ts
   :language: typescript
   :lines: 24-37
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseSectionExportVerbsDeps

**What this does.** What the export verbs need from the shell: the axis flags, the three active models, the open section, the project, the localised level word, and the two shell export handlers (DXF and Plaxis 3-D).

**Why it is here.** These are exactly the inputs the export decisions weigh; bundling them keeps the hook's dependencies explicit.

.. CG-EXPLANATION-END id=interface:UseSectionExportVerbsDeps

``interface UseSectionExportVerbsResult``
-----------------------------------------

.. CG-BLOCK id=interface:UseSectionExportVerbsResult lines=38-62

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useSectionExportVerbs.ts
   :language: typescript
   :lines: 38-62
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseSectionExportVerbsResult

**What this does.** What the hook hands back: the DXF and Plaxis busy flags, the PDF sheet dialog's open state and setter, the DXF and Plaxis handlers, and the two D-Series export items.

**Why it is here.** The toolbar renders straight from these without carrying the export machinery itself.

.. CG-EXPLANATION-END id=interface:UseSectionExportVerbsResult

``function useSectionExportVerbs``
----------------------------------

.. CG-BLOCK id=function:useSectionExportVerbs lines=63-153

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useSectionExportVerbs.ts
   :language: typescript
   :lines: 63-153
   :lineno-match:

.. CG-EXPLANATION-START id=function:useSectionExportVerbs

**What this does.** Owns the export state and handlers. A single selector picks the model matching the current axis so DXF and PDF cannot disagree about which level the engineer is looking at; the DXF handler exports that axis's model level; the Plaxis handler exports the geological model; the PDF dialog opens the sheet preview; and the two D-Series items are built from the axis-model selector.

**Why it is here.** The one selector for both export verbs is the fix for a real audit finding: the geotech branch used to fall through to the geological model, so an engineer on the NAD axis silently got a geological DXF. Routing the axis model's id is the whole fix, because the snapshot builder is level-agnostic.

.. CG-EXPLANATION-END id=function:useSectionExportVerbs


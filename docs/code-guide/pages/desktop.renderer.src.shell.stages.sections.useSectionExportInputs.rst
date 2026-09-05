desktop.renderer.src.shell.stages.sections.useSectionExportInputs
=================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/useSectionExportInputs.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/useSectionExportInputs.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-24

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useSectionExportInputs.ts
   :language: typescript
   :lines: 1-24
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for a hook that reads, off the shell bus, the inputs the Sections-stage exporters share: the anchor-ordered investigation list, the geotech mass-identity map, and both axes' models, layers and formations.

**Why it is here.** Lifted out of the D-Series export hook because the PDF sheet builder is the second consumer of the same inputs (extract on the second copy), and the sheet needs BOTH axes so its fill toggle can render litho or geotech from one hook.

.. CG-EXPLANATION-END id=module-header

``interface SectionExportInputs``
---------------------------------

.. CG-BLOCK id=interface:SectionExportInputs lines=25-49

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useSectionExportInputs.ts
   :language: typescript
   :lines: 25-49
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionExportInputs

**What this does.** The shape the hook returns: the project, the visible CPTs and boreholes, the CPT-then-borehole ordered investigation list, the geotech formation-to-class map, and both axes' active models, layer rows and formations.

**Why it is here.** The investigations are in CPT-then-borehole anchor order — the same composition the build feeds — so an export's columns land in the same order the built model's do.

.. CG-EXPLANATION-END id=interface:SectionExportInputs

``function useSectionExportInputs``
-----------------------------------

.. CG-BLOCK id=function:useSectionExportInputs lines=50-133

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/useSectionExportInputs.ts
   :language: typescript
   :lines: 50-133
   :lineno-match:

.. CG-EXPLANATION-START id=function:useSectionExportInputs

**What this does.** Reads those pieces off the shell, composes the ordered investigation list, builds the packing-class lookup from the geotech formations, and returns one stable object (a memo — a cached result recomputed only when an input changes).

**Why it is here.** The result is memoised for stable identity so a downstream callback keyed on the whole object does not rebuild every render, which would spin the sheet preview's build effect. Only the framed geotech fill reads the class map (owner 2026-08-21, one mass one body); a litho export ignores it.

.. CG-EXPLANATION-END id=function:useSectionExportInputs


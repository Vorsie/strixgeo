desktop.renderer.src.shell.stages.sections.buildSectionExportPartition
======================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/buildSectionExportPartition.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/buildSectionExportPartition.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-44

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/buildSectionExportPartition.ts
   :language: typescript
   :lines: 1-44
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the module that assembles the drawn 2-D partition — the filled coloured polygons — for one open cross-section, for the exports that carry geometry (D-Stability and D-Sheet Piling). It explains why the partition is built here and not read off a canvas.

**Why it is here.** D-Stability and D-Sheet Piling are the closed-geometry export family: the model they open IS the section's filled polygons, computed in the renderer, so the partition travels in the request body rather than being rebuilt on the server. It cannot read the partition off the 3-D canvas builders because on the Sections stage neither of those canvases is mounted, and their leftover reference holds a stale snapshot of a different render's data — worse than nothing, because it would export ground the open section does not draw with no symptom. So it builds fresh, from the SAME factory the 3-D build uses, scoped to the one open section — reuse, not re-derivation, so the export and the build can never drift.

.. CG-EXPLANATION-END id=module-header

``interface SectionExportPartitionParams``
------------------------------------------

.. CG-BLOCK id=interface:SectionExportPartitionParams lines=45-80

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/buildSectionExportPartition.ts
   :language: typescript
   :lines: 45-80
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionExportPartitionParams

**What this does.** The inputs the export partition is assembled from, read the moment the button is pressed. It reuses every field of the 3-D build's own input shape except one: instead of every visible section, it takes the single section being exported (or null when none is selected).

**Why it is here.** Reusing the build's input shape verbatim is deliberate — it makes it impossible to configure the export differently from the build. The only difference is scope: one open section, not all of them.

.. CG-EXPLANATION-END id=interface:SectionExportPartitionParams

``function buildSectionExportPartition``
----------------------------------------

.. CG-BLOCK id=function:buildSectionExportPartition lines=81-90

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/buildSectionExportPartition.ts
   :language: typescript
   :lines: 81-90
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildSectionExportPartition

**What this does.** Builds the partition for the one open section by handing the shared voxel-request builder just that section, running it, and returning that section's polygons. Returns null when there is nothing to export — no project, no active model, no selected section, or fewer than two columns (no gap to fill between). It lets a real load failure (a correlation fetch that failed) propagate rather than swallow it.

**Why it is here.** Scoping to a single section is not a filter on the result — it is what the whole assembly runs on, so the correlation fetch is one call for one section and no other section's ground is ever read, let alone posted. Every null case means 'refuse', never 'post an empty model'. A load failure is deliberately propagated because an export built from a partial tie set is indistinguishable from a correct one once it is open in D-Stability.

.. CG-EXPLANATION-END id=function:buildSectionExportPartition


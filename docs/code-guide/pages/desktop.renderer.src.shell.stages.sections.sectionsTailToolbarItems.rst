desktop.renderer.src.shell.stages.sections.sectionsTailToolbarItems
===================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/sectionsTailToolbarItems.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/sectionsTailToolbarItems.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-29

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/sectionsTailToolbarItems.tsx
   :language: tsx
   :lines: 1-29
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the builder of the toolbar verbs shown on every axis — New cross-section, Suggest tie-sections, Delete, the Export dropdown and Recompute bodies — and the imports they need.

**Why it is here.** Pulled verbatim from ``SectionsToolbar`` (debt #201): these are the verbs shown regardless of which model axis is active. A pure builder, no hooks; the two menus are declared as locals because each is consumed only here.

.. CG-EXPLANATION-END id=module-header

``interface TailToolbarItemsDeps``
----------------------------------

.. CG-BLOCK id=interface:TailToolbarItemsDeps lines=30-83

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/sectionsTailToolbarItems.tsx
   :language: tsx
   :lines: 30-83
   :lineno-match:

.. CG-EXPLANATION-START id=interface:TailToolbarItemsDeps

**What this does.** Everything the shared tail verbs read: the translator, axis and section flags, whether a model exists, the localised axis-level word, the busy flags (creating, deleting, exporting, recomputing), the selected section and lists, the tie suggestions, the D-Series export items, and every handler behind New / Delete / Export / Recompute / tie-sections.

**Why it is here.** The localised level word is display only, never a filename or payload — the domain stores raw tokens and translation happens at the presentation boundary.

.. CG-EXPLANATION-END id=interface:TailToolbarItemsDeps

``function buildTailToolbarItems``
----------------------------------

.. CG-BLOCK id=function:buildTailToolbarItems lines=84-416

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/sectionsTailToolbarItems.tsx
   :language: tsx
   :lines: 84-416
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildTailToolbarItems

**What this does.** Assembles the shared verb specs: New cross-section (an accent-filled primary button), the Suggest-tie-sections split-button (amber while suggestions are pending), Delete (a danger button that keeps its label), the Export dropdown (DXF, Plaxis 3-D, PDF sheet, and the two D-Series rows), and — only on the litho or geotech axis — the Recompute-bodies escape hatch.

**Why it is here.** New is the one verb an empty-project user must find, so the accent fill is the bar's single strongest signal. Delete is never icon-only because a bare trash icon is not an acceptable presentation for an irreversible action — a mis-click costs a cross-section and every contact on it (docs/ux.md). Recompute is the lowest priority — an escape hatch for a job that normally runs itself — and the first control on the whole bar to fold into the ⋯ More menu.

.. CG-EXPLANATION-END id=function:buildTailToolbarItems


desktop.renderer.src.shell.stages.geology.GeologyInspector
==========================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geology/GeologyInspector.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geology/GeologyInspector.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-59

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeologyInspector.tsx
   :language: tsx
   :lines: 1-59
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the geology inspector file, documents that it owns the geological-model-definition UI (formation list, drag-reorder, borehole scope, surface-crossing banner), and imports its pieces: React hooks, the API response types, the crossings-validation hook, the UI Button and Modal, the crossing-section picker dialog, the formation edit dialog, the crossing-focus and formation-kind helpers, the shell context, the translator, the formation-roster hook, and the five presentational sibling panels.

**Why it is here.** The inspector is the 420-pixel right-hand panel of a stage. This one is a thin composer after the god-component decomposition round (debt #201): the create/edit/delete plus drag-reorder logic lives in the ``useGeologyFormations`` hook (and the intricate reorder maths in ``reorderFormationsCommand``), and each panel section is a presentational sibling. Props flow down, callbacks up; the extracted pieces hold no shared state. It takes no props — all state comes from ``useShell()`` per the inspector-component contract.

.. CG-EXPLANATION-END id=module-header

``function GeologyInspector``
-----------------------------

.. CG-BLOCK id=function:GeologyInspector lines=60-388

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/GeologyInspector.tsx
   :language: tsx
   :lines: 60-388
   :lineno-match:

.. CG-EXPLANATION-START id=function:GeologyInspector

**What this does.** The inspector component. It reads everything it needs from the shell context, hands formation create/edit/delete and drag-reorder to the ``useGeologyFormations`` hook, runs the surface-crossing validator, and builds the flow that turns a clicked crossing into a jump to the owning section. It then filters the formation list to the right vocabulary for the current section axis, reverses it to youngest-first for display, and renders in order the header, an Add-formation button, the confidence-fade toggle, the crossings banner, the section-picker dialog, the formation list, the boreholes-in-model roster, the create/edit dialog, and a delete-confirm modal.

**Why it is here.** The axis-aware filter (a locked owner decision, #55) narrows the roster to litho-mapped formations when the section editor is on the lithostratigraphic axis and to geological formations on the geological axis, because formations are one project-wide vocabulary shared across the geological, lithology and geotech models — without the filter litho units would leak into the geology roster. The crossings validator is skipped on a stale surface cache (debt #18) so the banner never shows an untrustworthy warning. Youngest-first display matches a borehole log or stratigraphic column, and the reorder maths inverts back to ``display_order`` (oldest first, the paint order) so the data contract is untouched. The delete modal default-focuses Cancel because deleting a formation is irreversible.

.. CG-EXPLANATION-END id=function:GeologyInspector


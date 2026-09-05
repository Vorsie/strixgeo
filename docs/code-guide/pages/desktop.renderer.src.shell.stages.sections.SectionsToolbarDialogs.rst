desktop.renderer.src.shell.stages.sections.SectionsToolbarDialogs
=================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/SectionsToolbarDialogs.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/SectionsToolbarDialogs.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SectionsToolbarDialogs.tsx
   :language: tsx
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the collection of modal and confirmation dialogs the Sections toolbar owns — the PDF sheet preview, the delete-section confirm, the bulk-suggest confirm, the re-correlate confirm, the re-subdivide confirm and the reset-manual-points confirm.

**Why it is here.** Pulled verbatim from the toolbar's render tail (debt #201). Every dialog here is presentational: its open state and confirm handlers are passed in, so this file holds no hooks and changes no behaviour — it is the same markup, one call away.

.. CG-EXPLANATION-END id=module-header

``interface SectionsToolbarDialogsProps``
-----------------------------------------

.. CG-BLOCK id=interface:SectionsToolbarDialogsProps lines=18-79

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SectionsToolbarDialogs.tsx
   :language: tsx
   :lines: 18-79
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionsToolbarDialogsProps

**What this does.** The full set of inputs the dialog stack needs — for each dialog, its open flag, its busy flag, the data it displays (section name, anchor count, edge count, subdivide scope, statistic), and its cancel / confirm callbacks.

**Why it is here.** Because the dialogs are presentational, everything they render and everything they resolve is passed down; the toolbar owns the state and the resolvers.

.. CG-EXPLANATION-END id=interface:SectionsToolbarDialogsProps

``function SectionsToolbarDialogs``
-----------------------------------

.. CG-BLOCK id=function:SectionsToolbarDialogs lines=80-296

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SectionsToolbarDialogs.tsx
   :language: tsx
   :lines: 80-296
   :lineno-match:

.. CG-EXPLANATION-START id=function:SectionsToolbarDialogs

**What this does.** Renders the fragment of dialogs — mostly closed at any moment. The delete and bulk-suggest modals put default focus on Cancel and name the action on their confirm buttons; the re-subdivide dialog states which section's hand-edits it will destroy and, on a statistic re-run, that the clear is model-wide; the reset-points dialog is a danger confirm.

**Why it is here.** Each destructive confirm follows docs/ux.md: default focus on Cancel and a button that NAMES the action, never 'OK', so the engineer must actively choose the destructive path. The re-subdivide dialog states its blast radius in the owner's own words because a warning phrased over the model fires where nothing is at risk (owner 2026-08-15).

.. CG-EXPLANATION-END id=function:SectionsToolbarDialogs


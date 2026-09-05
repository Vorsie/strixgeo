desktop.renderer.src.shell.stages.sections.SheetPreviewDialog
=============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/SheetPreviewDialog.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/SheetPreviewDialog.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-33

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SheetPreviewDialog.tsx
   :language: tsx
   :lines: 1-33
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the cross-section PDF sheet preview dialog. The sheet itself renders in an embedded frame; every control change posts a fresh payload into that frame, so the preview IS what prints.

**Why it is here.** The fill axis is the only setting that re-runs the (slow, asynchronous) partition build; every other control is applied by re-posting the same payload, so the preview stays live and cheap.

.. CG-EXPLANATION-END id=module-header

``const CONTROL_CLASS``
-----------------------

.. CG-BLOCK id=const:CONTROL_CLASS lines=34-38

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SheetPreviewDialog.tsx
   :language: tsx
   :lines: 34-38
   :lineno-match:

.. CG-EXPLANATION-START id=const:CONTROL_CLASS

**What this does.** One shared styling string for every editable field in the dialog's side panel, giving them a readable border and background in both light and dark themes.

**Why it is here.** Owner finding 2026-09-04: the free-text fields were black-on-black in dark mode. The border is a fixed mid-grey (not a lighter dark-only override) because a lighter border failed the 3:1 non-text contrast floor of WCAG 2.2 against both the white and the dark surfaces — mid-grey clears it in both.

.. CG-EXPLANATION-END id=const:CONTROL_CLASS

``interface SheetPreviewDialogProps``
-------------------------------------

.. CG-BLOCK id=interface:SheetPreviewDialogProps lines=39-48

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SheetPreviewDialog.tsx
   :language: tsx
   :lines: 39-48
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SheetPreviewDialogProps

**What this does.** The dialog's inputs: whether it is open, a close callback, the open section, whether the panel is on the geotech axis (which seeds the default fill), and whether a geotech model exists (which gates the geotech-fill radio).

**Why it is here.** The axis seed and the geotech-model gate are the two facts the dialog cannot derive itself — everything else it reads from the shell or builds internally.

.. CG-EXPLANATION-END id=interface:SheetPreviewDialogProps

``function SheetPreviewDialog``
-------------------------------

.. CG-BLOCK id=function:SheetPreviewDialog lines=49-430

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SheetPreviewDialog.tsx
   :language: tsx
   :lines: 49-430
   :lineno-match:

.. CG-EXPLANATION-START id=function:SheetPreviewDialog

**What this does.** The dialog itself. It seeds its settings from the section when it opens, rebuilds the payload whenever the fill axis changes (the only geometry-changing control), and posts the live payload into the sheet frame on every change. It fits the sheet into the left pane with a resize observer, shows a live page-size and printed-scale read-out, persists the settings on close, exports to PDF through the OS save dialog, and swallows the Escape key so closing the preview never drops the engineer back to the map. The right side panel offers fill, scale mode, exaggeration, spacing and free-text header fields.

**Why it is here.** Only the axis changes what is drawn, so only it triggers a rebuild; the other controls re-post the same geometry. The Escape handler stops at this dialog because Escape is also the section editor's deselect key. The live page-size and scale read-out was added after the owner found fit-mode's width growth invisible and the explicit-scale mode undiscoverable (2026-09-04). Export is disabled while building, when nothing is drawn, or when the sheet is over the width cap — a state the read-out surfaces in amber.

.. CG-EXPLANATION-END id=function:SheetPreviewDialog


desktop.renderer.src.components.sections.FlaggedTiesPromptDialog
================================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/FlaggedTiesPromptDialog.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/FlaggedTiesPromptDialog.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-22

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/FlaggedTiesPromptDialog.tsx
   :language: tsx
   :lines: 1-22
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the file for the dialog that asks, right after a hand edit, whether to delete the correlations that edit just broke. The imports pull in the generic confirm dialog and the translation helper.

**Why it is here.** When a hand edit leaves a correlation's two ends no longer agreeing on the packing class, the machine flags it violet and keeps it rather than throwing away the engineer's own correlation on the strength of one edit. But that leaves him to find the badge later and reconstruct why. The owner asked for the question instead, phrased as: check the correlations after a merge, and if the two ends still line up but the packing densities mismatch, ask whether to delete the band. So this is a question, not a warning; keeping the ties flagged is both the safe answer and the cancel. Only accepted ties reach here — a pending guess that stops matching is deleted outright.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=23-38

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/FlaggedTiesPromptDialog.tsx
   :language: tsx
   :lines: 23-38
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The inputs: how many accepted ties the edit flagged, a keep callback (cancel — the ties stay flagged), a delete callback, and a busy flag.

**Why it is here.** A zero count means the dialog is not open. Keep is the cancel because doing nothing leaves the flags already written; delete is the action, and it is undoable — each deletion goes on the section undo stack like any hand disconnect.

.. CG-EXPLANATION-END id=interface:Props

``function FlaggedTiesPromptDialog``
------------------------------------

.. CG-BLOCK id=function:FlaggedTiesPromptDialog lines=39-77

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/FlaggedTiesPromptDialog.tsx
   :language: tsx
   :lines: 39-77
   :lineno-match:

.. CG-EXPLANATION-START id=function:FlaggedTiesPromptDialog

**What this does.** The component. It renders the generic confirm dialog with singular or plural wording for the count, a three-part body explaining what happened, a 'keep flagged' cancel, and a danger-styled delete action.

**Why it is here.** The delete is danger-styled because it removes the engineer's correlations, but the cancel is the safe default that keeps them flagged — matching the owner's framing that keeping is the safe answer and deleting is the deliberate one.

.. CG-EXPLANATION-END id=function:FlaggedTiesPromptDialog


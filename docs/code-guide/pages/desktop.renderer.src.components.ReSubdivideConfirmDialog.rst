desktop.renderer.src.components.ReSubdivideConfirmDialog
========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/ReSubdivideConfirmDialog.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/ReSubdivideConfirmDialog.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-37

.. literalinclude:: ../../../desktop/src/renderer/src/components/ReSubdivideConfirmDialog.tsx
   :language: tsx
   :lines: 1-37
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The long top comment and imports for the re-subdivide confirmation, shown before re-running "Subdivide all bodies" when a geotechnical model already exists for the section. The comment explains that re-subdividing wipes and regenerates the open section's packing connections — the auto-derived ones come back, but any manual packing connections there are lost, and any hand-edited bands are rebuilt from the CPT data and cannot be recovered. It imports the shared ``ConfirmDialog`` and the translator.

**Why it is here.** Because that loss is irreversible, the comment cites the reversible-versus-irreversible rule (CLAUDE.md; ``docs/ux.md``): Cancel default-focused so an accidental Enter cannot wipe connections — the same template as the ``CptRefreshConfirmDialog`` page. The comment records several owner rulings that shaped the copy: the two losses (re-derivable connections versus non-derivable hand edits) are named separately because the engineer weighs them differently; the hand-edit warning appears only when there are some, so a warning firing at zero never trains him to click past the one that matters; and the whole body speaks about one named section, because since 2026-08-15 the rebuild deletes only the columns it rebuilds, so it must never read as a threat to another section's work.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=38-85

.. literalinclude:: ../../../desktop/src/renderer/src/components/ReSubdivideConfirmDialog.tsx
   :language: tsx
   :lines: 38-85
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The dialog's inputs: whether it is open, cancel and confirm callbacks, a busy flag, how many hand-edited bands this section's re-run will destroy, the section's name, and — for a model-wide re-run — the statistic it would reclassify under.

**Why it is here.** Every input carries an owner ruling recorded in the comments: the hand-edit count is this section's only, so the sentence can state it flatly rather than hedging; the section name is spoken out loud so a dialog opened on a fresh section never reads as a threat to the one the engineer has work on; and the statistic, when set, switches the body to state the model-wide blast radius, because a re-run under a new statistic really does rebuild every section and a section-named dialog would promise a smaller loss than it delivers.

.. CG-EXPLANATION-END id=interface:Props

``function ReSubdivideConfirmDialog``
-------------------------------------

.. CG-BLOCK id=function:ReSubdivideConfirmDialog lines=86-176

.. literalinclude:: ../../../desktop/src/renderer/src/components/ReSubdivideConfirmDialog.tsx
   :language: tsx
   :lines: 86-176
   :lineno-match:

.. CG-EXPLANATION-START id=function:ReSubdivideConfirmDialog

**What this does.** The dialog component. It draws a ``ConfirmDialog`` whose body says either that this named section's bands will be regenerated, or — when a statistic is given — that all subdivisions model-wide will be cleared; adds a hand-edit warning only when there are hand edits to lose; and points at Auto-correlate as the way to get the automatic connections back without wiping anything. The go-ahead button reads "Re-subdivide" and is destructive-styled, with Cancel the safe default.

**Why it is here.** The body branches between the one-section and model-wide wording so it never promises a smaller loss than it delivers, and the hand-edit paragraph is shown only when there is something to lose (owner ruling). The Auto-correlate pointer is placed here because this is the exact moment the engineer is deciding whether to accept the loss, and that path now re-proposes the connections without touching anything. It is the irreversible-action template from the ``CptRefreshConfirmDialog`` page, tuned by a long history of owner dogfeed.

.. CG-EXPLANATION-END id=function:ReSubdivideConfirmDialog


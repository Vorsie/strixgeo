desktop.renderer.src.components.ReCorrelateConfirmDialog
========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/ReCorrelateConfirmDialog.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/ReCorrelateConfirmDialog.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-15

.. literalinclude:: ../../../desktop/src/renderer/src/components/ReCorrelateConfirmDialog.tsx
   :language: tsx
   :lines: 1-15
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top comment and imports for the re-correlate confirmation, shown when the engineer clicks Auto-correlate and auto-made correlation edges already exist. The comment lists three choices: Cancel (default focus), Skip (keep the existing auto edges, do nothing), and Re-correlate (delete the auto edges and rerun). It imports the shared ``ConfirmDialog`` and the translator.

**Why it is here.** Re-running deletes the existing auto edges, which is irreversible, so it follows the reversible-versus-irreversible rule from the ``CptRefreshConfirmDialog`` page: Cancel default-focused so an accidental Enter cannot change the model. The comment stresses that manual edges are never deleted and the body makes this explicit, so the engineer's own correlations are safe.

.. CG-EXPLANATION-END id=module-header

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=16-30

.. literalinclude:: ../../../desktop/src/renderer/src/components/ReCorrelateConfirmDialog.tsx
   :language: tsx
   :lines: 16-30
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The dialog's inputs: whether it is open, how many auto edges already exist, and cancel, skip and re-correlate callbacks, plus a busy flag.

**Why it is here.** The auto-edge count is shown in the body so the engineer knows how much the rerun would replace, and the three callbacks map onto the three choices; the busy flag disables the buttons while the rerun runs.

.. CG-EXPLANATION-END id=interface:Props

``function ReCorrelateConfirmDialog``
-------------------------------------

.. CG-BLOCK id=function:ReCorrelateConfirmDialog lines=31-75

.. literalinclude:: ../../../desktop/src/renderer/src/components/ReCorrelateConfirmDialog.tsx
   :language: tsx
   :lines: 31-75
   :lineno-match:

.. CG-EXPLANATION-START id=function:ReCorrelateConfirmDialog

**What this does.** The dialog component. It draws a ``ConfirmDialog`` whose body states how many auto edges exist and that manual edges are kept. Skip is the secondary action and Re-correlate is the destructive confirm; Cancel is the safe default.

**Why it is here.** The explicit "manual edges are kept" note answers the engineer's real worry before the destructive rerun. It is the same irreversible-action template as the ``CptRefreshConfirmDialog`` page, with an added Skip so keeping the existing edges is a first-class choice.

.. CG-EXPLANATION-END id=function:ReCorrelateConfirmDialog


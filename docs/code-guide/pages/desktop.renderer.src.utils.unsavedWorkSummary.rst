desktop.renderer.src.utils.unsavedWorkSummary
=============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/unsavedWorkSummary.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/unsavedWorkSummary.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-16

.. literalinclude:: ../../../desktop/src/renderer/src/utils/unsavedWorkSummary.ts
   :language: typescript
   :lines: 1-16
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Computes an itemised list of what closing the project without saving would cost. The comment and docstring explain what the list must and must not contain.

**Why it is here.** The comment records the reason it exists: ``projectDirty`` is a single yes/no flag combined from seven sources — enough to decide whether to prompt, but not enough to tell the engineer what is at stake. This module keeps the itemised view as a pure derivation (no React, no input/output) so the lifecycle hook (debt #201, already past 500 lines) does not grow another block of logic. The docstring adds that imports are counted per kind because the session-import id sets track them individually, while interpretation edits are only a yes/no flag because the two-stage save model keeps a single "something was mutated" signal, so the dialog says that rather than inventing a count.

.. CG-EXPLANATION-END id=module-header

``interface UnsavedWorkSummary``
--------------------------------

.. CG-BLOCK id=interface:UnsavedWorkSummary lines=17-36

.. literalinclude:: ../../../desktop/src/renderer/src/utils/unsavedWorkSummary.ts
   :language: typescript
   :lines: 17-36
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UnsavedWorkSummary

**What this does.** The output shape: whether a saved snapshot exists, the per-kind import counts (CPTs, boreholes, formations, sections, contacts), and two flags (interpretation edits and metadata edits). It is followed by the note that opens the inputs interface.

**Why it is here.** The comment records why the saved-snapshot flag matters: it is false for a never-saved project, where Discard deletes the work rather than reverting to a last-saved copy, so the dialog must warn differently.

.. CG-EXPLANATION-END id=interface:UnsavedWorkSummary

``interface UnsavedWorkInputs``
-------------------------------

.. CG-BLOCK id=interface:UnsavedWorkInputs lines=37-63

.. literalinclude:: ../../../desktop/src/renderer/src/utils/unsavedWorkSummary.ts
   :language: typescript
   :lines: 37-63
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UnsavedWorkInputs

**What this does.** The raw session-dirty state the summary is built from: the saved-snapshot flag, five sets of session-imported ids (CPTs, boreholes, formations, sections, contacts), and the two dirty flags. It then documents the builder below.

**Why it is here.** The comments record that the per-kind counts come from the sizes of these session-import id sets, and that the two boolean flags are the ones the two-stage save model already keeps — a touched pre-existing row, and an uncommitted metadata draft.

.. CG-EXPLANATION-END id=interface:UnsavedWorkInputs

``function buildUnsavedWorkSummary``
------------------------------------

.. CG-BLOCK id=function:buildUnsavedWorkSummary lines=64-75

.. literalinclude:: ../../../desktop/src/renderer/src/utils/unsavedWorkSummary.ts
   :language: typescript
   :lines: 64-75
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildUnsavedWorkSummary

**What this does.** Builds the summary: it copies the saved-snapshot flag, takes each import count from the size of its id set, and copies the interpretation-edit and metadata-edit flags across.

**Why it is here.** A pure translation from the raw session-dirty state into the itemised shape the Discard confirmation dialog reads, so the dialog can tell the engineer exactly what would be lost.

.. CG-EXPLANATION-END id=function:buildUnsavedWorkSummary


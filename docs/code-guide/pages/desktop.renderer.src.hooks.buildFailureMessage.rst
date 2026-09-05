desktop.renderer.src.hooks.buildFailureMessage
==============================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/buildFailureMessage.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/buildFailureMessage.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-41

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/buildFailureMessage.ts
   :language: typescript
   :lines: 1-41
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's opening comment, its three imports (an error-detail helper, the translation helper, and an inputs-error type), and the documentation for the first function below.

**Why it is here.** This little module holds the user-facing wording for a voxel build that did not complete. The comment records why it was pulled out of ``useLithoSolids``: both the immediate build path and the streaming build path (the ``desktop.renderer.src.hooks.useVoxelBuildStream`` page) must format the grid-too-large refusal the SAME way — the retry spacing plus a “the stored model was not changed” line — rather than one path showing friendly copy and the other the raw server sentence (debt #282). Living in its own module lets both hooks import it without the import cycle that would form if the stream hook reached back into ``useLithoSolids``.

.. CG-EXPLANATION-END id=module-header

``function gridTooLargeMessage``
--------------------------------

.. CG-BLOCK id=function:gridTooLargeMessage lines=42-78

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/buildFailureMessage.ts
   :language: typescript
   :lines: 42-78
   :lineno-match:

.. CG-EXPLANATION-START id=function:gridTooLargeMessage

**What this does.** Takes the structured server detail and returns the actionable message for a grid-too-large refusal — stating the spacing to retry at when the engine supplied one, and always the “model unchanged” line — or null when the detail is some other kind of failure. The block also carries the documentation for the next function.

**Why it is here.** The docstring records the incident behind it: on 2026-08-02 this refusal reached the user as “ApiError: [object Object]”, with no way to know the model was untouched or what to change. The retry spacing is stated because the engine computed it, and the unchanged line stops the engineer hunting for a half-built model. Both build paths feed their detail here so the wording is identical. All the sentences come from the translation helper, so they follow the app's language (translate at the presentation boundary, docs/ux.md).

.. CG-EXPLANATION-END id=function:gridTooLargeMessage

``function buildFailureMessage``
--------------------------------

.. CG-BLOCK id=function:buildFailureMessage lines=79-84

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/buildFailureMessage.ts
   :language: typescript
   :lines: 79-84
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildFailureMessage

**What this does.** Takes the caught failure from a synchronous build and returns the right sentence: the inputs-error's own message when the builder refused before sending, the grid-too-large copy when that is the reason, and an honest generic “check the connection” sentence otherwise.

**Why it is here.** The docstring records that three failures are genuinely different and must not read alike — inputs refused (the message already names the sections that failed to load, so it is shown verbatim), grid budget refused (the retry copy above), and anything else (an unexpected failure). Keeping them distinct means the engineer is told which of the three actually happened.

.. CG-EXPLANATION-END id=function:buildFailureMessage


desktop.renderer.src.utils.closeFlowMessages
============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/closeFlowMessages.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/closeFlowMessages.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-10

.. literalinclude:: ../../../desktop/src/renderer/src/utils/closeFlowMessages.ts
   :language: typescript
   :lines: 1-10
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A comment introducing this file as the home for the user-facing wording of the two close-flow outcomes that leave the project open — a failed save and a refused revert.

**Why it is here.** The comment records the audit (2026-08-02) that prompted it: both outcomes used to end in a log line and nothing on screen, so the dialog stayed up with no explanation and a save looked like it did nothing. The wording builders are kept pure so the copy can be tested without rendering a dialog, and shared so the toast and the dialog body can never disagree about the same event.

.. CG-EXPLANATION-END id=module-header

``function baseName``
---------------------

.. CG-BLOCK id=function:baseName lines=11-33

.. literalinclude:: ../../../desktop/src/renderer/src/utils/closeFlowMessages.ts
   :language: typescript
   :lines: 11-33
   :lineno-match:

.. CG-EXPLANATION-START id=function:baseName

**What this does.** Returns the last segment of a file path — the file's display name — by splitting on either slash style and taking the final piece, falling back to the whole path if there is nothing after the last separator.

**Why it is here.** The messages name the file to the engineer, and the bare file name reads better in a sentence than the full path; splitting on both slash styles handles Windows and POSIX paths alike.

.. CG-EXPLANATION-END id=function:baseName

``function failedSaveMessage``
------------------------------

.. CG-BLOCK id=function:failedSaveMessage lines=34-59

.. literalinclude:: ../../../desktop/src/renderer/src/utils/closeFlowMessages.ts
   :language: typescript
   :lines: 34-59
   :lineno-match:

.. CG-EXPLANATION-START id=function:failedSaveMessage

**What this does.** Builds the sentence for a save that did not reach its project file: it names the file (or a generic phrase for a never-saved project), states that the work is still unsaved, and gives the two causes that actually happen on this platform — the file open elsewhere, or a sync client holding a lock.

**Why it is here.** The docstring records that it states the consequence in the engineer's own terms and names only the real causes, so the message is actionable rather than generic; it is safe to show in both a toast and the dialog body.

.. CG-EXPLANATION-END id=function:failedSaveMessage

``function refusedRevertMessage``
---------------------------------

.. CG-BLOCK id=function:refusedRevertMessage lines=60-84

.. literalinclude:: ../../../desktop/src/renderer/src/utils/closeFlowMessages.ts
   :language: typescript
   :lines: 60-84
   :lineno-match:

.. CG-EXPLANATION-START id=function:refusedRevertMessage

**What this does.** Builds the sentence for a Discard whose revert the save-anchor gate refused: it names the file, explains that the file on disk is not this project's latest save so replaying it would delete work it never held, and offers the two ways out — save the project, or point it at the right file.

**Why it is here.** The docstring records that the refusal is the safe outcome, so the copy must explain why nothing happened rather than read as a failure to retry — otherwise the engineer would try again and again against a gate that is protecting their work.

.. CG-EXPLANATION-END id=function:refusedRevertMessage

``function failedRevertMessage``
--------------------------------

.. CG-BLOCK id=function:failedRevertMessage lines=85-92

.. literalinclude:: ../../../desktop/src/renderer/src/utils/closeFlowMessages.ts
   :language: typescript
   :lines: 85-92
   :lineno-match:

.. CG-EXPLANATION-START id=function:failedRevertMessage

**What this does.** Builds the sentence for a Discard whose revert actually threw: it names the file, says the close was cancelled and nothing was deleted, and asks the engineer to check the file is readable and try again.

**Why it is here.** The docstring records that this is deliberately worded differently from the refusal message: a refusal is a decision and a failure is a fault, and only the fault is worth retrying — so the two must not read the same.

.. CG-EXPLANATION-END id=function:failedRevertMessage


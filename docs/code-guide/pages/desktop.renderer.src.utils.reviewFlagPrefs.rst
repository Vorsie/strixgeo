desktop.renderer.src.utils.reviewFlagPrefs
==========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/reviewFlagPrefs.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/reviewFlagPrefs.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-17

.. literalinclude:: ../../../desktop/src/renderer/src/utils/reviewFlagPrefs.ts
   :language: typescript
   :lines: 1-17
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file remembers, per project, which litho review flags the engineer has dismissed. A review flag marks an uncorrelated same-litho neighbour that the safe-default repair had to re-emit as an onlap; the flag simply invites an optional correlation, and "Keep separate" dismisses it. The import brings in a helper that reads one bag out of a section's saved view state.

**Why it is here.** The comment records that the flag comes from the safe-default repair described in docs/design/partition-engine-v2.md §10, and that the dismissal is a per-project decision, so — like every such decision (CLAUDE.md, memory: decisions live in the bundle) — it rides in the project file through the section row's saved view state, not in the browser's local store, which a colleague opening the same project would never see. It mirrors the litho-segmenter view-state pattern: a shallow patch touches only its own key and leaves sibling settings untouched.

.. CG-EXPLANATION-END id=module-header

``const VIEW_STATE_KEY``
------------------------

.. CG-BLOCK id=const:VIEW_STATE_KEY lines=18-20

.. literalinclude:: ../../../desktop/src/renderer/src/utils/reviewFlagPrefs.ts
   :language: typescript
   :lines: 18-20
   :lineno-match:

.. CG-EXPLANATION-START id=const:VIEW_STATE_KEY

**What this does.** The name of the view-state bag this file owns: ``review_flags``.

**Why it is here.** Naming it once means the read and the write can never drift onto different keys.

.. CG-EXPLANATION-END id=const:VIEW_STATE_KEY

``interface ReviewFlagRef``
---------------------------

.. CG-BLOCK id=interface:ReviewFlagRef lines=21-28

.. literalinclude:: ../../../desktop/src/renderer/src/utils/reviewFlagPrefs.ts
   :language: typescript
   :lines: 21-28
   :lineno-match:

.. CG-EXPLANATION-START id=interface:ReviewFlagRef

**What this does.** A declared shape identifying one review flag: the drilled unit's layer id, the gap it terminates into, and which side it looks toward.

**Why it is here.** These three facts are exactly what pin a flag to one place, so it can be dismissed and recognised again later.

.. CG-EXPLANATION-END id=interface:ReviewFlagRef

``function reviewFlagId``
-------------------------

.. CG-BLOCK id=function:reviewFlagId lines=29-36

.. literalinclude:: ../../../desktop/src/renderer/src/utils/reviewFlagPrefs.ts
   :language: typescript
   :lines: 29-36
   :lineno-match:

.. CG-EXPLANATION-START id=function:reviewFlagId

**What this does.** Turns a flag's three facts into one stable text key, joined by bars.

**Why it is here.** The comment records the key has the same shape as the engine's own force-lens key so the two vocabularies line up, but is kept independent because this is purely interface state.

.. CG-EXPLANATION-END id=function:reviewFlagId

``function readDismissedReviewFlags``
-------------------------------------

.. CG-BLOCK id=function:readDismissedReviewFlags lines=37-69

.. literalinclude:: ../../../desktop/src/renderer/src/utils/reviewFlagPrefs.ts
   :language: typescript
   :lines: 37-69
   :lineno-match:

.. CG-EXPLANATION-START id=function:readDismissedReviewFlags

**What this does.** Reads the set of dismissed flag ids out of a project's saved view state, returning an empty set when the bag is missing or malformed. The block ends with the documentation for the add helper below.

**Why it is here.** The comment records this is best-effort persistence, never a contract — a missing or broken bag simply means nothing has been dismissed yet, not an error.

.. CG-EXPLANATION-END id=function:readDismissedReviewFlags

``function addDismissedReviewFlag``
-----------------------------------

.. CG-BLOCK id=function:addDismissedReviewFlag lines=70-84

.. literalinclude:: ../../../desktop/src/renderer/src/utils/reviewFlagPrefs.ts
   :language: typescript
   :lines: 70-84
   :lineno-match:

.. CG-EXPLANATION-START id=function:addDismissedReviewFlag

**What this does.** Produces the next set to save: it starts from what the server has acknowledged, folds in the dismissals still in flight this session, and adds the flag being dismissed now.

**Why it is here.** The comment records why the in-flight set must be merged: the section row only carries a dismissal once its save has come back, so two "Keep separate" clicks in one round-trip both read the same pre-first state; building the second save from the row alone would send only the second flag, the server would store only that, and the first flag would nag again on the next refresh. Merging the in-flight set makes the dismissed set only ever grow, whatever the round-trip timing.

.. CG-EXPLANATION-END id=function:addDismissedReviewFlag

``function buildReviewFlagPatch``
---------------------------------

.. CG-BLOCK id=function:buildReviewFlagPatch lines=85-87

.. literalinclude:: ../../../desktop/src/renderer/src/utils/reviewFlagPrefs.ts
   :language: typescript
   :lines: 85-87
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildReviewFlagPatch

**What this does.** Builds the small view-state patch that saves the dismissed set under the review-flags key.

**Why it is here.** The comment records the shallow-merge contract: only the review-flags key is overwritten, so sibling bags (the litho segmenter, the CPT channels, and the rest) survive the server-side merge untouched.

.. CG-EXPLANATION-END id=function:buildReviewFlagPatch


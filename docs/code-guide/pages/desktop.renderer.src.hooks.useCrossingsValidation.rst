desktop.renderer.src.hooks.useCrossingsValidation
=================================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useCrossingsValidation.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useCrossingsValidation.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-31

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useCrossingsValidation.ts
   :language: typescript
   :lines: 1-31
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's opening comment and its imports: ``useEffect`` and ``useState`` from React, the API client, the gap-issue response type, and the logger.

**Why it is here.** This hook checks a geological model for crossing surfaces (two formation surfaces that pass through each other, which should not happen). The comment records the whole design (debt #18). The check runs against the cached triangulated surface, which after the on-click-build change can go stale between edits; validating a stale cache once produced a confident amber warning the user could not trust. So the rule is: if any surface is stale, do NOT fetch — instead report a neutral “Build to validate” state; only when nothing is stale does it fetch and report real crossings. It was pulled out of two inline copies so this gating lives in one place, while each inspector keeps its own banner markup.

.. CG-EXPLANATION-END id=module-header

``interface CrossingsValidation``
---------------------------------

.. CG-BLOCK id=interface:CrossingsValidation lines=32-66

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useCrossingsValidation.ts
   :language: typescript
   :lines: 32-66
   :lineno-match:

.. CG-EXPLANATION-START id=interface:CrossingsValidation

**What this does.** Describes the answer the hook hands back: ``crossingIssues`` (the real crossing problems for a fresh model), ``pendingBuild`` (true when surfaces are stale so validation was skipped), and ``validationFailed`` (true when the check request itself failed).

**Why it is here.** The docstrings record a subtle trap the third flag guards: an empty issue list is the shape of THREE different outcomes — a clean model, a skipped check, and a failed check — so a consumer must read ``pendingBuild`` and ``validationFailed`` before treating an empty list as “no crossings”. The additive-only API rule means these flags can be added as new fields without breaking older readers.

.. CG-EXPLANATION-END id=interface:CrossingsValidation

``function useCrossingsValidation``
-----------------------------------

.. CG-BLOCK id=function:useCrossingsValidation lines=67-114

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useCrossingsValidation.ts
   :language: typescript
   :lines: 67-114
   :lineno-match:

.. CG-EXPLANATION-START id=function:useCrossingsValidation

**What this does.** The hook itself. It keeps the issue list and a validation-failed flag as state, and derives ``pendingBuild`` directly from the inputs (a model exists and some surface is stale). An effect re-runs whenever the project, model, a refresh counter, or the stale count changes: if there is no model or the cache is stale it clears the results and stops; otherwise it asks the engine to validate crossings, stores the issues on success, or logs an error and sets the failed flag on failure. A cancel flag in the effect's cleanup makes a slow answer that arrives after the inputs changed be ignored. It returns the three fields.

**Why it is here.** ``pendingBuild`` is derived rather than stored because it is a pure function of the inputs — deriving it avoids a second redraw and any risk of it disagreeing with the issue list. Putting the stale count in the effect's trigger list means a Build that clears staleness (from some to none) automatically re-runs the effect and fetches fresh crossings, so the “re-validate on rebuild” behaviour needs no extra wiring. The failure is logged at the visible error level, not a warning, because the model went unchecked and the engineer is about to Build and export on the assumption that it was checked. The check is a request to the engine — the frontend always goes through the API (CLAUDE.md).

.. CG-EXPLANATION-END id=function:useCrossingsValidation


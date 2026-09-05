desktop.renderer.src.shell.stages.sections.joinErrorToastKey
============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/joinErrorToastKey.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/joinErrorToastKey.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-14

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/joinErrorToastKey.ts
   :language: typescript
   :lines: 1-14
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for a tiny translator helper. When two bodies cannot be joined, the backend rejects the request with a machine-readable code; this file turns that code into a translation KEY the toast then localises.

**Why it is here.** In Dutch mode the backend's English message must never show verbatim, so the catch block reads the structured code and maps it here. Returning the key (not the finished string) keeps the helper pure and testable without a language instance — the caller wraps it in the translator.

.. CG-EXPLANATION-END id=module-header

``type JoinErrorToastKey``
--------------------------

.. CG-BLOCK id=type:JoinErrorToastKey lines=15-39

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/joinErrorToastKey.ts
   :language: typescript
   :lines: 15-39
   :lineno-match:

.. CG-EXPLANATION-START id=type:JoinErrorToastKey

**What this does.** Lists the four toast messages a failed body-Join can produce: same-soil-but-different-packing, different-lithology, a legacy blocked-separation case, and a generic failure. (A ``type`` here is a closed list of the only strings allowed.)

**Why it is here.** A cross-class refusal now splits by whether the two SOILS differ (owner ruling 2026-09-01): same soil plus different packing class reads 'crossPacking', different soil reads 'crossLitho'. The old always-'packing' wording was wrong when the real difference was lithology. The blocked-separation branch no longer fires (the Separate verb was removed) but is kept so a legacy or replayed error still maps to a translated line.

.. CG-EXPLANATION-END id=type:JoinErrorToastKey

``function joinErrorToastKey``
------------------------------

.. CG-BLOCK id=function:joinErrorToastKey lines=40-49

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/joinErrorToastKey.ts
   :language: typescript
   :lines: 40-49
   :lineno-match:

.. CG-EXPLANATION-START id=function:joinErrorToastKey

**What this does.** Reads the rejection's structured code and returns the matching key: for a cross-class refusal it compares the two soil names carried on the error and picks packing-difference when they match, lithology-difference otherwise; a missing or non-string soil falls to the broader lithology message; anything else is the generic failure.

**Why it is here.** A missing soil cannot prove the two bodies are the same soil, so the code refuses to claim a mere packing difference and states the broader fact instead — under-claiming here is safer than a false 'just a density difference'.

.. CG-EXPLANATION-END id=function:joinErrorToastKey


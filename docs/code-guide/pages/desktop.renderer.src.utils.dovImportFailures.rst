desktop.renderer.src.utils.dovImportFailures
============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/dovImportFailures.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/dovImportFailures.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-21

.. literalinclude:: ../../../desktop/src/renderer/src/utils/dovImportFailures.ts
   :language: typescript
   :lines: 1-21
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A comment introducing the single reading of "what did not arrive" from a DOV borehole import, and the import of the import-done payload shape.

**Why it is here.** The comment records the audit (2026-08-02, the class where the app reports a success it did not verify): the importer records a whole failed phase as a counter, not an error, so a dead service quietly counted every borehole as failed and the import continued — the done panel looked identical to a clean import and the toast was green, so the engineer wrongly concluded DOV held no data and never re-ran. This module is the single reading so the panel and the toast can never disagree about whether an import went cleanly.

.. CG-EXPLANATION-END id=module-header

``interface DovSubPhaseFailure``
--------------------------------

.. CG-BLOCK id=interface:DovSubPhaseFailure lines=22-47

.. literalinclude:: ../../../desktop/src/renderer/src/utils/dovImportFailures.ts
   :language: typescript
   :lines: 22-47
   :lineno-match:

.. CG-EXPLANATION-START id=interface:DovSubPhaseFailure

**What this does.** Describes one sub-phase whose rows did not arrive: a user-facing label, the count of affected boreholes, and whether re-running the import would plausibly fetch them.

**Why it is here.** The comment records why the retryable flag matters: a genuine fetch failure comes back on a retry, but a catalogue gap — where DOV says a stream exists yet its own layer returns nothing — returns the same nothing, so telling the engineer to retry sends them in a loop; the two need different copy, so the reading says which one this is.

.. CG-EXPLANATION-END id=interface:DovSubPhaseFailure

``const SUB_PHASE_LABELS``
--------------------------

.. CG-BLOCK id=const:SUB_PHASE_LABELS lines=48-74

.. literalinclude:: ../../../desktop/src/renderer/src/utils/dovImportFailures.ts
   :language: typescript
   :lines: 48-74
   :lineno-match:

.. CG-EXPLANATION-START id=const:SUB_PHASE_LABELS

**What this does.** The ordered list mapping each failure counter in the payload to its display label and whether it is retryable — observations, samples, and the several lab-test kinds, in the order the import runs them.

**Why it is here.** The comment records that the order is chronological so the panel reads in import order, and that the DOV catalogue-gap case is given its own label rather than folded into observations because the fetch succeeded and DOV contradicted itself — the engineer's next move differs (retry a failure, but check by hand for a gap), confirmed live against a specific record.

.. CG-EXPLANATION-END id=const:SUB_PHASE_LABELS

``function dovSubPhaseFailures``
--------------------------------

.. CG-BLOCK id=function:dovSubPhaseFailures lines=75-84

.. literalinclude:: ../../../desktop/src/renderer/src/utils/dovImportFailures.ts
   :language: typescript
   :lines: 75-84
   :lineno-match:

.. CG-EXPLANATION-START id=function:dovSubPhaseFailures

**What this does.** Walks the labelled counters and returns one entry per sub-phase whose failure count is above zero, in import order.

**Why it is here.** The docstring records that an empty result is the only case a caller may present as a plain success — so anything that failed is guaranteed to surface rather than being hidden behind a green toast.

.. CG-EXPLANATION-END id=function:dovSubPhaseFailures


desktop.renderer.src.utils.subdivideCptsToast
=============================================

.. CG-PAGE source=desktop/src/renderer/src/utils/subdivideCptsToast.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/subdivideCptsToast.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-19

.. literalinclude:: ../../../desktop/src/renderer/src/utils/subdivideCptsToast.ts
   :language: typescript
   :lines: 1-19
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Builds the one-sentence success message shown after pipeline step 1 (subdivide CPTs) of the geotech stage. The comment records what the sentence must say and what it must stay silent about.

**Why it is here.** The comment cites two owner rulings. It was pulled out of ``useGeologicalModel`` (2 700 lines, debt #201) when the 2026-08-15 ruling made scope matter — "i want subdivide cpt's also to be section scoped" — so a bare count with no scope no longer told the owner what had moved. It briefly reported off-section skips too, and the owner threw that out the same day ("wtf are of section skips, this is useless info for the user?"): a column he never put on a cross-section is not work he lost, so the sentence stays silent about it — while the count and names still reach the backend log at INFO (the audit trail) and the response still carries the skipped counts (the API contract), only the toast is quiet. It is pure so the wording can be pinned in a test without driving the large hook.

.. CG-EXPLANATION-END id=module-header

``interface SubdivideCptsToastInput``
-------------------------------------

.. CG-BLOCK id=interface:SubdivideCptsToastInput lines=20-40

.. literalinclude:: ../../../desktop/src/renderer/src/utils/subdivideCptsToast.ts
   :language: typescript
   :lines: 20-40
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SubdivideCptsToastInput

**What this does.** Everything the sentence is assembled from: whether the press was scoped to the open section, how many body groups received a consistent multi-band split, how many were given a single representative NAD class, how many were borehole-only, how many accepted packing ties were carried across the rebuild, and whether this was the combined legacy verb that does steps 1 and 2 in one press. It then documents the function below.

**Why it is here.** The comments record two points: a borehole-only body has no CPT cone-resistance to classify from, and the combined verb has already done step 2, which changes the sentence's closing line. The NAD packing class named here is a characterisation output (an MVP result), not a design parameter — design-ready values stay Phase 5.

.. CG-EXPLANATION-END id=interface:SubdivideCptsToastInput

``function subdivideCptsToast``
-------------------------------

.. CG-BLOCK id=function:subdivideCptsToast lines=41-58

.. literalinclude:: ../../../desktop/src/renderer/src/utils/subdivideCptsToast.ts
   :language: typescript
   :lines: 41-58
   :lineno-match:

.. CG-EXPLANATION-START id=function:subdivideCptsToast

**What this does.** Composes the sentence. It picks the scope phrase ("on this section" or "on all sections"), states the split and single-class counts, adds an optional borehole-only note and an optional "accepted ties kept" note, and — unless this was the combined verb — appends "Next: 2 · Auto-correlate."

**Why it is here.** The comment records why the hand-off line is there: step 1 deliberately correlates nothing, so the toast has to point at the next press, or the still-empty geotech axis reads as a failure rather than as "your turn"; the combined verb already did step 2, so it omits the hand-off.

.. CG-EXPLANATION-END id=function:subdivideCptsToast


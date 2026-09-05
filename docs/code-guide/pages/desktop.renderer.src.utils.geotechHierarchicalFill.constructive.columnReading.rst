desktop.renderer.src.utils.geotechHierarchicalFill.constructive.columnReading
=============================================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/columnReading.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/columnReading.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-60

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/columnReading.ts
   :language: typescript
   :lines: 1-60
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the module holding ONE reading test — the single question 'did this column measure the ground at these levels?'. It imports only the band type, since it needs to read a column's bands but takes no action on them.

**Why it is here.** Owner ruling 2026-08-25. The docstring records that until then two callers asked this question differently — one of the whole column's bands, one of only this family's — which let a band close twice. Unifying them onto one predicate means their two answers can never drift apart again, which the docstring names as the actual invariant: a band closes where the ground stops being unread, and it does so exactly once.

.. CG-EXPLANATION-END id=module-header

``const OVERLAP_EPS``
---------------------

.. CG-BLOCK id=const:OVERLAP_EPS lines=61-72

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/columnReading.ts
   :language: typescript
   :lines: 61-72
   :lineno-match:

.. CG-EXPLANATION-START id=const:OVERLAP_EPS

**What this does.** A constant, 1e-6 m — the vertical overlap below which a band merely touches an elevation window rather than reads it.

**Why it is here.** A column's stack partitions its own litho, so the band above a window ends exactly where the window begins; a shared contact must not count as a reading, and this epsilon absorbs the float noise around it. The docstring records that it was measured interchangeable with a bare zero on the real data — the defect was always the SCOPE of the question, never its tolerance — and that a graze tolerance is deliberately kept out, because what counts as evidence is an owner call, not an implementation detail to slip in.

.. CG-EXPLANATION-END id=const:OVERLAP_EPS

``function readsWindow``
------------------------

.. CG-BLOCK id=function:readsWindow lines=73-82

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechHierarchicalFill/constructive/columnReading.ts
   :language: typescript
   :lines: 73-82
   :lineno-match:

.. CG-EXPLANATION-START id=function:readsWindow

**What this does.** Returns true when at least one band on the column overlaps the given elevation window by more than ``OVERLAP_EPS``; a column with no stack at all returns false.

**Why it is here.** This is the one shared predicate the whole module exists to provide, so every caller reads 'did this column read this ground' in exactly the same way and their answers cannot diverge.

.. CG-EXPLANATION-END id=function:readsWindow


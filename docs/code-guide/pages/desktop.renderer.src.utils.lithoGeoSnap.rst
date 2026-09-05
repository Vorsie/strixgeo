desktop.renderer.src.utils.lithoGeoSnap
=======================================

.. CG-PAGE source=desktop/src/renderer/src/utils/lithoGeoSnap.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/lithoGeoSnap.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-13

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoGeoSnap.ts
   :language: typescript
   :lines: 1-13
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The opening comment and the one import. This file holds a pure helper — its answer depends only on its inputs — that finds geological contacts sitting within a small depth tolerance of a litho contact on the same investigation.

**Why it is here.** The comment records the purpose: preventing slivers (debt #134) when a litho boundary lands almost on top of a geological surface. Candidates come back nearest-first, and when two are equally close the deeper one comes first, following the geological superposition convention — the deeper surface is the established anchor and the shallower one is the surface the engineer is more likely editing (owner directive 2026-05-26).

.. CG-EXPLANATION-END id=module-header

``function contactAnchorId``
----------------------------

.. CG-BLOCK id=function:contactAnchorId lines=14-39

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoGeoSnap.ts
   :language: typescript
   :lines: 14-39
   :lineno-match:

.. CG-EXPLANATION-START id=function:contactAnchorId

**What this does.** Returns the investigation a contact belongs to — its borehole id, or failing that its CPT id, or nothing if it has neither.

**Why it is here.** A geological contact sits on exactly one investigation; this reads whichever of the two ids it carries so the search can keep only same-investigation contacts.

.. CG-EXPLANATION-END id=function:contactAnchorId

``function findGeoSnapCandidates``
----------------------------------

.. CG-BLOCK id=function:findGeoSnapCandidates lines=40-65

.. literalinclude:: ../../../desktop/src/renderer/src/utils/lithoGeoSnap.ts
   :language: typescript
   :lines: 40-65
   :lineno-match:

.. CG-EXPLANATION-START id=function:findGeoSnapCandidates

**What this does.** Scans every geological contact in scope, keeps those on the same investigation whose depth is within the tolerance of the given litho depth, and returns them sorted nearest-first with equal distances broken deeper-first.

**Why it is here.** The docstring records the inclusive snap tolerance (owner default 0.20 m). A comment records why a tiny epsilon is added to the comparison: because of floating-point arithmetic, 7.2 minus 7.0 lands at 0.20000000000000018, so a plain "greater than" test would silently reject boundary cases the engineer thinks of as "exactly on tolerance". Ties are broken deeper-first for stratigraphic superposition.

.. CG-EXPLANATION-END id=function:findGeoSnapCandidates


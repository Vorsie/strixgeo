desktop.renderer.src.utils.crossingFocus
========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/crossingFocus.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/crossingFocus.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-26

.. literalinclude:: ../../../desktop/src/renderer/src/utils/crossingFocus.ts
   :language: typescript
   :lines: 1-26
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** A comment describing what these pure helpers do for the surface-crossings banner: given a crossing issue (a list of offending contact ids), work out which investigations those contacts anchor and which cross-sections contain at least one of them, so the banner can either navigate straight there or open a picker. It then imports the two response shapes and the point-projection helper.

**Why it is here.** The comment records that the banner click handler uses this to choose between direct navigation for a single candidate and a picker dialog for several, and that the behaviour is pinned by a test so a future refactor cannot quietly drop the rule that every section containing any offending anchor is a candidate.

.. CG-EXPLANATION-END id=module-header

``interface AnchorPoint``
-------------------------

.. CG-BLOCK id=interface:AnchorPoint lines=27-45

.. literalinclude:: ../../../desktop/src/renderer/src/utils/crossingFocus.ts
   :language: typescript
   :lines: 27-45
   :lineno-match:

.. CG-EXPLANATION-START id=interface:AnchorPoint

**What this does.** Describes the minimal shape of an anchor point: an id and its coordinates, which may be null. The block also shows the function's documentation of which sections it returns.

**Why it is here.** The comment records that the coordinates are typed as possibly-null so the helper accepts either a list-item source (whose coordinates are always present) or a response source (whose coordinates can be absent) without an explicit conversion.

.. CG-EXPLANATION-END id=interface:AnchorPoint

``function resolveCandidateCrossingSections``
---------------------------------------------

.. CG-BLOCK id=function:resolveCandidateCrossingSections lines=46-77

.. literalinclude:: ../../../desktop/src/renderer/src/utils/crossingFocus.ts
   :language: typescript
   :lines: 46-77
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolveCandidateCrossingSections

**What this does.** Returns the cross-sections that contain at least one offending anchor within their projection corridor. It finds the offending contacts, gathers the coordinates of the boreholes or CPTs they anchor (skipping any with missing coordinates), and keeps the sections onto whose line at least one of those points projects within the corridor half-width. It returns an empty list at each dead end — no ids, no offending contacts, or no resolvable anchors.

**Why it is here.** The docstring records that the candidates come back in the same order as the sections for a stable picker, that sections not carrying the crossing's contacts are excluded because they have no offending column to pan to, and that an empty result is returned gracefully when the contacts reference deleted rows or anchors without coordinates — the banner must not break on stale state.

.. CG-EXPLANATION-END id=function:resolveCandidateCrossingSections


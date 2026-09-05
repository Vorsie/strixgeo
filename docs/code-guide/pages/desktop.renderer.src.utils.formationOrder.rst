desktop.renderer.src.utils.formationOrder
=========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/formationOrder.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/formationOrder.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-25

.. literalinclude:: ../../../desktop/src/renderer/src/utils/formationOrder.ts
   :language: typescript
   :lines: 1-25
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file holds the helpers that order a formation list. The comment explains the two directions in play: ``display_order`` is the age axis, where a lower number means older and deeper; renderers paint the section from oldest up (the geological superposition rule), but list views that read like a borehole log — the Geology inspector list, the 3-D Layers legend, and the click-to-place picker — show youngest first, surface at the top. It imports the formation response type.

**Why it is here.** The comment states the purpose plainly: this file is the single source of that youngest-first reading order so the three list views that share it stay in sync, rather than each re-deriving the sort and drifting apart.

.. CG-EXPLANATION-END id=module-header

``function compareFormationsOldestFirst``
-----------------------------------------

.. CG-BLOCK id=function:compareFormationsOldestFirst lines=26-44

.. literalinclude:: ../../../desktop/src/renderer/src/utils/formationOrder.ts
   :language: typescript
   :lines: 26-44
   :lineno-match:

.. CG-EXPLANATION-START id=function:compareFormationsOldestFirst

**What this does.** Compares two formations for an oldest-first sort: it orders by ``display_order`` ascending, and when two share the same order it breaks the tie by name, case-insensitively. It returns a negative number when the first formation is older (sorts first) and positive when younger.

**Why it is here.** This is the single comparator the ascending inspector list uses directly, and that the youngest-first helper reverses — keeping the sort rule in one place. The case-insensitive name tie-break makes the order stable and predictable when two formations sit at the same age.

.. CG-EXPLANATION-END id=function:compareFormationsOldestFirst

``function formationsYoungestFirst``
------------------------------------

.. CG-BLOCK id=function:formationsYoungestFirst lines=45-49

.. literalinclude:: ../../../desktop/src/renderer/src/utils/formationOrder.ts
   :language: typescript
   :lines: 45-49
   :lineno-match:

.. CG-EXPLANATION-START id=function:formationsYoungestFirst

**What this does.** Returns a new copy of the given formations ordered youngest first — it sorts them oldest-first with the comparator above, then reverses the result. It does not change the input list.

**Why it is here.** Doing "sort ascending, then reverse" (rather than a separate descending comparator) means formations that share the same age fall in the same relative order as they do in the ascending inspector list, so the two views agree. Not mutating the input keeps it a *pure function* — its output depends only on its input and it changes nothing outside itself — which is safe because the model bus hands the same array to several readers.

.. CG-EXPLANATION-END id=function:formationsYoungestFirst


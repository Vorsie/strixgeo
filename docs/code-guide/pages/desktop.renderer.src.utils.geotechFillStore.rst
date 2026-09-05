desktop.renderer.src.utils.geotechFillStore
===========================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechFillStore.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechFillStore.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-45

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechFillStore.ts
   :language: typescript
   :lines: 1-45
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file is a small shared holder — a *store* — for the geotech axis "show / hide fill" toggle. The comment explains that the geotech view draws the connected-body packing partition as a filled 2-D map, which can be visually busy on a densely-correlated model, so the engineer needs to strip it to see the correlation ribbons underneath. It imports the boolean-store factory and two writer functions from the sibling litho-fill and built-model-fill stores.

**Why it is here.** As the comment records, it follows the same store pattern introduced on the ``formationFillStore`` page — one boolean driven from the toolbar and read through ``useSyncExternalStore`` — and it gates the geotech fill independently of the litho fill store. Two decisions are documented in detail: it defaults to OFF by owner ruling (2026-08-15) because the old default-on turned the fill on by itself mid-review, so the fill is now always an explicit press; and it is separate from the accepted-tie gate in ``sectionFillSelection`` because those answer two different questions — "did the engineer ask for it" and "is there anything worth painting" — and both must be yes. It is transient chrome, never persisted.

.. CG-EXPLANATION-END id=module-header

``const store``
---------------

.. CG-BLOCK id=const:store lines=46-51

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechFillStore.ts
   :language: typescript
   :lines: 46-51
   :lineno-match:

.. CG-EXPLANATION-START id=const:store

**What this does.** Creates the boolean store, started in the "off" (fill hidden) state.

**Why it is here.** Off is the owner-ruled default so the fill only ever appears on an explicit press, as the file comment records.

.. CG-EXPLANATION-END id=const:store

``function toggleGeotechFill``
------------------------------

.. CG-BLOCK id=function:toggleGeotechFill lines=52-60

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechFillStore.ts
   :language: typescript
   :lines: 52-60
   :lineno-match:

.. CG-EXPLANATION-START id=function:toggleGeotechFill

**What this does.** Flips the geotech fill visibility and, when the flip turns it on, also turns off the litho fill and the built-model fill.

**Why it is here.** The three fills this axis can paint are mutually exclusive by owner ask (2026-08-15, extended to the built model 2026-08-26) — only one fill on at a time — so turning this one on hides the other two; turning it off never brings them back, because no fill at all is a legitimate state.

.. CG-EXPLANATION-END id=function:toggleGeotechFill

``function setGeotechFill``
---------------------------

.. CG-BLOCK id=function:setGeotechFill lines=61-65

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechFillStore.ts
   :language: typescript
   :lines: 61-65
   :lineno-match:

.. CG-EXPLANATION-START id=function:setGeotechFill

**What this does.** Sets the geotech fill visibility to a given value directly, with no effect on the other fills.

**Why it is here.** A plain setter for callers that need to set the value without triggering the mutual-exclusion behaviour the toggle applies.

.. CG-EXPLANATION-END id=function:setGeotechFill

``function getGeotechFillVisible``
----------------------------------

.. CG-BLOCK id=function:getGeotechFillVisible lines=66-70

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechFillStore.ts
   :language: typescript
   :lines: 66-70
   :lineno-match:

.. CG-EXPLANATION-START id=function:getGeotechFillVisible

**What this does.** Reads the current geotech fill visibility once, without subscribing to changes.

**Why it is here.** A non-reactive read for code that needs the value at a moment in time rather than a component that redraws on change.

.. CG-EXPLANATION-END id=function:getGeotechFillVisible

``function useGeotechFillVisible``
----------------------------------

.. CG-BLOCK id=function:useGeotechFillVisible lines=71-73

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechFillStore.ts
   :language: typescript
   :lines: 71-73
   :lineno-match:

.. CG-EXPLANATION-START id=function:useGeotechFillVisible

**What this does.** A hook that returns the current visibility and re-draws the calling component when the toggle flips.

**Why it is here.** The reactive read built on ``useSyncExternalStore``, the same as on the ``formationFillStore`` page.

.. CG-EXPLANATION-END id=function:useGeotechFillVisible


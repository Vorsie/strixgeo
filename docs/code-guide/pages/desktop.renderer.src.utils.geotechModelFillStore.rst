desktop.renderer.src.utils.geotechModelFillStore
================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechModelFillStore.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechModelFillStore.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-32

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechModelFillStore.ts
   :language: typescript
   :lines: 1-32
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file is a small shared holder — a *store* — for the geotech axis "show / hide model fill" toggle. The comment explains it is the peer of the litho model-fill store: both gate the same overlay (the section fill cut out of the built 3-D body solids), but each axis shows the model it belongs to, so each needs its own switch. It imports the boolean-store factory and the two sibling fill setters.

**Why it is here.** As the comment records, it follows the same store pattern introduced on the ``formationFillStore`` page. Two decisions are documented: it defaults to OFF, deliberately unlike its litho peer which has always defaulted on, because the owner asked (2026-08-26) for a new model fill next to the old show-fill, and a default-on model fill would silently take over the axis on reload since it excludes the packing fill; and it is transient chrome, never persisted, so a reload puts the engineer back on his own fill.

.. CG-EXPLANATION-END id=module-header

``const store``
---------------

.. CG-BLOCK id=const:store lines=33-37

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechModelFillStore.ts
   :language: typescript
   :lines: 33-37
   :lineno-match:

.. CG-EXPLANATION-START id=const:store

**What this does.** Creates the boolean store, started in the "off" (model fill hidden) state.

**Why it is here.** Off is deliberate, for the reason the file comment records — a default-on model fill would take over the axis on reload.

.. CG-EXPLANATION-END id=const:store

``function toggleGeotechModelFill``
-----------------------------------

.. CG-BLOCK id=function:toggleGeotechModelFill lines=38-46

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechModelFillStore.ts
   :language: typescript
   :lines: 38-46
   :lineno-match:

.. CG-EXPLANATION-START id=function:toggleGeotechModelFill

**What this does.** Flips the model-fill visibility and, when the flip turns it on, turns off both of the axis's 2-D fills.

**Why it is here.** The geotech axis paints only one fill at a time (owner ask, 2026-08-15); the model fill is the third member of that mutually-exclusive set, so turning it on hides the other two, and turning it off never brings them back because no fill is a legitimate state.

.. CG-EXPLANATION-END id=function:toggleGeotechModelFill

``function setGeotechModelFill``
--------------------------------

.. CG-BLOCK id=function:setGeotechModelFill lines=47-51

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechModelFillStore.ts
   :language: typescript
   :lines: 47-51
   :lineno-match:

.. CG-EXPLANATION-START id=function:setGeotechModelFill

**What this does.** Sets the model-fill visibility directly, with no effect on the other fills.

**Why it is here.** A plain setter for callers that need to set the value without the mutual-exclusion side effect — the sibling stores call this one when they turn themselves on.

.. CG-EXPLANATION-END id=function:setGeotechModelFill

``function getGeotechModelFillVisible``
---------------------------------------

.. CG-BLOCK id=function:getGeotechModelFillVisible lines=52-56

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechModelFillStore.ts
   :language: typescript
   :lines: 52-56
   :lineno-match:

.. CG-EXPLANATION-START id=function:getGeotechModelFillVisible

**What this does.** Reads the current model-fill visibility once, without subscribing to changes.

**Why it is here.** A non-reactive read for code that needs the value at a moment in time rather than a component that redraws on change.

.. CG-EXPLANATION-END id=function:getGeotechModelFillVisible

``function useGeotechModelFillVisible``
---------------------------------------

.. CG-BLOCK id=function:useGeotechModelFillVisible lines=57-59

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechModelFillStore.ts
   :language: typescript
   :lines: 57-59
   :lineno-match:

.. CG-EXPLANATION-START id=function:useGeotechModelFillVisible

**What this does.** A hook that returns the current visibility and re-draws the calling component when the toggle flips.

**Why it is here.** The reactive read built on ``useSyncExternalStore``, the same as on the ``formationFillStore`` page.

.. CG-EXPLANATION-END id=function:useGeotechModelFillVisible


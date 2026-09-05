desktop.renderer.src.components.sections.unjoinSpotlight
========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/unjoinSpotlight.ts complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/unjoinSpotlight.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-33

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/unjoinSpotlight.ts
   :language: typescript
   :lines: 1-33
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The un-join spotlight guard: it decides which layer the overlay should light up when the engineer hovers the Un-join-from menu item. The comment after describes the function.

**Why it is here.** Debt #278 D3. Hovering the un-join item hands the overlay the other body's anchor layer id; the overlay then dims every fill and lets only the fills carrying that layer stand at full opacity, but only when SOMETHING on screen carries it. An anchor that surfaces nowhere would dim the whole canvas and highlight nothing, which reads as a broken response, so the guard withholds the highlight in that case and the normal render stands. The D3 fix is that an anchor may surface ONLY as an on-column band (a column strip), never in a between-column region, so the guard now consults both the between-column region layer sets AND the on-column strips.

.. CG-EXPLANATION-END id=module-header

``function resolveHighlightLayer``
----------------------------------

.. CG-BLOCK id=function:resolveHighlightLayer lines=34-44

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/unjoinSpotlight.ts
   :language: typescript
   :lines: 34-44
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolveHighlightLayer

**What this does.** Returns the layer id to light when a region or a strip carries it, or nothing (the normal render) when no highlight is set or when nothing on screen carries it.

**Why it is here.** It withholds the highlight rather than dimming the whole canvas to nothing whenever the anchor surfaces nowhere.

.. CG-EXPLANATION-END id=function:resolveHighlightLayer


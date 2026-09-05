desktop.renderer.src.utils.geotechPreviewRenderStore
====================================================

.. CG-PAGE source=desktop/src/renderer/src/utils/geotechPreviewRenderStore.ts complete=true

*Source file:* ``desktop/src/renderer/src/utils/geotechPreviewRenderStore.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-34

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechPreviewRenderStore.ts
   :language: typescript
   :lines: 1-34
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** This file is a small shared holder — a *store* — for a summary of what the borehole packing-preview overlay actually drew, published so the toolbar can react to it. The comment explains the problem: the toolbar's "hatched = preview" legend must appear exactly when something hatched is on screen, and deriving that in the toolbar was wrong whenever the overlay declined to draw for a reason the toolbar could not see (a column with no collar elevation, a preview still loading, a preview that errored). Only the overlay knows what it drew, so the overlay publishes it here. A clamped-band count rides along so a planned band that fell entirely outside the depth window is surfaced rather than silently implying nothing is planned there. It imports React's ``useSyncExternalStore``.

**Why it is here.** As the comment records, it follows the same store pattern introduced on the ``formationFillStore`` page but holds a small record rather than a boolean, so it does not use the boolean-store factory. The snapshot is cached and only replaced when a number actually changes, because ``useSyncExternalStore`` redraws on every change of the snapshot's identity, so handing it a fresh object each render would spin an endless redraw loop. It is module-global and never persisted because it describes the current frame, not the project.

.. CG-EXPLANATION-END id=module-header

``interface GeotechPreviewRender``
----------------------------------

.. CG-BLOCK id=interface:GeotechPreviewRender lines=35-47

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechPreviewRenderStore.ts
   :language: typescript
   :lines: 35-47
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechPreviewRender

**What this does.** Describes the summary of the ghost bands currently on screen: how many borehole columns carry at least one drawn ghost band, how many ghost bands were drawn (including ones drawn at a one-pixel floor), and how many planned bands fell entirely outside the visible depth window so no pixel of them exists.

**Why it is here.** The clamped count is carried, rather than swallowed, so the engineer is told a band is planned but off-screen — the one thing this feature must never let silence imply is "nothing is planned at this depth".

.. CG-EXPLANATION-END id=interface:GeotechPreviewRender

``const EMPTY_GEOTECH_PREVIEW_RENDER``
--------------------------------------

.. CG-BLOCK id=const:EMPTY_GEOTECH_PREVIEW_RENDER lines=48-53

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechPreviewRenderStore.ts
   :language: typescript
   :lines: 48-53
   :lineno-match:

.. CG-EXPLANATION-START id=const:EMPTY_GEOTECH_PREVIEW_RENDER

**What this does.** The all-zero summary meaning nothing is hatched — the starting value and what a reset restores. It is frozen so it cannot be changed.

**Why it is here.** A single shared empty value lets a reset return to a known snapshot by identity, which the reset function relies on to skip a needless notification.

.. CG-EXPLANATION-END id=const:EMPTY_GEOTECH_PREVIEW_RENDER

``let snapshot``
----------------

.. CG-BLOCK id=let:snapshot lines=54-54

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechPreviewRenderStore.ts
   :language: typescript
   :lines: 54-54
   :lineno-match:

.. CG-EXPLANATION-START id=let:snapshot

**What this does.** The module-level holder of the last published summary, starting empty.

**Why it is here.** One shared value the readers report and the publisher replaces; caching it by identity is what keeps subscribers from redrawing on an unchanged frame.

.. CG-EXPLANATION-END id=let:snapshot

``const listeners``
-------------------

.. CG-BLOCK id=const:listeners lines=55-56

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechPreviewRenderStore.ts
   :language: typescript
   :lines: 55-56
   :lineno-match:

.. CG-EXPLANATION-START id=const:listeners

**What this does.** The set of callbacks to run when the summary changes.

**Why it is here.** The *subscribe/notify* backing of the store — the list of components to tell when the drawn-ghost numbers change.

.. CG-EXPLANATION-END id=const:listeners

``function notify``
-------------------

.. CG-BLOCK id=function:notify lines=57-73

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechPreviewRenderStore.ts
   :language: typescript
   :lines: 57-73
   :lineno-match:

.. CG-EXPLANATION-START id=function:notify

**What this does.** Calls every registered listener.

**Why it is here.** The single place that tells all subscribers the summary changed.

.. CG-EXPLANATION-END id=function:notify

``function subscribeGeotechPreviewRender``
------------------------------------------

.. CG-BLOCK id=function:subscribeGeotechPreviewRender lines=74-88

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechPreviewRenderStore.ts
   :language: typescript
   :lines: 74-88
   :lineno-match:

.. CG-EXPLANATION-START id=function:subscribeGeotechPreviewRender

**What this does.** Registers a callback to run whenever the published numbers change, and returns a function that unregisters it.

**Why it is here.** The *subscribe* half ``useSyncExternalStore`` requires; the returned unregister function lets React clean up when a component goes away.

.. CG-EXPLANATION-END id=function:subscribeGeotechPreviewRender

``function getGeotechPreviewRender``
------------------------------------

.. CG-BLOCK id=function:getGeotechPreviewRender lines=89-103

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechPreviewRenderStore.ts
   :language: typescript
   :lines: 89-103
   :lineno-match:

.. CG-EXPLANATION-START id=function:getGeotechPreviewRender

**What this does.** Reads the current summary once, without subscribing.

**Why it is here.** The snapshot getter ``useSyncExternalStore`` reads, and a plain read for any code that needs the value at a moment in time.

.. CG-EXPLANATION-END id=function:getGeotechPreviewRender

``function publishGeotechPreviewRender``
----------------------------------------

.. CG-BLOCK id=function:publishGeotechPreviewRender lines=104-120

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechPreviewRenderStore.ts
   :language: typescript
   :lines: 104-120
   :lineno-match:

.. CG-EXPLANATION-START id=function:publishGeotechPreviewRender

**What this does.** Publishes the counts for the frame just drawn. If every number matches the current snapshot it does nothing; otherwise it replaces the snapshot with a fresh record and notifies subscribers.

**Why it is here.** The no-op-on-unchanged check is what keeps the snapshot's identity stable across repeats, so ``useSyncExternalStore`` consumers do not redraw when the overlay drew the same thing again — the loop the module header warns about.

.. CG-EXPLANATION-END id=function:publishGeotechPreviewRender

``function resetGeotechPreviewRender``
--------------------------------------

.. CG-BLOCK id=function:resetGeotechPreviewRender lines=121-134

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechPreviewRenderStore.ts
   :language: typescript
   :lines: 121-134
   :lineno-match:

.. CG-EXPLANATION-START id=function:resetGeotechPreviewRender

**What this does.** Declares that nothing is hatched, restoring the empty summary — used when the overlay unmounts or drew nothing. It does nothing if the snapshot is already the empty one.

**Why it is here.** Skipping the notify when already empty avoids a needless redraw, and reusing the shared frozen empty value makes that identity check exact.

.. CG-EXPLANATION-END id=function:resetGeotechPreviewRender

``function useGeotechPreviewRender``
------------------------------------

.. CG-BLOCK id=function:useGeotechPreviewRender lines=135-137

.. literalinclude:: ../../../desktop/src/renderer/src/utils/geotechPreviewRenderStore.ts
   :language: typescript
   :lines: 135-137
   :lineno-match:

.. CG-EXPLANATION-START id=function:useGeotechPreviewRender

**What this does.** A hook that returns the current summary and re-draws the calling component when it changes.

**Why it is here.** The reactive read built on ``useSyncExternalStore``, the same pattern as on the ``formationFillStore`` page.

.. CG-EXPLANATION-END id=function:useGeotechPreviewRender


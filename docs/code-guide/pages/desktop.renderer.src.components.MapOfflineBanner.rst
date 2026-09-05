desktop.renderer.src.components.MapOfflineBanner
================================================

.. CG-PAGE source=desktop/src/renderer/src/components/MapOfflineBanner.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/MapOfflineBanner.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-26

.. literalinclude:: ../../../desktop/src/renderer/src/components/MapOfflineBanner.tsx
   :language: tsx
   :lines: 1-26
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top comment, docstring and single import for the 2D map's offline banner. It imports only the translator.

**Why it is here.** The comment records the reason (audit L9): when the browser has no connectivity the basemap tiles fail and the map goes grey with no explanation, so this gives the 2D map the same offline signal the 3D viewer already shows. It is kept in its own map-library-free module so it can be tested without mounting the whole map, with the map view feeding it the online state from the shared online-status hook.

.. CG-EXPLANATION-END id=module-header

``function MapOfflineBanner``
-----------------------------

.. CG-BLOCK id=function:MapOfflineBanner lines=27-40

.. literalinclude:: ../../../desktop/src/renderer/src/components/MapOfflineBanner.tsx
   :language: tsx
   :lines: 27-40
   :lineno-match:

.. CG-EXPLANATION-START id=function:MapOfflineBanner

**What this does.** Draws a small bottom-centred amber "offline" banner, and nothing when online. It ignores pointer events.

**Why it is here.** It mirrors the 3D viewer's banner so the two read alike, uses amber for this soft, non-error condition (memory: amber, never red, for soft states), and lets pointer events pass through so it never blocks a map drag beneath it.

.. CG-EXPLANATION-END id=function:MapOfflineBanner


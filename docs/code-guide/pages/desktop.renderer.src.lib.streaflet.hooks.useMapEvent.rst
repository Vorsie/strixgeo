desktop.renderer.src.lib.streaflet.hooks.useMapEvent
====================================================

.. CG-PAGE source=desktop/src/renderer/src/lib/streaflet/hooks/useMapEvent.ts complete=true

*Source file:* ``desktop/src/renderer/src/lib/streaflet/hooks/useMapEvent.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-4

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/hooks/useMapEvent.ts
   :language: typescript
   :lines: 1-4
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports Leaflet's types under ``L`` and the sibling hook ``useMapEvents``.

**Why it is here.** This is a one-line convenience built directly on ``useMapEvents`` (see that page), so it needs nothing else.

.. CG-EXPLANATION-END id=module-header

``function useMapEvent``
------------------------

.. CG-BLOCK id=function:useMapEvent lines=5-10

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/hooks/useMapEvent.ts
   :language: typescript
   :lines: 5-10
   :lineno-match:

.. CG-EXPLANATION-START id=function:useMapEvent

**What this does.** A hook to listen for a single named map event. It takes one event name and one handler, wraps them as a one-entry set, and passes that to ``useMapEvents``, returning the map.

**Why it is here.** It exists purely for readability: subscribing to just one event (say a map click) reads more clearly as ``useMapEvent`` than as building a one-entry set by hand. All the real binding and cleanup happen in ``useMapEvents`` on that page.

.. CG-EXPLANATION-END id=function:useMapEvent


desktop.renderer.src.lib.streaflet.hooks.useMap
===============================================

.. CG-PAGE source=desktop/src/renderer/src/lib/streaflet/hooks/useMap.ts complete=true

*Source file:* ``desktop/src/renderer/src/lib/streaflet/hooks/useMap.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-4

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/hooks/useMap.ts
   :language: typescript
   :lines: 1-4
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports the map-context reader and Leaflet's types under ``L``.

**Why it is here.** This is the smallest, most-used hook in the library, so it depends on nothing but the shared context (see the ``MapContext`` page).

.. CG-EXPLANATION-END id=module-header

``function useMap``
-------------------

.. CG-BLOCK id=function:useMap lines=5-7

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/hooks/useMap.ts
   :language: typescript
   :lines: 5-7
   :lineno-match:

.. CG-EXPLANATION-START id=function:useMap

**What this does.** A hook that returns the parent map. It reads the shared context and hands back just the map, throwing a clear error if it is called outside a ``<MapContainer>``.

**Why it is here.** This is the plain, public way any component inside the map reaches the map to command it (pan, zoom, query). It leans on the context reader from the ``MapContext`` page, so the outside-a-map error is handled in one place. A **hook** is a helper whose name starts with ``use…`` that a component calls to reach shared machinery.

.. CG-EXPLANATION-END id=function:useMap


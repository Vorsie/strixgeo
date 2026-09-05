desktop.renderer.src.lib.streaflet.core.MapContext
==================================================

.. CG-PAGE source=desktop/src/renderer/src/lib/streaflet/core/MapContext.ts complete=true

*Source file:* ``desktop/src/renderer/src/lib/streaflet/core/MapContext.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-4

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/core/MapContext.ts
   :language: typescript
   :lines: 1-4
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports React's two context tools — ``createContext`` (which makes a shared channel) and ``useContext`` (which reads it) — and Leaflet's types under the name ``L``. Line 4 opens the comment for the shared value defined below.

**Why it is here.** **React context** is React's built-in way to pass one shared value down through many nested components without handing it to each by hand. This tiny file defines the single channel every streaflet component uses to reach the map it belongs to, so it needs only these two tools.

.. CG-EXPLANATION-END id=module-header

``interface StreafletContextValue``
-----------------------------------

.. CG-BLOCK id=interface:StreafletContextValue lines=5-13

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/core/MapContext.ts
   :language: typescript
   :lines: 5-13
   :lineno-match:

.. CG-EXPLANATION-START id=interface:StreafletContextValue

**What this does.** Describes the three things carried down through the map's component tree: ``map`` — the one root Leaflet map; ``layerContainer`` — the nearest thing new layers should attach to (a group or pane if there is one, otherwise the map itself); and an optional ``parentLayer`` — the nearest enclosing layer, which is what a tooltip or popup placed inside will bind to.

**Why it is here.** An **interface** is a note listing which fields a value carries. Naming these three fields once, in one place, is what lets a ``Marker`` know which map it is on, a shape know which group to join, and a ``Popup`` know which marker to attach to — all without any component being told explicitly. The three fields are marked read-only because a component should use the context it is given, never rewrite it.

.. CG-EXPLANATION-END id=interface:StreafletContextValue

``const MapContext``
--------------------

.. CG-BLOCK id=const:MapContext lines=14-16

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/core/MapContext.ts
   :language: typescript
   :lines: 14-16
   :lineno-match:

.. CG-EXPLANATION-START id=const:MapContext

**What this does.** Creates the actual shared channel, starting empty (``null``) until a ``<MapContainer>`` fills it with a real map.

**Why it is here.** The starting value is ``null`` on purpose: it is the signal that a component was placed outside any map, which the reader below turns into a clear error rather than a confusing crash deep inside Leaflet.

.. CG-EXPLANATION-END id=const:MapContext

``function useStreafletContext``
--------------------------------

.. CG-BLOCK id=function:useStreafletContext lines=17-23

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/core/MapContext.ts
   :language: typescript
   :lines: 17-23
   :lineno-match:

.. CG-EXPLANATION-START id=function:useStreafletContext

**What this does.** The internal helper every component uses to read the shared value. It fetches the current context and, if it is still empty, throws a clear error saying the component was used outside ``<MapContainer>``; otherwise it returns the map, container and parent layer.

**Why it is here.** Checking for the empty value in one shared place means a mistake — dropping a ``<Marker>`` somewhere with no map around it — fails immediately with a message a developer can read, instead of failing later with an obscure Leaflet error. Every component in this folder reads its map through this one function.

.. CG-EXPLANATION-END id=function:useStreafletContext


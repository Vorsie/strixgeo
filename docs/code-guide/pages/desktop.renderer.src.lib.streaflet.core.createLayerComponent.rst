desktop.renderer.src.lib.streaflet.core.createLayerComponent
============================================================

.. CG-PAGE source=desktop/src/renderer/src/lib/streaflet/core/createLayerComponent.tsx complete=true

*Source file:* ``desktop/src/renderer/src/lib/streaflet/core/createLayerComponent.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/core/createLayerComponent.tsx
   :language: tsx
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The imports for this file. It brings in three React building blocks — ``forwardRef``, ``useRef`` and ``useState`` — plus the ``ReactNode`` type (which just means "anything that can be drawn on screen", used for a component's children). It imports Leaflet's own types under the name ``L``, and then three of streaflet's own core pieces: the shared map context (``MapContext``) and its reader, the event-binding helper (``useEventHandlers``), and the two lifecycle helpers (``useLayerLifecycle``, ``useImperativeInstance``). Line 7 begins the documentation comment for the small input shape defined just below.

**Why it is here.** This is the single most important file in the map library, so it is worth naming the pieces it stands on. **Leaflet** is the third-party mapping library that actually draws tiles, markers and shapes on a slippy map. **streaflet** is the app's own thin re-implementation of the standard react-leaflet bridge — a slim in-house wrapper that lets the rest of the app describe a map with React components (``<Marker/>``, ``<Circle/>``) instead of calling Leaflet by hand. A **map layer** is any one thing Leaflet can add to or remove from a map — a marker, a shape, a group of shapes. Gathering the context, the event helper and the two lifecycle helpers here is what lets every layer component in the folder be built from a tiny pair of functions.

.. CG-EXPLANATION-END id=module-header

``interface LayerFactory``
--------------------------

.. CG-BLOCK id=interface:LayerFactory lines=8-20

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/core/createLayerComponent.tsx
   :language: tsx
   :lines: 8-20
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LayerFactory

**What this does.** Declares the shape of the recipe each layer component supplies, and (lines 15-20) documents the factory built from it. The recipe has two parts: ``createInstance`` — a function that builds the actual Leaflet object from the initial inputs and the surrounding context — and an optional ``updateInstance`` — a function that takes an already-built Leaflet object and applies changed inputs to it by changing it in place, never rebuilding it. The comment on the factory lists everything it handles for free: build once, add to the nearest container, change in place when inputs change, bind events, forward the ref, and remove on unmount.

**Why it is here.** An **interface** is just a note describing which fields a value must carry; it is checked before the app runs and then disappears. A **factory** is a function that builds and returns another function or component — here, a function that turns this two-function recipe into a finished React component. The whole map library follows one **create-once, mutate-in-place** rule: the Leaflet object is constructed exactly once and thereafter *changed* rather than thrown away and rebuilt, because rebuilding a live map object would make markers flicker and lose their event bindings. Splitting the recipe into ``createInstance`` / ``updateInstance`` is what lets one shared factory enforce that rule for every layer, so no individual component has to get it right.

.. CG-EXPLANATION-END id=interface:LayerFactory

``function createLayerComponent``
---------------------------------

.. CG-BLOCK id=function:createLayerComponent lines=21-49

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/core/createLayerComponent.tsx
   :language: tsx
   :lines: 21-49
   :lineno-match:

.. CG-EXPLANATION-START id=function:createLayerComponent

**What this does.** The factory itself. Given a create/update recipe it returns a React component. Inside that component: it reads the surrounding map context; it keeps the previous inputs in a ``ref`` (a value that survives redraws without causing one); and it builds the Leaflet object exactly once using ``useState`` with a function initializer. On every later redraw, if the inputs actually changed and an ``updateInstance`` was supplied, it applies the change in place and records the new inputs. It then calls three helpers — one that adds the layer to its container and removes it on unmount, one that keeps the event handlers in sync, and one that points the forwarded ref at the Leaflet object. Finally it hands its own children a fresh context: if this layer is itself a group, children attach to *it*; otherwise children attach to the same container this layer used, but can still see this layer as their nearest enclosing one (so a ``Popup`` or ``Tooltip`` placed inside knows what to bind to).

**Why it is here.** Several React terms meet here. **React context** is a way to pass a shared value (here, the map and the current container) down through nested components without threading it by hand. **forwardRef** lets a parent component reach the child's underlying object — here, the raw Leaflet instance — so callers can command the map directly if they need to. A **ref** holds a value across redraws without triggering one, which is exactly why the previous-inputs record and the run-once guard use refs, not state. The comment on line 31 records the key subtlety: building the instance inside ``useState``'s function initializer means it is created lazily and only once, which stays correct under React's StrictMode (a development mode that deliberately runs setup twice to catch bugs). The cast on lines 25-27 is explained in its own comment: TypeScript cannot prove the props type matches through the ``forwardRef`` wrapper because of a generic-type technicality, but the outer signature already guarantees it, so the cast is safe. This one function is why the twenty-odd component files are each only a few lines — everything hard about a layer's life on the map is solved here once.

.. CG-EXPLANATION-END id=function:createLayerComponent


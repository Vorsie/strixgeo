desktop.renderer.src.lib.streaflet.core.events
==============================================

.. CG-PAGE source=desktop/src/renderer/src/lib/streaflet/core/events.ts complete=true

*Source file:* ``desktop/src/renderer/src/lib/streaflet/core/events.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-7

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/core/events.ts
   :language: typescript
   :lines: 1-7
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports two React tools — ``useEffect`` (which runs a side task after a redraw) and ``useRef`` (which holds a value across redraws without causing one) — and Leaflet's types under ``L``. Line 4 opens the comment for the event table defined below.

**Why it is here.** This file is the map library's shared machinery for **event handlers** — the functions the app supplies to be run when something happens on the map, such as a click or a drag. Every interactive layer wires its events through here, so the file needs only React's after-redraw and remembered-value tools plus Leaflet's own event types.

.. CG-EXPLANATION-END id=module-header

``const LEAFLET_EVENTS``
------------------------

.. CG-BLOCK id=const:LEAFLET_EVENTS lines=8-33

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/core/events.ts
   :language: typescript
   :lines: 8-33
   :lineno-match:

.. CG-EXPLANATION-START id=const:LEAFLET_EVENTS

**What this does.** A fixed table that pairs a friendly React-style property name with the raw Leaflet event name it stands for: ``onClick`` maps to ``'click'``, ``onDblClick`` to ``'dblclick'``, ``onContextMenu`` to ``'contextmenu'`` (a right-click), and so on through mouse, drag, move, zoom, add/remove, and popup/tooltip open-and-close events.

**Why it is here.** The comment states the rule plainly: adding one row here promotes a new Leaflet event to a first-class, typed property across *every* component at once. Keeping the whole set in one table — rather than repeating event names in twenty component files — means the app writes ``onClick={...}`` on a marker the same familiar way it would on any React element, and the single table is the one place that decides which events are offered.

.. CG-EXPLANATION-END id=const:LEAFLET_EVENTS

``type LeafletEventPropName``
-----------------------------

.. CG-BLOCK id=type:LeafletEventPropName lines=34-45

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/core/events.ts
   :language: typescript
   :lines: 34-45
   :lineno-match:

.. CG-EXPLANATION-START id=type:LeafletEventPropName

**What this does.** Names the set of allowed handler property names as exactly the keys of that table (``onClick``, ``onDblClick``, …), and the comment underneath begins explaining the next piece: how each of those names is matched to the precise kind of handler function Leaflet expects.

**Why it is here.** Deriving the list of allowed names straight from the table means the names can never drift apart from it — add a row to the table and this set grows automatically, with no second place to update.

.. CG-EXPLANATION-END id=type:LeafletEventPropName

``type HandlerFor``
-------------------

.. CG-BLOCK id=type:HandlerFor lines=46-50

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/core/events.ts
   :language: typescript
   :lines: 46-50
   :lineno-match:

.. CG-EXPLANATION-START id=type:HandlerFor

**What this does.** A type-level lookup that, for a given event name, works out the exact handler-function shape Leaflet uses for that event (for example a mouse-click handler receives a mouse event). If an event is not in Leaflet's own known list, it falls back to the generic handler shape instead of failing. Line 50 then labels the combined set of event properties that every interactive component accepts.

**Why it is here.** As the comment records, the fallback is deliberate: a future Leaflet plugin event that the app has not catalogued still works, degrading gracefully to the generic handler rather than causing a type error. In practice every catalogued event resolves to its specific, correctly-typed handler — so an ``onClick`` handler is checked as receiving a mouse event, catching a mismatched handler before the app runs.

.. CG-EXPLANATION-END id=type:HandlerFor

``type EventedProps``
---------------------

.. CG-BLOCK id=type:EventedProps lines=51-58

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/core/events.ts
   :language: typescript
   :lines: 51-58
   :lineno-match:

.. CG-EXPLANATION-START id=type:EventedProps

**What this does.** Defines the bundle of event inputs every interactive component accepts: one optional property per catalogued event (each typed to its correct handler), plus an ``on`` escape hatch — a record for binding any Leaflet event that has not been promoted to a named property. Line 58 opens the comment for the flattening helper below.

**Why it is here.** Named properties cover the common events with full type-checking; the ``on`` escape hatch, as its comment says, keeps the rare or plugin events reachable without having to add a table row for each. Every layer component's inputs extend this bundle, which is why they all accept the same event properties for free.

.. CG-EXPLANATION-END id=type:EventedProps

``function resolveHandlers``
----------------------------

.. CG-BLOCK id=function:resolveHandlers lines=59-81

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/core/events.ts
   :language: typescript
   :lines: 59-81
   :lineno-match:

.. CG-EXPLANATION-START id=function:resolveHandlers

**What this does.** Takes a component's inputs and flattens every event handler it carries into one plain record of ``leaflet-event-name -> handler``. It walks the event table, copying across any named handler that was supplied, then folds in any handlers from the ``on`` escape hatch. Lines 77-81 open the comment for the syncing hook below.

**Why it is here.** Reducing the two ways of supplying a handler (named properties and the ``on`` bag) to one uniform record means the syncing code below has a single, simple thing to compare and bind. The cast on lines 63-66 is explained in its comment: a specifically-typed handler is not automatically accepted where the generic handler type is expected because of a type-safety rule about function parameters, but Leaflet always calls each handler with the right event, so the widening is safe.

.. CG-EXPLANATION-END id=function:resolveHandlers

``function useEventHandlers``
-----------------------------

.. CG-BLOCK id=function:useEventHandlers lines=82-105

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/core/events.ts
   :language: typescript
   :lines: 82-105
   :lineno-match:

.. CG-EXPLANATION-START id=function:useEventHandlers

**What this does.** Keeps a Leaflet object's event bindings in step with the component's current inputs. It remembers what it bound last time in a ``ref``. After every redraw it computes the new set of handlers, unbinds any that changed or went away, binds any that are new or changed, and records the new set. When the component is removed it unbinds everything it had bound.

**Why it is here.** As the comment says, it diffs the new handler set against the previous one and only unbinds/binds what actually changed — so handlers never stack up on repeated redraws and nothing is left bound after the component disappears (a classic source of leaks and double-firing clicks). Doing the compare-and-sync in one shared hook is why no individual layer component has to manage its own event cleanup. The hook uses an **event handler** the same way throughout: a function the app hands over to be run when the named thing happens.

.. CG-EXPLANATION-END id=function:useEventHandlers


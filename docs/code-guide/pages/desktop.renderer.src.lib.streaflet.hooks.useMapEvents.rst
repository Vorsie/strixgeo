desktop.renderer.src.lib.streaflet.hooks.useMapEvents
=====================================================

.. CG-PAGE source=desktop/src/renderer/src/lib/streaflet/hooks/useMapEvents.ts complete=true

*Source file:* ``desktop/src/renderer/src/lib/streaflet/hooks/useMapEvents.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-5

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/hooks/useMapEvents.ts
   :language: typescript
   :lines: 1-5
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports React's ``useEffect``, Leaflet's types under ``L``, and the ``useMap`` hook.

**Why it is here.** This hook subscribes to map events, so it needs React's after-redraw tool and the ``useMap`` hook (see that page) to find the map to listen on.

.. CG-EXPLANATION-END id=module-header

``function useMapEvents``
-------------------------

.. CG-BLOCK id=function:useMapEvents lines=6-19

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/hooks/useMapEvents.ts
   :language: typescript
   :lines: 6-19
   :lineno-match:

.. CG-EXPLANATION-START id=function:useMapEvents

**What this does.** A hook to listen for a set of named map events. It gets the map, and in an effect binds all the given handlers when the component appears and unbinds them all when it is removed, returning the map.

**Why it is here.** Binding once on mount and cleaning up on unmount is the standard, leak-free way to attach event listeners. The ``reason:`` note explains why the handler set is not in the effect's trigger list: callers pass a fresh-but-stable set each redraw, so re-binding every redraw would needlessly thrash the listeners — the deliberate choice is to bind once, matching the usual Leaflet-hook contract. A required ``// reason:`` note accompanies the suppressed lint warning because the project rule is that every such suppression must state why the linter is wrong here.

.. CG-EXPLANATION-END id=function:useMapEvents


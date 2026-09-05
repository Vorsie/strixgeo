desktop.renderer.src.lib.streaflet.components.MapContainer
==========================================================

.. CG-PAGE source=desktop/src/renderer/src/lib/streaflet/components/MapContainer.tsx complete=true

*Source file:* ``desktop/src/renderer/src/lib/streaflet/components/MapContainer.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-6

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/MapContainer.tsx
   :language: tsx
   :lines: 1-6
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports Leaflet under ``L``, five React building blocks (``forwardRef``, ``useEffect``, ``useRef``, ``useState``, and the ``CSSProperties`` and ``ReactNode`` types), the shared map context, and the ref helper. Line 6 opens the comment for this component's inputs.

**Why it is here.** This is the one component that actually creates the Leaflet map; every other streaflet component must sit inside it. So unlike the tiny wrapper files, it is written out by hand rather than built by a factory, and it needs React's full set of building blocks.

.. CG-EXPLANATION-END id=module-header

``interface MapContainerProps``
-------------------------------

.. CG-BLOCK id=interface:MapContainerProps lines=7-28

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/MapContainer.tsx
   :language: tsx
   :lines: 7-28
   :lineno-match:

.. CG-EXPLANATION-START id=interface:MapContainerProps

**What this does.** Declares the inputs for the root map: an optional starting ``center`` and ``zoom`` (or a ``bounds`` box to fit), zoom limits, whether to show the built-in zoom and attribution controls, a ``preferCanvas`` switch, CSS ``style`` and ``className`` for the map's box, the child components to place inside, and an optional ``whenReady`` callback fired once the map has settled.

**Why it is here.** These are the settings that only make sense once, when the map is first created. The ``preferCanvas`` comment records a real performance decision: drawing thousands of vector markers (for example many CPT locations) each as its own SVG element makes panning stutter, so turning on canvas mode draws them all on one shared surface and keeps the map smooth; it defaults off to match Leaflet's own default.

.. CG-EXPLANATION-END id=interface:MapContainerProps

``const MapContainer``
----------------------

.. CG-BLOCK id=const:MapContainer lines=29-71

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/MapContainer.tsx
   :language: tsx
   :lines: 29-71
   :lineno-match:

.. CG-EXPLANATION-START id=const:MapContainer

**What this does.** The root map component. It keeps a ``ref`` to the page element the map will live in, and a piece of ``state`` holding the map once built (starting empty). In an effect that runs once on mount, it creates the Leaflet map inside that element using the starting inputs, fits it to ``bounds`` if given, stores the map, and — if a ``whenReady`` callback was supplied — runs it once the map has settled. The effect's cleanup destroys the map when the component is removed. It exposes the map through the forwarded ref, and finally draws the map's box; only once the map exists does it wrap the children in a context provider carrying the map, so the children can find it.

**Why it is here.** The effect deliberately runs only on mount, not on every input change — the comment and the ``reason:`` note explain that the map is created once from its initial view, and later view changes go through ``useMap()`` or direct calls in consumers, which matches how Leaflet itself works; that is why the empty dependency list is paired with a required ``// reason:`` note rather than left as an accidental oversight (a project rule: every such suppression must say why the linter is wrong). Children are withheld until the map exists so that a ``<Marker>`` inside never tries to attach to a map that is not built yet. The ``whenReady`` comment records that it fires on Leaflet's own ready event, so the map is genuinely usable when the callback runs. Destroying the map on unmount prevents a discarded map from leaking event listeners and DOM.

.. CG-EXPLANATION-END id=const:MapContainer


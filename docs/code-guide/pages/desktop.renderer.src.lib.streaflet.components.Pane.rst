desktop.renderer.src.lib.streaflet.components.Pane
==================================================

.. CG-PAGE source=desktop/src/renderer/src/lib/streaflet/components/Pane.tsx complete=true

*Source file:* ``desktop/src/renderer/src/lib/streaflet/components/Pane.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-3

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/Pane.tsx
   :language: tsx
   :lines: 1-3
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports React's ``useState`` and two element types, plus the shared map context and its reader.

**Why it is here.** A pane is not a Leaflet layer, so it is not built by a factory; it is a small hand-written component that creates a named drawing level on the map and passes the context on to its children.

.. CG-EXPLANATION-END id=module-header

``interface PaneProps``
-----------------------

.. CG-BLOCK id=interface:PaneProps lines=4-18

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/Pane.tsx
   :language: tsx
   :lines: 4-18
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PaneProps

**What this does.** Declares its inputs: a ``name`` for the pane, an optional ``zIndex`` (its stacking level), and the child components to render. The comment explains that children opt into the pane by passing ``pane={name}`` in their own Leaflet options — the Marker and shape components forward exactly such a ``pane`` input.

**Why it is here.** A **pane** is a named stacking layer in Leaflet that decides what draws on top of what (for example keeping labels above shapes). Naming it and giving it a stacking level here lets several layers agree to share one drawing level.

.. CG-EXPLANATION-END id=interface:PaneProps

``function Pane``
-----------------

.. CG-BLOCK id=function:Pane lines=19-30

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/Pane.tsx
   :language: tsx
   :lines: 19-30
   :lineno-match:

.. CG-EXPLANATION-START id=function:Pane

**What this does.** Reads the map context, then — using a ``useState`` initializer that runs once — creates the named pane if it does not already exist and applies the optional stacking level. It then renders its children under the same, unchanged context.

**Why it is here.** The comment records that the ``useState`` initializer is what makes the pane creation happen exactly once on mount rather than on every redraw. Children still attach to the map as normal and simply select this pane by name, which is why the context is passed through unchanged rather than pointing children at the pane.

.. CG-EXPLANATION-END id=function:Pane


desktop.renderer.src.lib.streaflet.components.Popup
===================================================

.. CG-PAGE source=desktop/src/renderer/src/lib/streaflet/components/Popup.tsx complete=true

*Source file:* ``desktop/src/renderer/src/lib/streaflet/components/Popup.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-6

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/Popup.tsx
   :language: tsx
   :lines: 1-6
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports Leaflet under ``L``, React's ``useEffect``, ``useRef`` and two element types, React's ``createPortal``, and the map-context reader.

**Why it is here.** A popup is not a plain layer — its content is React drawn into a Leaflet-owned bubble — so it is hand-written rather than built by a factory, and it needs a **portal**: React's way of drawing a component's output into a different part of the page than where the component sits.

.. CG-EXPLANATION-END id=module-header

``interface PopupProps``
------------------------

.. CG-BLOCK id=interface:PopupProps lines=7-29

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/Popup.tsx
   :language: tsx
   :lines: 7-29
   :lineno-match:

.. CG-EXPLANATION-START id=interface:PopupProps

**What this does.** Declares its inputs: the ``children`` to show inside, an optional standalone ``position``, and Leaflet bubble options (``maxWidth``, ``minWidth``, ``autoPan``, ``closeButton``, ``className``). The comment records that these bubble options are read once when the popup opens; changing them later does not re-open it, so a changed option needs the component remounted (for example by changing its ``key``).

**Why it is here.** A popup normally attaches to the nearest enclosing layer (a marker it belongs to); the optional ``position`` covers the rarer case of a free-floating popup on the map. The read-once contract is documented so no one expects live option changes to take effect on their own.

.. CG-EXPLANATION-END id=interface:PopupProps

``function Popup``
------------------

.. CG-BLOCK id=function:Popup lines=30-59

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/Popup.tsx
   :language: tsx
   :lines: 30-59
   :lineno-match:

.. CG-EXPLANATION-START id=function:Popup

**What this does.** Reads the context, and lazily makes a single hidden ``div`` (created only on the first render, not every render) to hold the React content. In an effect: if there is an enclosing layer that can carry a popup, it binds the div to that layer as its popup and unbinds on removal; otherwise it opens a standalone popup at the given position and closes it on removal. It then draws the ``children`` into that hidden div through a portal.

**Why it is here.** The comment on the ``div`` explains the lazy creation: making the element only once avoids needlessly creating and discarding a new element on every redraw. The ``reason:`` note explains why the effect only re-runs when the enclosing layer changes: the bubble is bound once, and the React content updates live through the portal rather than by re-binding — which is exactly why the option inputs are read only at open time. The portal is what lets ordinary React content live inside Leaflet's own bubble element.

.. CG-EXPLANATION-END id=function:Popup


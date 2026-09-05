desktop.renderer.src.lib.streaflet.components.Tooltip
=====================================================

.. CG-PAGE source=desktop/src/renderer/src/lib/streaflet/components/Tooltip.tsx complete=true

*Source file:* ``desktop/src/renderer/src/lib/streaflet/components/Tooltip.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-6

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/Tooltip.tsx
   :language: tsx
   :lines: 1-6
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Imports Leaflet under ``L``, React's ``useEffect``, ``useRef`` and two element types, React's ``createPortal``, and the map-context reader.

**Why it is here.** A tooltip, like the popup on the ``Popup`` page, is React content drawn into a Leaflet-owned element, so it is hand-written and uses a portal (React drawing into a different part of the page).

.. CG-EXPLANATION-END id=module-header

``interface TooltipProps``
--------------------------

.. CG-BLOCK id=interface:TooltipProps lines=7-31

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/Tooltip.tsx
   :language: tsx
   :lines: 7-31
   :lineno-match:

.. CG-EXPLANATION-START id=interface:TooltipProps

**What this does.** Declares its inputs: the ``children`` to show, and Leaflet tooltip options (``permanent``, ``direction``, ``offset``, ``sticky``, ``opacity``, ``className``, ``pane``). The comment records the same read-once contract as the popup: options are read when the tooltip binds, and a later change needs a remount.

**Why it is here.** A tooltip always attaches to the nearest enclosing layer (there is no standalone position), which is why — unlike the popup — it has no ``position`` input. The read-once note manages expectations the same way.

.. CG-EXPLANATION-END id=interface:TooltipProps

``function Tooltip``
--------------------

.. CG-BLOCK id=function:Tooltip lines=32-54

.. literalinclude:: ../../../desktop/src/renderer/src/lib/streaflet/components/Tooltip.tsx
   :language: tsx
   :lines: 32-54
   :lineno-match:

.. CG-EXPLANATION-START id=function:Tooltip

**What this does.** Reads the context and lazily makes a single hidden ``div`` for the content. In an effect: if there is an enclosing layer that can carry a tooltip, it binds the div to that layer and unbinds on removal; if there is no such layer it does nothing. It draws the ``children`` into the hidden div through a portal.

**Why it is here.** Same design as the ``Popup`` page: the ``div`` is created once to avoid churn, and the ``reason:`` note explains that binding happens once per enclosing layer while the content updates live through the portal — so the tooltip's options are read only at bind time. Unlike the popup there is no standalone fallback, because a tooltip only makes sense attached to something.

.. CG-EXPLANATION-END id=function:Tooltip


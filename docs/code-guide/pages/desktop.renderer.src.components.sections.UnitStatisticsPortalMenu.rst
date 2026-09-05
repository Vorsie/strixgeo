desktop.renderer.src.components.sections.UnitStatisticsPortalMenu
=================================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/UnitStatisticsPortalMenu.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/UnitStatisticsPortalMenu.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-14

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/UnitStatisticsPortalMenu.tsx
   :language: tsx
   :lines: 1-14
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the file for the one-item 'Unit statistics' right-click menu, drawn through a portal onto the page body. A portal renders an element outside its normal place in the layout so it can float above everything. It imports the menu item and a dismiss hook.

**Why it is here.** The comment records it was extracted from the fill overlay when the model fill became a second consumer (owner ruling S6, 27 August 2026: 'right click a fill region only works for normal fill, not model fill') — separate copies would drift in how they dismiss or stack. It owns its own dismissal on zoom or Escape.

.. CG-EXPLANATION-END id=module-header

``interface UnitStatsMenuState``
--------------------------------

.. CG-BLOCK id=interface:UnitStatsMenuState lines=15-32

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/UnitStatisticsPortalMenu.tsx
   :language: tsx
   :lines: 15-32
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UnitStatsMenuState

**What this does.** The named shape of the menu's open state: where it opens (client x and y), the clicked region's formation id, an optional resolved body id, and the clicked region's own geotech layer ids.

**Why it is here.** The comments cite owner ruling of 27 August 2026: when the opening surface resolved a body the jump is body-level, otherwise it stays formation-level; the region layer ids let the geotech jump reach a class row when the body is unresolved.

.. CG-EXPLANATION-END id=interface:UnitStatsMenuState

``interface Props``
-------------------

.. CG-BLOCK id=interface:Props lines=33-60

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/UnitStatisticsPortalMenu.tsx
   :language: tsx
   :lines: 33-60
   :lineno-match:

.. CG-EXPLANATION-START id=interface:Props

**What this does.** The inputs: the open state (or null), the jump handler the item forwards the ids to, a close callback, and the two test ids for the menu box and its item.

**Why it is here.** Passing test ids in lets one menu component serve both the computed fill and the model fill while each still identifies itself in tests.

.. CG-EXPLANATION-END id=interface:Props

``function UnitStatisticsPortalMenu``
-------------------------------------

.. CG-BLOCK id=function:UnitStatisticsPortalMenu lines=61-106

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/UnitStatisticsPortalMenu.tsx
   :language: tsx
   :lines: 61-106
   :lineno-match:

.. CG-EXPLANATION-START id=function:UnitStatisticsPortalMenu

**What this does.** The component. It wires the zoom-or-Escape dismissal, renders nothing while closed, and otherwise portals a full-screen invisible backdrop (a click or right-click on it closes the menu) plus a small fixed-position menu box at the click point holding the single statistics item.

**Why it is here.** The full-screen backdrop is the standard way to make an outside click dismiss a floating menu, and the very high z-index values keep it above every other overlay.

.. CG-EXPLANATION-END id=function:UnitStatisticsPortalMenu


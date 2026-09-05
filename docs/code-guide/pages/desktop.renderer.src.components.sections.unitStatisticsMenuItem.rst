desktop.renderer.src.components.sections.unitStatisticsMenuItem
===============================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/unitStatisticsMenuItem.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/unitStatisticsMenuItem.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-13

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/unitStatisticsMenuItem.tsx
   :language: tsx
   :lines: 1-13
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The Unit statistics menu item, the jump from a clicked band to the Parameters stage, scoped to a unit. This file is a React component: a React component is a function that returns a piece of screen, and the inputs it is given are called its props.

**Why it is here.** It is one component used across every menu that offers the jump (the geotech band menus, the litho band menu, the fill-region menu), because separate copies would drift in wording or in which id they report. It was lifted out of ``GeotechBandEditOverlay`` when the litho menu became the second consumer, following the extract-on-the-second-copy rule. Owner ballot 2026-08-26, extended to litho bands and fill regions by the 2026-08-27 rulings.

.. CG-EXPLANATION-END id=module-header

``const MENU_ITEM_STYLE``
-------------------------

.. CG-BLOCK id=const:MENU_ITEM_STYLE lines=14-55

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/unitStatisticsMenuItem.tsx
   :language: tsx
   :lines: 14-55
   :lineno-match:

.. CG-EXPLANATION-START id=const:MENU_ITEM_STYLE

**What this does.** The shared inline style for these hand-rolled section context-menu buttons. The comment after it describes the component.

**Why it is here.** One style object keeps every menu item across the different surfaces looking the same.

.. CG-EXPLANATION-END id=const:MENU_ITEM_STYLE

``function UnitStatisticsItem``
-------------------------------

.. CG-BLOCK id=function:UnitStatisticsItem lines=56-107

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/unitStatisticsMenuItem.tsx
   :language: tsx
   :lines: 56-107
   :lineno-match:

.. CG-EXPLANATION-START id=function:UnitStatisticsItem

**What this does.** The React component that renders the menu button. It takes props: the unit's formation id, an optional clicked body, optional region layer ids, and the handlers. On click it reports the formation id plus, when known, the body, then closes the hosting menu. It renders nothing at all when no handler is wired.

**Why it is here.** It reports the FORMATION id, never a layer id, because the statistics are a property of the unit, pooled over every band of it in the project. It also passes the clicked body when the surface can name one, per owner ruling 2026-08-27, verbatim: a body is only a body if it is geometrically connected or if the users says, this body is the same as that body; the unit row lumps many resolver bodies, so a jump that knows which body was clicked must say so. Rendering nothing when there is no handler follows the band menus' no-affordance rule rather than showing a disabled entry, and the translation hook is called before the early return so the hook order stays stable.

.. CG-EXPLANATION-END id=function:UnitStatisticsItem


desktop.renderer.src.components.sections.BodyContextMenu
========================================================

.. CG-PAGE source=desktop/src/renderer/src/components/sections/BodyContextMenu.tsx complete=true

*Source file:* ``desktop/src/renderer/src/components/sections/BodyContextMenu.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-20

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/BodyContextMenu.tsx
   :language: tsx
   :lines: 1-20
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The top of the file for the right-click menu that appears on a body wedge in the cross-section. A *body* is one continuous mass of the same soil the model has grouped together. The menu offers two main actions — name the body, or dissolve it — plus join and un-join items. The code imports a generic menu component, the body data type, the translation helper, and a small helper that builds the crossed-formation label.

**Why it is here.** The docstring notes the menu was kept deliberately compact: the old 'left extent' and 'right extent' submenus were removed with the body-extent system (retired 2026-06-06). It is drawn inside the section's drawing canvas so it floats above the wedge geometry cleanly.

.. CG-EXPLANATION-END id=module-header

``interface BodyContextMenuProps``
----------------------------------

.. CG-BLOCK id=interface:BodyContextMenuProps lines=21-80

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/BodyContextMenu.tsx
   :language: tsx
   :lines: 21-80
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BodyContextMenuProps

**What this does.** The shape of the inputs to the body menu: where to place it, which body was right-clicked, the label to show in the header, and a set of optional callbacks — name, dissolve, show unit statistics, join, and the un-join options and their handlers, plus a hover preview and a close callback.

**Why it is here.** Every action is optional so a menu item appears only when the parent wired a real handler for it — the 'no-affordance' rule, which keeps Join and Un-join on the geotech axis where the owner said he would use them. The docstrings record the owner rulings each field obeys: statistics report the unit not the body (ruling R1, 2026-08-27), a body may cross several geological formations, and the verbs were stripped to Join plus Un-join (2026-09-01, 'way too complicated').

.. CG-EXPLANATION-END id=interface:BodyContextMenuProps

``interface BodyDisjoinOption``
-------------------------------

.. CG-BLOCK id=interface:BodyDisjoinOption lines=81-101

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/BodyContextMenu.tsx
   :language: tsx
   :lines: 81-101
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BodyDisjoinOption

**What this does.** The shape of one 'un-join' choice — a standing group the user can split back apart. It carries the group's row id (deleted on un-join), a display label for the other body, and two identifiers for the other end so the canvas can tell two same-labelled options apart.

**Why it is here.** After a standing join both ends resolve to the same merged body, so the body id collides between two options on one body; the other end's layer id is a distinct section position and is the reliable disambiguator (design point D2, owner 2026-09-01).

.. CG-EXPLANATION-END id=interface:BodyDisjoinOption

``const TESTIDS``
-----------------

.. CG-BLOCK id=const:TESTIDS lines=102-137

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/BodyContextMenu.tsx
   :language: tsx
   :lines: 102-137
   :lineno-match:

.. CG-EXPLANATION-START id=const:TESTIDS

**What this does.** A constant holding a small dictionary of fixed text labels — 'test ids' — attached to each menu row so automated tests can find and click a specific row reliably.

**Why it is here.** Naming these in one place lets the test file target 'the dissolve row' or 'the join row' directly, and each un-join row gets a per-group id so several standing groups on one body render as distinct, findable rows.

.. CG-EXPLANATION-END id=const:TESTIDS

``function BodyContextMenu``
----------------------------

.. CG-BLOCK id=function:BodyContextMenu lines=138-258

.. literalinclude:: ../../../desktop/src/renderer/src/components/sections/BodyContextMenu.tsx
   :language: tsx
   :lines: 138-258
   :lineno-match:

.. CG-EXPLANATION-START id=function:BodyContextMenu

**What this does.** The component that assembles the menu. It reads the translated labels, builds the crossed-formation context string, then constructs the list of rows in order — Name, Unit statistics, Join, one Un-join row per standing group, and Dissolve last — each wired only when its handler was supplied. It renders through a generic menu, with the body label and formation context in the header, and clears any hover highlight when the menu closes.

**Why it is here.** The ordering and styling follow the reversible-versus-irreversible rule from ``docs/ux.md``: Dissolve is irreversible, so it is danger-styled and set off by a divider, while Join is reversible (undone by Un-join) and stays plain. The header shows the body label alone (the 'Lens ·' prefix was dropped on the 2026-09-01 dogfeed) plus every geological formation the body falls in, shallowest first (owner ruling R2, 2026-08-31).

.. CG-EXPLANATION-END id=function:BodyContextMenu


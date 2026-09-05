desktop.renderer.src.shell.stages.geotechnical.GeotechnicalUnitRoster
=====================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geotechnical/GeotechnicalUnitRoster.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geotechnical/GeotechnicalUnitRoster.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-35

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechnicalUnitRoster.tsx
   :language: tsx
   :lines: 1-35
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file for the geotech unit roster — the three-level tree in the inspector reading soil header, then litho body, then packing body. The comment quotes the owner's ruling on the shape of that tree and records that this file owns the tree and its expand state, while the row renderers live in ``geotechRosterRows.tsx``, the badges in ``geotechBadges.tsx``, and the pure arithmetic in ``geotechUnitTree.ts``. It pulls in the React tools, the translation and language helpers, the chevron icons, the API types, the group-numbering helpers, the litho-body row renderer, and the tree builder.

**Why it is here.** The owner described the axis in a walk interview on 2026-08-31: the main soil is the top level, one down are the geometrically-disconnected litho bodies, one down are the disconnected packing bodies, and a joined group gets a "(group N)" tag. It was split out of the inspector so neither file carries the whole stage (debt #201), and the arithmetic was lifted into a plain module so it can be tested without a browser.

.. CG-EXPLANATION-END id=module-header

``interface GeotechnicalUnitRosterProps``
-----------------------------------------

.. CG-BLOCK id=interface:GeotechnicalUnitRosterProps lines=36-82

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechnicalUnitRoster.tsx
   :language: tsx
   :lines: 36-82
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechnicalUnitRosterProps

**What this does.** Names the inputs the roster is handed: the geotech formations, contacts and layers (the units, the header count, and the leaf band counts and badges); the litho units (for composing the middle-level label); the geotech model's bodies (the leaves); the parent litho model's bodies keyed by id (the middle-level nodes); the manual body groups (the source of the "(group N)" tag); a colour-commit callback; the currently selected body id; and a select-body callback.

**Why it is here.** An ``interface`` is a written note about the shape of what is passed in, letting the parent and the roster agree exactly. Two of the inputs degrade gracefully when absent, which the comments spell out: with no litho-body list the middle level still groups by parent-litho-body id but its label falls back to an id prefix, and with no body-groups list there are simply no group tags — so a partial load never blanks the tree.

.. CG-EXPLANATION-END id=interface:GeotechnicalUnitRosterProps

``function GeotechnicalUnitRoster``
-----------------------------------

.. CG-BLOCK id=function:GeotechnicalUnitRoster lines=83-240

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechnicalUnitRoster.tsx
   :language: tsx
   :lines: 83-240
   :lineno-match:

.. CG-EXPLANATION-START id=function:GeotechnicalUnitRoster

**What this does.** The roster component — the function that draws the tree. It remembers which soil headers and which litho-body nodes the engineer has collapsed, builds a litho-unit-id-to-name map, reduces the geotech body list to the fields the tree needs, derives the manual-group numbers, and runs the tree builder over all of it. It then draws a summary count and, for each soil group, a collapsible header whose count reads "band" or "bands", and under it the litho-body nodes.

**Why it is here.** Soil groups and litho-body nodes both start EXPANDED, because the owner's complaint was that he could not SEE the packing bodies to select them; collapsing is tracked as a set of exceptions (a CLOSED set) so the tree never briefly flashes collapsed while the rosters load. The heavy computations are memoised — cached and only recomputed when their inputs change — and the language is included among those inputs, because the tree's labels come from language-aware helpers and must rebuild when the interface language flips.

.. CG-EXPLANATION-END id=function:GeotechnicalUnitRoster


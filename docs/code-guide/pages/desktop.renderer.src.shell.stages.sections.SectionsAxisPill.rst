desktop.renderer.src.shell.stages.sections.SectionsAxisPill
===========================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/SectionsAxisPill.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/SectionsAxisPill.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-11

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SectionsAxisPill.tsx
   :language: tsx
   :lines: 1-11
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the small control that lets the engineer switch the cross-section view between the three model levels — Geology, Litho and Geotech. It imports the data shapes it needs (a geological model's response, and the name of whichever axis is active) and the translator ``useT`` that turns text keys into the user's language.

**Why it is here.** The pill was pulled out of the big toolbar file (debt #201, the campaign to break up over-long components) and made a leaf control: everything it shows is passed in as props — the inputs a component receives — so it holds no state of its own and can never disagree with the toolbar about which axis is active.

.. CG-EXPLANATION-END id=module-header

``interface SectionsAxisPillProps``
-----------------------------------

.. CG-BLOCK id=interface:SectionsAxisPillProps lines=12-37

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SectionsAxisPill.tsx
   :language: tsx
   :lines: 12-37
   :lineno-match:

.. CG-EXPLANATION-START id=interface:SectionsAxisPillProps

**What this does.** Describes the inputs the pill expects: a ``short`` flag that swaps 'Geology' for 'Geo' when space is tight, two flags saying whether the litho or geotech axis is currently active, the active litho and geotech models (each may be null when that level has not been built), and one callback to run when the engineer clicks a segment. (An interface is a TypeScript description of the shape of a piece of data; TypeScript is the typed dialect of JavaScript the desktop app is written in.)

**Why it is here.** Only 'Geology' has a designed short form. 'Litho' is already short, and 'Geotech' is the exact segment the owner watched get chopped to 'Geote' on a laptop (dogfeed 2026-08-26), so it is spelled out at every width. Passing the two active models in lets the pill grey out a segment whose model does not exist yet.

.. CG-EXPLANATION-END id=interface:SectionsAxisPillProps

``function SectionsAxisPill``
-----------------------------

.. CG-BLOCK id=function:SectionsAxisPill lines=38-181

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SectionsAxisPill.tsx
   :language: tsx
   :lines: 38-181
   :lineno-match:

.. CG-EXPLANATION-START id=function:SectionsAxisPill

**What this does.** Draws the three-segment toggle. Each segment is a radio button: Geology is on when neither litho nor geotech is active, and the others light up when theirs is. The Litho segment is disabled until a litho model exists; the Geotech segment is disabled until either a geotech or a litho model exists. A small hint line appears beneath when no litho model exists at all, explaining why the segments are greyed. The disabled buttons are wrapped in a plain ``span`` that carries the tooltip.

**Why it is here.** Two constraints are written into the markup here. First, a disabled button in this browser engine fires no hover events, so its tooltip never shows — wrapping it in a non-disabled span restores the explanation without breaking keyboard navigation. Second, the group carries ``shrink-0``: without it the flexbox layout picks this rounded group as the one item free to absorb a width shortage and clips its last segment mid-word — the owner's 'Geology | Litho | Geote' bug. The Geotech axis is gated on the litho model, not the geotech one, because the step that CREATES the geotech model lives on this axis, so gating it on the geotech model would deadlock a clean start.

.. CG-EXPLANATION-END id=function:SectionsAxisPill


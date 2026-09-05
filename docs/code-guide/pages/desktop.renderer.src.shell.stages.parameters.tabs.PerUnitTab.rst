desktop.renderer.src.shell.stages.parameters.tabs.PerUnitTab
============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/tabs/PerUnitTab.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/tabs/PerUnitTab.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-23

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/tabs/PerUnitTab.tsx
   :language: tsx
   :lines: 1-23
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file (the Per-unit tab — the scoped unit's statistics as the main canvas content) and describes in a header comment how the tab now works, before importing two icons, the empty-state component, shared state, the translation hook, and the unit-statistics canvas.

**Why it is here.** Owner ruling R3 (2026-08-27): "I do not like the list view here. The statistics should be the main item; switch statistics and list from the pane." So the roster that used to be this tab moved to the inspector pane, and a row click there — or a section's "Unit statistics" deep link — writes the selected unit into shared state, which this tab then draws. The comment also records that the derived design parameters (friction angle, cohesion, and the rest) with per-cell method tags and an audit-only ML surface are unchanged Phase-5 direction — never auto-applied.

.. CG-EXPLANATION-END id=module-header

``function PerUnitTab``
-----------------------

.. CG-BLOCK id=function:PerUnitTab lines=24-57

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/tabs/PerUnitTab.tsx
   :language: tsx
   :lines: 24-57
   :lineno-match:

.. CG-EXPLANATION-START id=function:PerUnitTab

**What this does.** The tab component. If a unit is selected it draws that unit's full statistics canvas. If there are no units at all yet, it shows a "no units" empty state. Otherwise it shows a "pick a unit" hint prompting the engineer to choose one from the list pane.

**Why it is here.** The statistics canvas is the main content per ruling R3, so the tab's whole job is to route the selected unit to it. The two fallbacks distinguish "nothing to show because nothing exists" from "something exists, just pick one", so the engineer is told which situation he is in rather than facing a blank pane.

.. CG-EXPLANATION-END id=function:PerUnitTab


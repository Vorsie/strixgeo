desktop.renderer.src.shell.stages.parameters.ParametersCanvas
=============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/ParametersCanvas.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/ParametersCanvas.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-44

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/ParametersCanvas.tsx
   :language: tsx
   :lines: 1-44
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the Parameters stage canvas file — the main screen of the stage — and imports React's effect hook, the tab icons, an empty-state component, the shared tab-bar primitive, the shell context, the tab-id type, the translator, the message-key type, and the three tab bodies (Methods, Per-test, Per-unit).

**Why it is here.** The long docstring records the owner directive (2026-05-21): a single stage hosts THREE views of the same parameter data so the engineer flips between them without losing context — a per-test table (rows are tests, columns are computed parameters), a per-unit table (rows are units, aggregated), and a Methods picker that keeps the two method families strictly apart (formula-driven correlations like Robertson and Uzielli on one side, spreadsheet lookups on the other) and never mixes them in one cell. Most of that math is Phase 5; this canvas opens the surface today.

.. CG-EXPLANATION-END id=module-header

``type TabId``
--------------

.. CG-BLOCK id=type:TabId lines=45-48

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/ParametersCanvas.tsx
   :language: tsx
   :lines: 45-48
   :lineno-match:

.. CG-EXPLANATION-START id=type:TabId

**What this does.** Aliases the local ``TabId`` name to the shell's ``ParametersTabId`` type.

**Why it is here.** The active tab is remembered in the shell (so it survives leaving and returning to the stage), so this file reuses the shell's own tab-id type rather than defining a second one that could drift out of step.

.. CG-EXPLANATION-END id=type:TabId

``const TABS``
--------------

.. CG-BLOCK id=const:TABS lines=49-93

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/ParametersCanvas.tsx
   :language: tsx
   :lines: 49-93
   :lineno-match:

.. CG-EXPLANATION-START id=const:TABS

**What this does.** A fixed list describing the three tabs — each with its id, a translation key for its label, its icon component, a translation key for its hint, and a test id.

**Why it is here.** Holding the tab definitions as data (with translation KEYS, not finished text) lets the component build the tab bar in a loop and resolve every label and hint in the engineer's active language at render time — following the translate-at-the-presentation-boundary rule.

.. CG-EXPLANATION-END id=const:TABS

``function ParametersCanvas``
-----------------------------

.. CG-BLOCK id=function:ParametersCanvas lines=94-187

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/ParametersCanvas.tsx
   :language: tsx
   :lines: 94-187
   :lineno-match:

.. CG-EXPLANATION-START id=function:ParametersCanvas

**What this does.** The canvas component. It reads the active tab and the selected unit scope from the shell, draws the tab bar across the top with a small "Phase 5 surface" marker, and below it shows exactly one of the three tab bodies. An effect flips the view to the per-unit tab whenever a unit scope becomes selected. A defensive empty state covers an impossible unknown tab.

**Why it is here.** Arriving from a band's or region's "Unit statistics…" action (owner ballot 2026-08-26) must land on the per-unit tab, because after the layout flip that is where the statistics draw with the unit list beside them — so the effect performs that navigation. It is keyed on the scope so it fires once per unit rather than every render: an engineer who then switches to Methods with the unit still scoped is not dragged back. The reason comment on the lint suppression records that the setter is stable and the scope is the only signal that should re-fire the navigation. The fallback empty state is acknowledged as unreachable but beats a blank panel if the tab value ever drifts.

.. CG-EXPLANATION-END id=function:ParametersCanvas


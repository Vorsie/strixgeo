desktop.renderer.src.shell.stages.sections.sectionsLithoMenuItems
=================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/sectionsLithoMenuItems.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/sectionsLithoMenuItems.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-33

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/sectionsLithoMenuItems.tsx
   :language: tsx
   :lines: 1-33
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the four dropdown menus of the litho-axis toolbar — the Suggest caret, the Correlate caret, the Bodies menu and the Admixtures menu — and the imports each needs.

**Why it is here.** Pulled verbatim from ``SectionsToolbar`` (debt #201) alongside its item builder. Splitting the menus out of the item builder keeps both files under the 500-line advisory. Pure functions, no hooks, bodies identical to the originals.

.. CG-EXPLANATION-END id=module-header

``type SectionSuggestAnchor``
-----------------------------

.. CG-BLOCK id=type:SectionSuggestAnchor lines=34-44

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/sectionsLithoMenuItems.tsx
   :language: tsx
   :lines: 34-44
   :lineno-match:

.. CG-EXPLANATION-START id=type:SectionSuggestAnchor

**What this does.** Describes one bulk-suggest anchor — a CPT or borehole that lands on the section — as its kind, id, and surface elevation (which may be null).

**Why it is here.** The bulk-suggest flow needs the surface elevation to position ghost layers, so the anchor carries it; null means the ghost overlay cannot place it and it is skipped.

.. CG-EXPLANATION-END id=type:SectionSuggestAnchor

``interface LithoToolbarItemsDeps``
-----------------------------------

.. CG-BLOCK id=interface:LithoToolbarItemsDeps lines=45-91

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/sectionsLithoMenuItems.tsx
   :language: tsx
   :lines: 45-91
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoToolbarItemsDeps

**What this does.** Everything the litho verbs and their menus read from the toolbar: the translator, the axis and section flags, the active litho model, the many busy flags and ghost counts, the bulk-anchor lists, and the handlers behind Suggest, Accept, Correlate, the Bodies toggles and the Admixtures cleanup.

**Why it is here.** One interface for the whole litho block; each menu builder takes only the subset it uses, so the toolbar derives its state once and the builders stay pure.

.. CG-EXPLANATION-END id=interface:LithoToolbarItemsDeps

``function buildLithoSuggestMenuItems``
---------------------------------------

.. CG-BLOCK id=function:buildLithoSuggestMenuItems lines=92-157

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/sectionsLithoMenuItems.tsx
   :language: tsx
   :lines: 92-157
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildLithoSuggestMenuItems

**What this does.** Builds the Suggest split-button's caret rows — 'Suggest all in this section' (with a count) and 'Suggest for new tests' (scoped to tests with no contacts yet) — each with its icon, enabled state and tooltip.

**Why it is here.** These rows are declared once and reused as the fold-into-menu overflow, so the caret items ARE the overflow rows and the two stay in step by construction. 'Suggest for new tests' lets the engineer add investigations to an already-accepted project without re-running the segmenter on every handled test.

.. CG-EXPLANATION-END id=function:buildLithoSuggestMenuItems

``function buildLithoCorrelateMenuItems``
-----------------------------------------

.. CG-BLOCK id=function:buildLithoCorrelateMenuItems lines=158-232

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/sectionsLithoMenuItems.tsx
   :language: tsx
   :lines: 158-232
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildLithoCorrelateMenuItems

**What this does.** Builds the Correlate caret's three rows: auto-correlate, accept-correlations, and clear-correlation-suggestions.

**Why it is here.** The clear row is gated only on the model, not on the section having contacts, so the engineer can clear model-wide or off-section stale suggestions even when the current section has none — and because it stays enabled at zero contacts, the Correlate primary can fall back to opening this menu rather than being fully disabled.

.. CG-EXPLANATION-END id=function:buildLithoCorrelateMenuItems

``function buildLithoBodiesMenuItems``
--------------------------------------

.. CG-BLOCK id=function:buildLithoBodiesMenuItems lines=233-315

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/sectionsLithoMenuItems.tsx
   :language: tsx
   :lines: 233-315
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildLithoBodiesMenuItems

**What this does.** Builds the Bodies menu: Fill bands (colour every body's closed loop with its lithology), toggle the correlation ribbons, toggle the built-3-D model fill, Reset manual points (an irreversible clear of hand-drawn body boundaries, behind a confirm), and the shared sample toggles.

**Why it is here.** Fill bands is an explicit finish-then-click verb, done AFTER correlating and pinch-outs, and it never auto-draws (owner directive 2026-06-03). Reset manual points is a database delete, so it opens a confirmation rather than firing — the project's rule that irreversible actions confirm first.

.. CG-EXPLANATION-END id=function:buildLithoBodiesMenuItems

``function buildLithoAdmixtureMenuItems``
-----------------------------------------

.. CG-BLOCK id=function:buildLithoAdmixtureMenuItems lines=316-370

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/sectionsLithoMenuItems.tsx
   :language: tsx
   :lines: 316-370
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildLithoAdmixtureMenuItems

**What this does.** Builds the Admixtures menu: strip the CPT ghost admixtures, strip the borehole ghost admixtures, strip all, and reseed the borehole admixtures — each with a live count and disabled when its count is zero.

**Why it is here.** The CPT segmenter's admixtures are noisier than the borehole observation-log ones, so 'strip all then reseed boreholes' is a common cleanup pass; the menu operates on the pending ghost suggestions only, never committed layers.

.. CG-EXPLANATION-END id=function:buildLithoAdmixtureMenuItems


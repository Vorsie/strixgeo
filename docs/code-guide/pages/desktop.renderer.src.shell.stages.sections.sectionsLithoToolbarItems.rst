desktop.renderer.src.shell.stages.sections.sectionsLithoToolbarItems
====================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/sectionsLithoToolbarItems.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/sectionsLithoToolbarItems.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-38

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/sectionsLithoToolbarItems.tsx
   :language: tsx
   :lines: 1-38
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the builder that turns the litho menus into toolbar items — the Suggest split-button, the transient Accept-all / Clear pills, the Correlate split-button, the Bodies dropdown and the Admixtures dropdown.

**Why it is here.** Pulled verbatim from ``SectionsToolbar`` (debt #201). A pure builder taking the toolbar's already-derived state; it calls no hooks, so it carries no hook-ordering risk.

.. CG-EXPLANATION-END id=module-header

``function buildLithoToolbarItems``
-----------------------------------

.. CG-BLOCK id=function:buildLithoToolbarItems lines=39-413

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/sectionsLithoToolbarItems.tsx
   :language: tsx
   :lines: 39-413
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildLithoToolbarItems

**What this does.** Assembles the litho-axis verb specs. It builds the four menus, works out the Suggest button's label, then lays out: the Suggest split-button, transient Accept-all / Clear pills that appear only while ghost suggestions exist (both single-anchor and bulk variants), the Correlate split-button (amber-tinted while correlate mode is on), the Bodies dropdown, and the Admixtures dropdown. Each spec states a priority for the responsive row. Returns an empty list off the litho axis.

**Why it is here.** Suggest is the litho stage's entry verb, pressed on every column, so it holds its label longest (highest priority). The Accept-all / Clear pills are 'high' and appear only while ghosts are pending because hiding the way to commit or dismiss work-in-progress is worse than hiding a standing verb. The Correlate split-button is never icon-only because its label doubles as the mode read-out ('Correlate · click 2 bands'); an icon would hide the one thing telling the engineer why the next click behaves differently.

.. CG-EXPLANATION-END id=function:buildLithoToolbarItems


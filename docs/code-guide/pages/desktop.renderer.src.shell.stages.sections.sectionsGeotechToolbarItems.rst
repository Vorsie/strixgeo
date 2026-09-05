desktop.renderer.src.shell.stages.sections.sectionsGeotechToolbarItems
======================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/sectionsGeotechToolbarItems.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/sectionsGeotechToolbarItems.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-46

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/sectionsGeotechToolbarItems.tsx
   :language: tsx
   :lines: 1-46
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the builder that turns the geotech menus above into actual toolbar items — the statistic dropdown, the pipeline dropdown, the two live chips (pending-tie and stale-litho), the Correlate-packing button, and the Display dropdown.

**Why it is here.** Pulled verbatim from ``SectionsToolbar`` (debt #201). A pure builder — no hooks — so it carries no hook-ordering risk and its item bodies match the original.

.. CG-EXPLANATION-END id=module-header

``function buildGeotechToolbarItems``
-------------------------------------

.. CG-BLOCK id=function:buildGeotechToolbarItems lines=47-300

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/sectionsGeotechToolbarItems.tsx
   :language: tsx
   :lines: 47-300
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildGeotechToolbarItems

**What this does.** Assembles the geotech-axis verb specs. It builds the three menus, works out the pipeline button's busy label, then lays out: the statistic dropdown first (labelled with the current statistic), the four-step pipeline dropdown, the pending-tie chip (only while a tie is pending), the stale-litho chip (only while something is stale), the manual 'Correlate packing' button, and the Display dropdown. Returns an empty list off the geotech axis. Each spec declares a priority the responsive row uses to decide what keeps its label when space runs short.

**Why it is here.** The statistic control is FIRST, ahead of the pipeline, because it is a choice made before subdividing (owner 2026-08-09: 'the user chooses before subdividing') and is part of that model's provenance; its ``iconOnly: false`` keeps the current statistic readable without opening anything. The pipeline is one dropdown because four inline buttons crowded the bar. The two chips stay OUTSIDE the pipeline menu because they are numbers a gate depends on — a count only visible after two clicks is not a gate read-out. Both chips render only while there is something to show, so they are never standing weight.

.. CG-EXPLANATION-END id=function:buildGeotechToolbarItems


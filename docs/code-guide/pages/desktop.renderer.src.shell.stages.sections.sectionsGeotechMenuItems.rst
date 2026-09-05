desktop.renderer.src.shell.stages.sections.sectionsGeotechMenuItems
===================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/sectionsGeotechMenuItems.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/sectionsGeotechMenuItems.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-39

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/sectionsGeotechMenuItems.tsx
   :language: tsx
   :lines: 1-39
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the three dropdown menus of the geotech-axis toolbar — the qc-statistic picker, the four-step packing pipeline, and the Display menu. It imports the icons, the store-toggle functions, and the pieces of shared state each menu reads.

**Why it is here.** Pulled verbatim out of the giant ``SectionsToolbar`` file (debt #201) alongside its sibling. Each builder is a pure function returning a list of menu rows, so it calls no hooks and its body is byte-identical to the original inline code.

.. CG-EXPLANATION-END id=module-header

``type PendingScope``
---------------------

.. CG-BLOCK id=type:PendingScope lines=40-41

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/sectionsGeotechMenuItems.tsx
   :language: tsx
   :lines: 40-41
   :lineno-match:

.. CG-EXPLANATION-START id=type:PendingScope

**What this does.** A short alias for the pending-tie summary shape — the model total, this section's count, and which other sections are still dirty.

**Why it is here.** Naming the return shape of the summariser once lets the menu builders refer to it without repeating the full type.

.. CG-EXPLANATION-END id=type:PendingScope

``type TieStatus``
------------------

.. CG-BLOCK id=type:TieStatus lines=42-43

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/sectionsGeotechMenuItems.tsx
   :language: tsx
   :lines: 42-43
   :lineno-match:

.. CG-EXPLANATION-START id=type:TieStatus

**What this does.** A short alias for the tie-status snapshot — the loaded / pending / accepted counts.

**Why it is here.** Same reason as above: name the hook's status shape once so the builders can accept it as a typed input.

.. CG-EXPLANATION-END id=type:TieStatus

``type StaleGeotechColumns``
----------------------------

.. CG-BLOCK id=type:StaleGeotechColumns lines=44-50

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/sectionsGeotechMenuItems.tsx
   :language: tsx
   :lines: 44-50
   :lineno-match:

.. CG-EXPLANATION-START id=type:StaleGeotechColumns

**What this does.** A short alias for the merged list of columns whose packing bands are out of date (debt #266).

**Why it is here.** Naming the union helper's return type keeps the dependency interface readable.

.. CG-EXPLANATION-END id=type:StaleGeotechColumns

``interface GeotechToolbarItemsDeps``
-------------------------------------

.. CG-BLOCK id=interface:GeotechToolbarItemsDeps lines=51-91

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/sectionsGeotechMenuItems.tsx
   :language: tsx
   :lines: 51-91
   :lineno-match:

.. CG-EXPLANATION-START id=interface:GeotechToolbarItemsDeps

**What this does.** One big description of everything the geotech verbs and their menus read from the toolbar: the translator, the axis flags, the active litho and geotech models, the open section id, the chosen statistic, the many busy flags (subdividing, correlating, accepting, dividing), the fill-visibility flags, the pending/tie/stale counts, and the handler functions each verb fires.

**Why it is here.** One interface for the whole geotech block, with each menu builder using only the subset it needs — so the toolbar passes its derived state once and the builders stay pure functions of it.

.. CG-EXPLANATION-END id=interface:GeotechToolbarItemsDeps

``function buildGeotechStatisticMenuItems``
-------------------------------------------

.. CG-BLOCK id=function:buildGeotechStatisticMenuItems lines=92-129

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/sectionsGeotechMenuItems.tsx
   :language: tsx
   :lines: 92-129
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildGeotechStatisticMenuItems

**What this does.** Builds the 'qc: <statistic>' dropdown — a disabled note reminding that a pick applies at the NEXT subdivide, then one row per available statistic (median, harmonic, and so on), the current one tagged. Returns an empty list off the geotech axis.

**Why it is here.** The note is stated inside the menu, not only in a tooltip, because a tooltip is not read before a click and the surprising thing here is that picking a statistic changes nothing on screen by itself. The menu is NOT gated on a geotech model existing — owner 2026-08-15: 'I can't choose harmonic qc before first subdivide, that's friction we don't need?' — so the pick is held in the renderer and handed to the press that creates the model.

.. CG-EXPLANATION-END id=function:buildGeotechStatisticMenuItems

``function buildGeotechPipelineMenuItems``
------------------------------------------

.. CG-BLOCK id=function:buildGeotechPipelineMenuItems lines=130-308

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/sectionsGeotechMenuItems.tsx
   :language: tsx
   :lines: 130-308
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildGeotechPipelineMenuItems

**What this does.** Builds the four numbered packing-pipeline rows — 1 Subdivide CPTs, 2 Auto-correlate, 3 Accept correlations, 4 Divide boreholes — each with its icon, its enabled/disabled state, a visible tag when something is stale or pending, a keyboard number, and its click handler. Step 4's handler assembles the borehole geometry BEFORE it presses, and passes skip-existing so an already-divided borehole keeps its bands.

**Why it is here.** The steps carry the owner's whole packing workflow. Step 1 proposes NOTHING (owner ruling 2026-08-04) so the machine's ties arrive as suggestions the engineer reviews, not accepted work. Gate reasons live on visible tag pills, not hover tooltips, because a disabled menu row fires no hover event in this browser engine. Step 4 fetches the partition first because the divide rebuilds every borehole band, so a partition fetched afterwards would describe a model the press has already changed. First-subdivision-wins (owner 2026-08-18): skip-existing keeps a borehole divided from another section, and any hand-set class, untouched.

.. CG-EXPLANATION-END id=function:buildGeotechPipelineMenuItems

``function buildGeotechDisplayMenuItems``
-----------------------------------------

.. CG-BLOCK id=function:buildGeotechDisplayMenuItems lines=309-395

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/sectionsGeotechMenuItems.tsx
   :language: tsx
   :lines: 309-395
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildGeotechDisplayMenuItems

**What this does.** Builds the geotech Display menu: three fills (the NAD packing fill, the built-3-D model fill, and the litho fill) leading the list contiguously, then the borehole-preview toggle, the correlation-ribbon toggle, and the shared sample toggles. Each names the state a click moves to and flips its store.

**Why it is here.** The three fills lead the menu and the two the owner named sit adjacent (dogfeed 2026-08-26) because they exclude one another, so the menu has to read as a set to pick ONE from — scattering the model fill four items down made it look like an unrelated switch. The borehole preview is opt-in (owner 2026-08-07) after auto-appearing ghosts read as 'my boreholes got subdivided'.

.. CG-EXPLANATION-END id=function:buildGeotechDisplayMenuItems


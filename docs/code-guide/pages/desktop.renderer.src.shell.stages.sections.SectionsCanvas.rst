desktop.renderer.src.shell.stages.sections.SectionsCanvas
=========================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/sections/SectionsCanvas.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/sections/SectionsCanvas.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-107

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SectionsCanvas.tsx
   :language: tsx
   :lines: 1-107
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Header for the centre canvas of the Sections stage. It shows the section editor when a section is selected, and falls back to the project map (in draw-a-line mode) when none is, so the engineer can pick or draw a cross-section. It imports the section panel, the map, the many dialogs, the extracted hooks (packing correlation, band edit, edge-drag, snap, manual litho unit, borehole preview, pending-tie reveal), and the shell bus.

**Why it is here.** It reproduces the old App-file branch verbatim, now sourcing every prop from the shell bus — the same pattern the Data stage's canvas uses. It accepts no direct props, matching the canvas-component contract. The no-section fallback overlays a call-to-action card so the 'New cross-section' action is on the canvas itself, and the card's pointer events are isolated so the map's pan/zoom/draw still work through it. The split viewport (a 2-D section here, the 3-D room on the litho and geotech stages) is the app's editing surface for all three model levels.

.. CG-EXPLANATION-END id=module-header

``function SectionsCanvas``
---------------------------

.. CG-BLOCK id=function:SectionsCanvas lines=108-3029

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/sections/SectionsCanvas.tsx
   :language: tsx
   :lines: 108-3029
   :lineno-match:

.. CG-EXPLANATION-START id=function:SectionsCanvas

**What this does.** The canvas component — the master container that wires the section editor to the shell. It reads the whole shell bus, resolves the selected section, and owns a large amount of state and behaviour: the correlation-edge fetches for both the litho frame and the separate geotech packing overlay (each with a guard that drops a late answer from a section the engineer has left, and blanks the view rather than showing a previous section's ties); the litho and geotech body rosters and their arming gates; every correlation handler (create, delete, accept, confirm-review) with undo entries; the body verbs (name, dissolve, Join, un-join) on the axes that allow them; the geotech band-edit and flagged-tie hooks; the one geotech-axis contact edit (a band boundary that restates a litho contact, which writes to the litho row through a preview-then-confirm dialog and can move all three models in one transaction); the section-aware create and copy wrappers; the litho-to-geology snap dialog; and the borehole-preview ghosts. It then renders either the section panel (handing it that enormous, axis-aware prop set plus the dialog stack) or the map fallback with its call-to-action card.

**Why it is here.** Almost everything here is shaped by two forces: keeping one section's data from bleeding onto another (sections share investigations, so a late edge response is checked against the section selected NOW, and the view blanks during an in-flight fetch rather than showing stale ties), and enforcing that the geotech axis is view-only EXCEPT for the deliberate holes — the band-edit verbs and the one contact drag — which is done by simply not passing the editing handlers on that axis rather than by an axis check inside the overlays. The partition SHAPE always comes from the litho model on both axes (the geotech fill is the litho partition refined by NAD class), so the geotech packing overlay fetches from a different model than the partition and is kept in separate state — reusing one list once pulled the litho connectivity out of the fill and pinched every band to a lens. Several hooks are declared only after every input they read, because they are const bindings and a hook call above one is a temporal-dead-zone crash no type check catches. The one geotech contact edit asks first through a dialog because it edits the level above (and sometimes the level above that) and nothing on screen says the row is shared; a failed refetch after a committed edit is reported as a stale-view warning, never as a failure, so the engineer never doubles a write. The map fallback's call-to-action card resets each time the canvas mounts so new users always see the prompt, and its wrapper is click-through so the map stays interactive.

.. CG-EXPLANATION-END id=function:SectionsCanvas


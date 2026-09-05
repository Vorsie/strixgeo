desktop.renderer.src.shell.stages.geotechnical.GeotechnicalInspector
====================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geotechnical/GeotechnicalInspector.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geotechnical/GeotechnicalInspector.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-32

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechnicalInspector.tsx
   :language: tsx
   :lines: 1-32
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file for the Geotechnical stage's inspector — the right-hand panel. The top comment records that the panel's chrome and the selected-body readout live here, while the roster tree itself lives in ``GeotechnicalUnitRoster`` and its arithmetic in ``geotechUnitTree.ts``. It then pulls in the API client, the logger, the NAD-class name helper, the geotech body-selection store, the empty-state box, the shell context, the translation and language helpers, and the two body-fetch hooks it reuses from the Parameters stage.

**Why it is here.** The tree was split out of this file when it grew: the flat list fitted here but the tree does not, and debt #201 is specifically about not letting a stage component swell up and absorb everything again. Keeping the panel chrome here and the arithmetic in a plain module means the grouping and roll-up logic can be tested without a browser.

.. CG-EXPLANATION-END id=module-header

``const ASSIGNMENT_SOURCE_LABELS``
----------------------------------

.. CG-BLOCK id=const:ASSIGNMENT_SOURCE_LABELS lines=33-55

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechnicalInspector.tsx
   :language: tsx
   :lines: 33-55
   :lineno-match:

.. CG-EXPLANATION-START id=const:ASSIGNMENT_SOURCE_LABELS

**What this does.** A small lookup turning each raw "where did this sample's class come from" token — CPT-interpolated, body-minimum, absolute-minimum, unresolved — into a human-readable label.

**Why it is here.** Translation happens at the screen, not in storage: the domain keeps the raw backend token and this table converts it for display (the translate-at-the-presentation-boundary rule). The raw token is still shown as a tooltip elsewhere so a domain expert can check the mapping.

.. CG-EXPLANATION-END id=const:ASSIGNMENT_SOURCE_LABELS

``function GeotechnicalInspector``
----------------------------------

.. CG-BLOCK id=function:GeotechnicalInspector lines=56-233

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geotechnical/GeotechnicalInspector.tsx
   :language: tsx
   :lines: 56-233
   :lineno-match:

.. CG-EXPLANATION-START id=function:GeotechnicalInspector

**What this does.** The inspector component — the function that draws the panel. It reads the geotech formations, contacts and layers plus the two active models from the shell's shared context, fetches the geotech model's bodies and the parent litho model's bodies and the manual body groups, and derives the formation for whichever body is currently selected on the section canvas. It draws a heading, then either an empty-state prompt (when no geotech units exist yet) or the soil-by-litho-body-by-packing-body roster; below that, when a sample dot is picked, it shows the selected body's packing-class name and NAD number and where its class assignment came from; and it always ends with the "CPT-derived estimate" disclaimer. It also owns the handler that writes a picked colour onto a unit.

**Why it is here.** The bodies are re-fetched on either a body-recompute or a geotech Build, because a Build heals the parent-litho-body links server-side and the roster must re-read them without waiting for a recompute (debt #278); the two monotonic counters are summed into one collision-free refresh key. A colour choice is written to ``color_override``, never to ``color``, because ``color`` is the lithology colour the materialiser copied from the source litho unit — overwriting it would destroy the inherited identity and leave nothing to tell a decision apart from a stamped default; ``null`` clears the choice back to the automatic packing colour. One roster row can stand for several units, so one gesture becomes several update calls sent together with a single refetch afterwards, so the pane repaints in one step. The assignment-source token is shown through the lookup with the raw token exposed as a tooltip, so a domain expert can verify the mapping without opening developer tools.

.. CG-EXPLANATION-END id=function:GeotechnicalInspector


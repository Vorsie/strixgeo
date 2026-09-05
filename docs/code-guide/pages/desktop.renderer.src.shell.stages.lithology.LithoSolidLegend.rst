desktop.renderer.src.shell.stages.lithology.LithoSolidLegend
============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/lithology/LithoSolidLegend.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/lithology/LithoSolidLegend.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-22

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithoSolidLegend.tsx
   :language: tsx
   :lines: 1-22
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and imports its tools: four React hooks (``useEffect``, ``useMemo``, ``useRef``, ``useState``), four icons (a warning triangle, an open eye, a closed eye, a reset arrow), the two record types it reads (a formation and a built body-solid) from the engine, the ``lithoDisplayName`` label helper, and the translator type. The comment explains this is the per-body colour-picker legend, grouped by lithology, and that it is the largest single block lifted out of ``LithologyInspector``.

**Why it is here.** A ``hook`` is a ``use...`` function that lets a component use a React feature. This roughly 330-line legend was split off ``LithologyInspector.tsx`` during the god-component decomposition round (debt #201). The comment records that, unlike the other extracted pieces, this one owns its OWN display state — which groups are expanded, and an effect that opens small groups when the solids first arrive — which moved with it unchanged; the parent still owns the model, the solids, the colour setter, and the hide-markers flag.

.. CG-EXPLANATION-END id=module-header

``const LEGEND_COLLAPSE_THRESHOLD``
-----------------------------------

.. CG-BLOCK id=const:LEGEND_COLLAPSE_THRESHOLD lines=23-24

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithoSolidLegend.tsx
   :language: tsx
   :lines: 23-24
   :lineno-match:

.. CG-EXPLANATION-START id=const:LEGEND_COLLAPSE_THRESHOLD

**What this does.** A constant set to 8: the number of bodies above which a lithology group is collapsed by default.

**Why it is here.** Groups with more than eight bodies would fill the panel with a wall of rows on larger models, so they start folded and the engineer opens the ones he wants.

.. CG-EXPLANATION-END id=const:LEGEND_COLLAPSE_THRESHOLD

``interface LithoSolidLegendProps``
-----------------------------------

.. CG-BLOCK id=interface:LithoSolidLegendProps lines=25-81

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithoSolidLegend.tsx
   :language: tsx
   :lines: 25-81
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoSolidLegendProps

**What this does.** Describes the inputs: all built ``lithoSolids`` for the model, all ``lithoFormations`` (for group names and colours), a ``setBodyColor`` function to set or clear one body's colour, a ``hideMarkers`` flag, an ``onToggleHideMarkers`` callback, and the translator ``t``. It carries a long docstring describing the grouping, the per-body row contents, the collapse behaviour, and the hide-markers rule.

**Why it is here.** ``props`` are the inputs a parent hands a component. The docstring records the key rules: ``setBodyColor`` is optimistic and debounced (the colour updates on screen at once and the save is batched), and when ``hideMarkers`` is on, rows for flagged (marker) bodies are hidden but the group header stays visible with an "(N markers hidden)" note — vanishing a header whose bodies are all markers would wrongly suggest the lithology does not exist.

.. CG-EXPLANATION-END id=interface:LithoSolidLegendProps

``function LithoSolidLegend``
-----------------------------

.. CG-BLOCK id=function:LithoSolidLegend lines=82-352

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithoSolidLegend.tsx
   :language: tsx
   :lines: 82-352
   :lineno-match:

.. CG-EXPLANATION-START id=function:LithoSolidLegend

**What this does.** Draws the legend. It keeps only solids that actually have geometry, builds a fast formation lookup, and groups the solids by formation — each group's bodies sorted by ordinal, the groups sorted oldest-first by ``display_order``. It remembers which groups are expanded, opening the small ones once the solids first arrive. It counts the marker (flagged) bodies. When no solids are built it shows a short "build to see bodies" prompt. Otherwise it draws a header with a hide-markers toggle, then each lithology group as a click-to-expand header (colour swatch, name, body count, marker count) with, when open, one row per body: a colour picker, the body's ordinal, an amber dot when the body is stale, a warning triangle when it is under-constrained, and a reset button when a custom colour has been set.

**Why it is here.** The expanded-groups state starts empty and opens the small groups only ONCE, when the group list first turns from empty to non-empty, because the solids arrive from the engine after the first draw: a lazy one-time initialiser would capture the empty list and never update, and re-opening on every draw would fight the engineer's own collapse choices. The hide-markers toggle fires immediately with no dialog because show/hide is reversible local view state (see ``docs/ux.md``). Marker bodies are the under-constrained ones flagged by the build; keeping their group header visible with a hidden-count note stops a lithology from silently disappearing. The reset button appears only when a body has an overriding custom colour, and returns it to the group's lithology colour.

.. CG-EXPLANATION-END id=function:LithoSolidLegend


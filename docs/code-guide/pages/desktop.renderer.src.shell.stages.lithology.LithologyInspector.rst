desktop.renderer.src.shell.stages.lithology.LithologyInspector
==============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/lithology/LithologyInspector.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/lithology/LithologyInspector.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-69

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithologyInspector.tsx
   :language: tsx
   :lines: 1-69
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Names the file and imports its tools: four React hooks (``useCallback``, ``useEffect``, ``useMemo``, ``useState``), a layers icon, the API client and two of its record types, the shared ``Button`` and ``Modal``, a formation-kind test helper, the logger, the ``EmptyState`` prompt, the shell context hook, and the nine sibling panel pieces this inspector composes (``ConfirmParentDialog``, ``LithoBoreholesInModel``, ``LithoCommittedPill``, ``LithoConfidenceFadeToggle``, ``LithoExcludedBoreholes``, ``LithoFormationRoster``, ``LithoResolveAction``, ``LithoSolidLegend``, ``ModelKindPicker``). The long comment records the design: a flat, geo-agnostic roster under the "A2" rule, per-body instance numbering (not per-formation), and Build living on the toolbar.

**Why it is here.** React is the library that builds the screen from small functions; a ``hook`` is a ``use...`` function that lets one of those functions use a React feature; the API client is the desktop-side wrapper around the calls to the engine. The comment records why the panel is assembled from many small imports: this file is a thin orchestrator that owns the state and hooks while its panel sections are presentational sibling files, the result of the god-component decomposition round (debt #201). It also records what was removed — the parent-group headers (units are now geo-agnostic, so every unit would fall into one "Unassigned" bucket) and the old per-formation ordinal machinery (instance numbering moved to per-body labels on the section).

.. CG-EXPLANATION-END id=module-header

``function LithologyInspector``
-------------------------------

.. CG-BLOCK id=function:LithologyInspector lines=70-405

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/lithology/LithologyInspector.tsx
   :language: tsx
   :lines: 70-405
   :lineno-match:

.. CG-EXPLANATION-START id=function:LithologyInspector

**What this does.** The inspector component. It reads the project, the visible boreholes, the model bundle, and the confidence-fade state from the shell. It builds an id-to-name lookup for the excluded-boreholes list; holds the clear-model dialog state and the function that runs the clear after confirmation; fetches the lens list whenever the active model changes so the lens-count badges stay current; runs a "resolve" that re-fetches the formations; holds the confirm-parent dialog target and the function that writes a chosen parent; derives the candidate geological parents; and filters the roster to only the units that actually have a contact in this model. If no geological backbone exists it shows a short prompt. Otherwise it draws the model picker, the confidence-fade toggle, and — when a litho model is active — the committed-contacts pill, the resolve action, the flat roster (or an empty prompt), the body-solid legend, the two borehole rosters, and a guidance footer; plus the confirm-parent dialog and an irreversible clear-model confirm dialog.

**Why it is here.** The roster is filtered to units with a contact in THIS model (debt #147) because the model's unit list is derived from the whole project's shared vocabulary, so a freshly created empty model would otherwise still list a deleted model's units — the pill and the roster must tell the same story. The lens fetch is keyed only on the model id (the exhaustive-deps linter is deliberately suppressed with a reason) because that id is the stable identity. The clear-model dialog focuses Cancel by default and uses a danger-styled, action-named button, because clearing a model is irreversible (see ``docs/ux.md``); the reversible controls (toggles, includes) fire immediately with no dialog. Confirming a parent writes the chosen parent and clears the "extrapolated" flag in one call, then re-fetches so the amber review dot disappears.

.. CG-EXPLANATION-END id=function:LithologyInspector


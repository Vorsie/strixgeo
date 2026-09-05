desktop.renderer.src.hooks.useMapOverlays
=========================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useMapOverlays.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useMapOverlays.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-47

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useMapOverlays.ts
   :language: typescript
   :lines: 1-47
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The comment and the imports (five React hooks, the API client, the logger, the translation helper, project types, and two groups of overlay utilities). This file owns two map overlays: the DEM hillshade (a shaded-relief ground layer) and the DOV Virtuele Boring predictions (predicted soil layering along a virtual borehole).

**Why it is here.** Both overlays read from the same ``project.view_state`` and save through the same endpoint, so they are co-located here to avoid fetching that state twice. The comment records where each piece lives: the DEM source is derived from the project's horizontal coordinate system (Belgium uses DHMVII, the Netherlands AHN) and round-trips in the ``.gmproj`` bundle; the virtuele-boring model choices persist in the view state, but the per-investigation predictions are NOT persisted (they are a derived view that would bloat the file), so they are re-fetched when the project or the chosen models change; per-pane visibility and model overrides are kept in *localStorage* because they are per-user screen preferences, not project decisions.

.. CG-EXPLANATION-END id=module-header

``interface VirtueleBoringPickerPayload``
-----------------------------------------

.. CG-BLOCK id=interface:VirtueleBoringPickerPayload lines=48-53

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useMapOverlays.ts
   :language: typescript
   :lines: 48-53
   :lineno-match:

.. CG-EXPLANATION-START id=interface:VirtueleBoringPickerPayload

**What this does.** The small payload the Virtuele Boring picker hands over: two model choices (``modelA`` / ``modelB``, either of which may be empty) and an optional maximum depth.

**Why it is here.** Names the shape passed when the user picks which layer models to compare, so the handler and the picker agree on it.

.. CG-EXPLANATION-END id=interface:VirtueleBoringPickerPayload

``interface UseMapOverlaysResult``
----------------------------------

.. CG-BLOCK id=interface:UseMapOverlaysResult lines=54-114

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useMapOverlays.ts
   :language: typescript
   :lines: 54-114
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseMapOverlaysResult

**What this does.** The large return shape. For the DEM: its source, the overlay state, and a change handler. For Virtuele Boring: the overlay state, the section models, the predictions, loading and skipped counts, a lookup of prediction by investigation id, the effective models per pane, the per-pane show flags and model overrides, and handlers to change the picker, set per-pane visibility, and set an override. Plus a ``showConfidenceFade`` flag and its setter. These lines also carry the hook's documentation.

**Why it is here.** Naming everything the map and the detail panes read keeps the surface explicit. The confidence-fade flag is per-project (it persists in the view state; a legacy project without it is treated as on) and decides whether low-confidence triangles and segments render faded as an uncertainty cue or at full strength.

.. CG-EXPLANATION-END id=interface:UseMapOverlaysResult

``function useMapOverlays``
---------------------------

.. CG-BLOCK id=function:useMapOverlays lines=115-432

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useMapOverlays.ts
   :language: typescript
   :lines: 115-432
   :lineno-match:

.. CG-EXPLANATION-START id=function:useMapOverlays

**What this does.** The hook. It takes the current project, a view-state patch callback, and the toast action. It derives the DEM source and overlay from the project using ``useMemo`` (a hook that caches a computed value and only recomputes it when its inputs change), with a handler that saves changes through the patch callback; the confidence-fade flag works the same way. The Virtuele Boring half derives the active and per-pane effective models, runs *effects* that fetch predictions whenever the project or the active models change, and offers handlers to change the picker, set per-pane visibility, and set overrides; finally it builds a prediction-by-id lookup map.

**Why it is here.** The overlays stay dormant when no project is open — no fetches fire and no predictions are stored. Computed values use ``useMemo`` so they recompute only when their inputs change, not on every redraw. Predictions are re-fetched on a project or model change because they are a derived view that is deliberately not saved to the file. One ``eslint-disable`` carries a ``// reason:`` comment: ``toast`` comes from the toasts hook and is stable across redraws, so listing it in the dependency array would be needless noise (the CLAUDE.md rule that every suppression must say why the linter is wrong). The view-state patch keeps the project and its saved copy in step so changing an overlay does not falsely flip the unsaved-changes flag.

.. CG-EXPLANATION-END id=function:useMapOverlays


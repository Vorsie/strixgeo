desktop.renderer.src.shell.stages.parameters.useUnitGrouping
============================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/parameters/useUnitGrouping.ts complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/parameters/useUnitGrouping.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-35

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/useUnitGrouping.ts
   :language: typescript
   :lines: 1-35
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the file for the custom hook that orchestrates "Group" / "Ungroup" for the Parameters unit list, importing React's hooks, the API client, the translator, the logger, the class-name helper, the shared join-error mapper, and the pure helpers from ``unitGrouping.ts``.

**Why it is here.** It holds the checkbox selection, derives the same-class guard, and fires the SAME body-union client the section-canvas Join uses — plus the identical geotech refetch pair — so the "(group N)" tag, the 2-D fill and the unit statistics all re-derive exactly as they do after a canvas Join or Un-join. It is a hook rather than inline code in the pane so the pane stays under the 500-line cap (debt #201) and its own list of hooks stays flat above its early returns; this hook has no early return, so its internal hooks are always run unconditionally — the standard rule that keeps React's hook order stable.

.. CG-EXPLANATION-END id=module-header

``type ToastFn``
----------------

.. CG-BLOCK id=type:ToastFn lines=36-38

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/useUnitGrouping.ts
   :language: typescript
   :lines: 36-38
   :lineno-match:

.. CG-EXPLANATION-START id=type:ToastFn

**What this does.** Names the shape of the toast function the hook is handed: it takes a kind (success, error or warning), a message, and an optional replace key.

**Why it is here.** A toast is a small temporary message that appears and fades; typing its signature here lets the hook take the shell's toast sink as a plain input rather than reaching for the shell itself.

.. CG-EXPLANATION-END id=type:ToastFn

``interface UseUnitGroupingArgs``
---------------------------------

.. CG-BLOCK id=interface:UseUnitGroupingArgs lines=39-62

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/useUnitGrouping.ts
   :language: typescript
   :lines: 39-62
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseUnitGroupingArgs

**What this does.** Lists everything the orchestration reads, all of it already held by the pane: the project and geotech model ids, the geotech layers and formations, the model's unions, the ``body id → group number`` map, the two refetch levers, the toast sink and the translator.

**Why it is here.** The hook takes its inputs explicitly rather than reaching into the shell so it stays pure-ish and testable; the comment notes each value is something the pane already has. Unions live on the geotech model, so its id and the union list are here; the refetch levers are what re-derive the tags, fill and statistics after a change.

.. CG-EXPLANATION-END id=interface:UseUnitGroupingArgs

``interface UseUnitGroupingResult``
-----------------------------------

.. CG-BLOCK id=interface:UseUnitGroupingResult lines=63-102

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/useUnitGrouping.ts
   :language: typescript
   :lines: 63-102
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseUnitGroupingResult

**What this does.** Lists what the hook hands back for the pane to bind to its checkboxes and bulk bar: whether a body is checked, toggle and clear, the checked count, the group guard status, the class names in the selection, whether any checked body is already grouped, a busy flag, and the two bulk actions ``group`` and ``ungroup``.

**Why it is here.** This is the whole surface the pane and its action bar need — a selection API plus two actions — so the pane can stay a thin renderer. The class NAMES are exposed so a cross-class refusal can name the offending classes in words; the busy flag disables the buttons during a round-trip; the already-grouped flag decides whether Ungroup even shows.

.. CG-EXPLANATION-END id=interface:UseUnitGroupingResult

``function useUnitGrouping``
----------------------------

.. CG-BLOCK id=function:useUnitGrouping lines=103-244

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/parameters/useUnitGrouping.ts
   :language: typescript
   :lines: 103-244
   :lineno-match:

.. CG-EXPLANATION-START id=function:useUnitGrouping

**What this does.** The hook. It holds the ticked-body set and a busy flag; it memoises the ``body id → class`` map, the group guard, the selection's class names and whether anything ticked is already grouped; it exposes check, toggle and clear; and it defines ``group`` (create one union per star pair, then refetch) and ``ungroup`` (delete every union anchoring each ticked grouped body, then refetch), each toasting success or a mapped error and clearing the selection.

**Why it is here.** Grouping and ungrouping are reversible, so there is no confirmation dialog (per ``docs/ux.md``) and the success toast names the undo path. Both actions mirror the section-canvas handlers exactly — the same body-union client and the same geotech recompute-and-refetch pair — so the two surfaces stay in lockstep. A cross-class refusal from the engine (a 422) is mapped through the shared join-error helper so the pane shows the same packing-versus-lithology wording the canvas does; anything else falls back to the generic group-failed line. ``useMemo`` caches each derived value so it is not recomputed on every redraw, and ``useCallback`` keeps the action functions stable.

.. CG-EXPLANATION-END id=function:useUnitGrouping


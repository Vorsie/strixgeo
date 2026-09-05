desktop.renderer.src.hooks.useInvestigationData
===============================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useInvestigationData.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useInvestigationData.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-42

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useInvestigationData.ts
   :language: typescript
   :lines: 1-42
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The comment and the imports, plus the section comment introducing the shared helpers. This hook owns CPT and borehole data: the list state, the detail caches, the import flows, the hide/restore mechanics, and the elevation edits.

**Why it is here.** The selection state and the view-navigation signal are injected from the App coordinator so this hook does not couple to the section-selection hook (which also needs those setters). The four helpers below are single shared implementations extracted from what used to be separate CPT and borehole handler pairs (audit FE-HOOKS-11) — the same control flow differing only in the review kind and which slice of state it touches, so each pair became one implementation with two thin wrappers.

.. CG-EXPLANATION-END id=module-header

``type InvestigationKind``
--------------------------

.. CG-BLOCK id=type:InvestigationKind lines=43-45

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useInvestigationData.ts
   :language: typescript
   :lines: 43-45
   :lineno-match:

.. CG-EXPLANATION-START id=type:InvestigationKind

**What this does.** The discriminator the shared helpers use to tell the two kinds apart: ``cpt`` or ``borehole``.

**Why it is here.** One label lets a single helper serve both kinds instead of duplicating each one.

.. CG-EXPLANATION-END id=type:InvestigationKind

``const KIND_LOG_LABEL``
------------------------

.. CG-BLOCK id=const:KIND_LOG_LABEL lines=46-80

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useInvestigationData.ts
   :language: typescript
   :lines: 46-80
   :lineno-match:

.. CG-EXPLANATION-START id=const:KIND_LOG_LABEL

**What this does.** A lookup from the kind to a readable log label (``CPT`` or ``borehole``). These lines also carry the documentation of the first helper below.

**Why it is here.** So a shared helper's log line names the right kind — ``hide-CPT ...`` or ``restore-borehole ...`` — even though one implementation serves both.

.. CG-EXPLANATION-END id=const:KIND_LOG_LABEL

``function unhideInvestigations``
---------------------------------

.. CG-BLOCK id=function:unhideInvestigations lines=81-121

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useInvestigationData.ts
   :language: typescript
   :lines: 81-121
   :lineno-match:

.. CG-EXPLANATION-START id=function:unhideInvestigations

**What this does.** Clears the given ids from the removed-set and turns the server-side hidden flag off for them.

**Why it is here.** Re-importing or re-fetching a record is an explicit ``make this visible again`` signal — without this, a duplicate import returns the existing id but the sidebar's removed-filter keeps it hidden and the user sees no change. The touched list is computed from the CURRENT removed-set BEFORE the state update, because React's functional updater runs later in the redraw: reading a list mutated inside the updater right away would find it empty and silently skip the unhide — the exact failure this logic exists to prevent.

.. CG-EXPLANATION-END id=function:unhideInvestigations

``function removeInvestigations``
---------------------------------

.. CG-BLOCK id=function:removeInvestigations lines=122-166

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useInvestigationData.ts
   :language: typescript
   :lines: 122-166
   :lineno-match:

.. CG-EXPLANATION-START id=function:removeInvestigations

**What this does.** Hides the given investigations: adds them to the removed-set, turns the server hidden flag on, and registers an undo command.

**Why it is here.** A ``remove`` here is a reversible project-local hide, not a delete — the database rows stay and simply become invisible until re-created (the no-database-delete-on-rollback rule), which keeps the import cache warm. Being reversible, it fires immediately and offers undo rather than a confirmation dialog.

.. CG-EXPLANATION-END id=function:removeInvestigations

``function restoreAllInvestigations``
-------------------------------------

.. CG-BLOCK id=function:restoreAllInvestigations lines=167-219

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useInvestigationData.ts
   :language: typescript
   :lines: 167-219
   :lineno-match:

.. CG-EXPLANATION-START id=function:restoreAllInvestigations

**What this does.** Empties the whole removed-set for the kind and clears the server hidden flag on all of them.

**Why it is here.** The ``restore everything`` path. It reads the removed-set directly for the same reason as the unhide helper — a deferred state updater would read stale and skip the server write.

.. CG-EXPLANATION-END id=function:restoreAllInvestigations

``function patchInvestigationElevation``
----------------------------------------

.. CG-BLOCK id=function:patchInvestigationElevation lines=220-256

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useInvestigationData.ts
   :language: typescript
   :lines: 220-256
   :lineno-match:

.. CG-EXPLANATION-START id=function:patchInvestigationElevation

**What this does.** Writes a manually-entered ground elevation for one investigation and updates the local state to match.

**Why it is here.** One shared elevation-edit implementation for both kinds. A surveyed collar elevation outranks the terrain model at that point (the elevation-trust rule), so a manual value is stored and honoured over the DEM.

.. CG-EXPLANATION-END id=function:patchInvestigationElevation

``interface UseInvestigationDataResult``
----------------------------------------

.. CG-BLOCK id=interface:UseInvestigationDataResult lines=257-376

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useInvestigationData.ts
   :language: typescript
   :lines: 257-376
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseInvestigationDataResult

**What this does.** The return shape: the CPT and borehole lists, the detail and plot caches, the import and load flags, the full DOV streaming-import state, and every action handler (load, import, hide, restore, elevation).

**Why it is here.** Naming the whole surface documents exactly what the App reads and calls for investigation data.

.. CG-EXPLANATION-END id=interface:UseInvestigationDataResult

``function useInvestigationData``
---------------------------------

.. CG-BLOCK id=function:useInvestigationData lines=377-1156

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useInvestigationData.ts
   :language: typescript
   :lines: 377-1156
   :lineno-match:

.. CG-EXPLANATION-START id=function:useInvestigationData

**What this does.** The hook. It takes the project, the engine-ready flag, the toast, the undo-push, the manifest, the session-import setters, the selection state and view setter, and the mark-changed action. It keeps the lists and caches in *state*, runs *effects* that load the lists when the project changes and the engine is ready, wires the DOV streaming import, and exposes the load / import / hide / restore / elevation handlers through the shared helpers above.

**Why it is here.** Several effects list only ``project.id`` in their dependency arrays and suppress the exhaustive-deps lint with a ``// reason:`` comment each time: ``project.id`` is a stable scalar that changes only on a real project switch, and the callbacks the effects call (refresh, toast, add-to-manifest, the load helpers) are render-stable — so listing them would re-run the effects needlessly or loop, and the suppressions name exactly that (the CLAUDE.md rule that every suppression says why the linter is wrong). A CPT refresh uses the mark-changed action rather than the session-import set, because a refresh replaces stored data without any new id joining the project, so the session-import set — which drives discard-on-close deletion — would be the wrong lever. The lists load only once the engine reports ready.

.. CG-EXPLANATION-END id=function:useInvestigationData


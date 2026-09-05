desktop.renderer.src.shell.stages.geology.FormationSelectionDialog
==================================================================

.. CG-PAGE source=desktop/src/renderer/src/shell/stages/geology/FormationSelectionDialog.tsx complete=true

*Source file:* ``desktop/src/renderer/src/shell/stages/geology/FormationSelectionDialog.tsx``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-109

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/FormationSelectionDialog.tsx
   :language: tsx
   :lines: 1-109
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** Opens the formation-selection-dialog file — the dialog behind the "Fill from boreholes" verb — records its behaviour and invariants in a long docstring, imports React hooks, the candidate and collision types, the API response types, the UI Modal and Button, the formation-key and partial-match helpers, and the translator, then documents the ``ReassignTarget`` type.

**Why it is here.** The docstring pins the design. "Fill from boreholes" runs a discovery scan that finds candidate formation names in the borehole stratigraphy; the engineer ticks which to keep and, on confirm, an apply call creates them. Each candidate row carries an inline "same as ..." dropdown so the engineer can lump a synonym onto another name; the dropdown ranks the other names by similarity but never hard-filters, so a zero-score synonym stays hand-pickable. Reassignments are keyed on the normalised server key, not the raw display string, or a diacritic or capitalisation variant would resolve to a different server key and break the discover-equals-apply invariant. Candidates matching an existing formation start pre-checked; new ones start unchecked (opt-in). Apply is the only irreversible action; every row reassignment is reversible with no per-change dialog.

.. CG-EXPLANATION-END id=module-header

``type ReassignTarget``
-----------------------

.. CG-BLOCK id=type:ReassignTarget lines=110-121

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/FormationSelectionDialog.tsx
   :language: tsx
   :lines: 110-121
   :lineno-match:

.. CG-EXPLANATION-START id=type:ReassignTarget

**What this does.** A TypeScript type for one row's reassignment target: either a pick of an existing candidate (identified by its stable key) or a free-form custom canonical name the engineer typed.

**Why it is here.** A TypeScript type is a note about what kind of value is expected. Storing the target as a plain display name caused three bugs: a duplicate-named candidate resolved to the wrong one; a custom name rendered as unchecked and disabled even though it would be created on Apply; and typing an exact candidate name created a phantom custom entry. A discriminated target that resolves the display name only at emit time removes all three.

.. CG-EXPLANATION-END id=type:ReassignTarget

``type RowReassignments``
-------------------------

.. CG-BLOCK id=type:RowReassignments lines=122-148

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/FormationSelectionDialog.tsx
   :language: tsx
   :lines: 122-148
   :lineno-match:

.. CG-EXPLANATION-START id=type:RowReassignments

**What this does.** A type alias — a Map from each reassigned candidate's normalised key to its ``ReassignTarget``. The lines that follow document the ``buildManualMap`` helper.

**Why it is here.** It is keyed on the normalised key (not the raw name) for the same discover-equals-apply reason as the module docstring, and it uses a Map because a Map iterates in insertion order and avoids prototype collisions on arbitrary formation names.

.. CG-EXPLANATION-END id=type:RowReassignments

``function buildManualMap``
---------------------------

.. CG-BLOCK id=function:buildManualMap lines=149-202

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/FormationSelectionDialog.tsx
   :language: tsx
   :lines: 149-202
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildManualMap

**What this does.** Builds the wire-format ``manual_map`` object — a plain record of candidate key to target display name — from the row-reassignment Map, resolving a candidate target's display name from the live candidate list at emit time while a custom target travels verbatim. The lines that follow document ``buildInitialReassignments``.

**Why it is here.** The wire shape is byte-identical to the pre-existing contract, so the backend and the discover-equals-apply invariant are unaffected. Resolving the name from the live candidate at emit time means a name that drifted between sessions cannot leave a stale entry behind.

.. CG-EXPLANATION-END id=function:buildManualMap

``function buildInitialReassignments``
--------------------------------------

.. CG-BLOCK id=function:buildInitialReassignments lines=203-235

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/FormationSelectionDialog.tsx
   :language: tsx
   :lines: 203-235
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildInitialReassignments

**What this does.** Rebuilds the row-reassignment state from a persisted ``manual_map`` snapshot: a target that exactly matches a current candidate's name is restored as a candidate pick (so the wire name re-resolves from the live candidate), and everything else is restored as a custom name. Every entry is kept. The lines that follow document ``buildInitialChecked``.

**Why it is here.** There is deliberately no filter dropping keys that are not in the current candidate list — the 2026-08-03 data-loss incident. A raw key the engineer has already lumped away is ABSENT from the candidate list by construction, which looks exactly like a genuinely stale key; the old filter could not tell them apart and deleted the engineer's groupings on every reopen. Carrying an unknown key is a harmless server-side no-op, while losing a real grouping costs real work — the asymmetry decides it.

.. CG-EXPLANATION-END id=function:buildInitialReassignments

``function buildInitialChecked``
--------------------------------

.. CG-BLOCK id=function:buildInitialChecked lines=236-253

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/FormationSelectionDialog.tsx
   :language: tsx
   :lines: 236-253
   :lineno-match:

.. CG-EXPLANATION-START id=function:buildInitialChecked

**What this does.** Returns the set of candidate keys that should start out checked — the candidates whose normalised key matches the stable key of a formation already in the model.

**Why it is here.** It normalises on both sides because a raw lower-casing read a punctuated name such as "paleogeen: formatie van aalter" as different from the server's normalised "paleogeen formatie van aalter", so every punctuated formation silently failed to pre-check and went into Apply looking unselected.

.. CG-EXPLANATION-END id=function:buildInitialChecked

``interface FormationSelectionDialogProps``
-------------------------------------------

.. CG-BLOCK id=interface:FormationSelectionDialogProps lines=254-366

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/FormationSelectionDialog.tsx
   :language: tsx
   :lines: 254-366
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FormationSelectionDialogProps

**What this does.** Declares the dialog's inputs: the open flag, the candidate list, the persisted reassignment snapshot, the collision list, the current formations and contacts, an "updating" flag, and the map-change, confirm and cancel callbacks.

**Why it is here.** The docstrings on the fields record the load-bearing rules: the persisted snapshot keeps every entry (a lumped-away key looks like a stale one, so dropping it destroys a grouping); the confirm callback carries the selected keys AND the same map used for the last preview, and the parent must not re-discover between confirm and apply, because the backend requires both calls to carry the identical map (discover equals apply).

.. CG-EXPLANATION-END id=interface:FormationSelectionDialogProps

``function FormationSelectionDialog``
-------------------------------------

.. CG-BLOCK id=function:FormationSelectionDialog lines=367-925

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/FormationSelectionDialog.tsx
   :language: tsx
   :lines: 367-925
   :lineno-match:

.. CG-EXPLANATION-START id=function:FormationSelectionDialog

**What this does.** The dialog component. It owns the checked-candidate set and the per-row reassignment Map, re-seeding both on the closed-to-open transition; it publishes the current map to the parent through a ref-held callback after each change; it computes live how many formations and contacts a confirm would delete; it builds each row's ranked list of peer candidates; and it renders the candidate list (checkboxes plus the inline reassignment dropdowns), the live collision panel, an at-risk deletion heads-up, and the Cancel and Apply-selection buttons.

**Why it is here.** Re-seeding during render on open — rather than in an effect — is React's documented "adjust state when a prop changes" pattern. The dialog is mounted for the whole session and only flips open later, so the one-time lazy initialisers ran at toolbar mount when the candidate list was still empty; the dialog opened blank and Apply carried that blankness to the server (the 2026-08-03 bug). The parent callback goes through a ref and fires only while open, so an unrelated re-render cannot re-publish the empty map. Confirm sends EFFECTIVE keys — a candidate reassignment swaps the source key for the target key, and a custom one omits the source — so the backend does not keep a source formation it should delete. The deletion panel is amber, not red, because nothing is destroyed by reaching it: Apply asks first, and red is reserved for committed destructive intent.

.. CG-EXPLANATION-END id=function:FormationSelectionDialog

``function RowReassignDropdown``
--------------------------------

.. CG-BLOCK id=function:RowReassignDropdown lines=926-1182

.. literalinclude:: ../../../desktop/src/renderer/src/shell/stages/geology/FormationSelectionDialog.tsx
   :language: tsx
   :lines: 926-1182
   :lineno-match:

.. CG-EXPLANATION-START id=function:RowReassignDropdown

**What this does.** The inline "same as ..." dropdown for one candidate row: a trigger button plus a popup holding a typeahead input and a listbox of options — "Keep separate" first, an optional "use this custom name" entry when the engineer typed something new, then every other candidate ranked by similarity. Typing re-ranks the list but never removes an option; picking one calls back with the chosen target. Both an outside click and the Escape key close it.

**Why it is here.** Ranking re-orders but never filters, so a zero-score synonym the string maths cannot recognise stays hand-pickable. Each option carries its unique key so two candidates with the same display name stay distinguishable and a pick always resolves by key. The popup root itself is the listbox (the WCAG 2.2 AA combobox pattern — there is no intermediate dialog wrapper), and the dropdown's Escape handler stops the event propagating so the surrounding modal's own Escape handler does not also fire.

.. CG-EXPLANATION-END id=function:RowReassignDropdown


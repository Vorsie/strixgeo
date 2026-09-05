desktop.renderer.src.hooks.useLithoSuggestions
==============================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useLithoSuggestions.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useLithoSuggestions.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-57

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useLithoSuggestions.ts
   :language: typescript
   :lines: 1-57
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's opening comment and its imports. It brings in ``useCallback``, ``useEffect`` and some TypeScript setter/ref types from React, the API client, many response and request types, the ghost and edit types, the undo-command type, the logger, the translation helper, and a family of small utilities that build request bodies and that merge, split, insert and absorb litho layers.

**Why it is here.** This hook owns the whole litho-suggestion lifecycle — proposing, accepting, rejecting, editing, and reshaping *ghosts*, which are the coloured, not-yet-committed suggestion bands the segmenter draws on a section. It was pulled out of the oversized ``useGeologicalModel`` hook (debt #201). The comment records the dependency-array convention: stable state setters and stable callbacks are left out of the trigger lists, and each handler carries its trigger list verbatim from the original, including any ``eslint-disable`` lines with their ``// reason:`` notes — each such note explains a case where the automatic linter is wrong because a value is stable by construction or must be read fresh.

.. CG-EXPLANATION-END id=module-header

``interface UseLithoSuggestionsParams``
---------------------------------------

.. CG-BLOCK id=interface:UseLithoSuggestionsParams lines=58-92

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useLithoSuggestions.ts
   :language: typescript
   :lines: 58-92
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseLithoSuggestionsParams

**What this does.** Lists everything the handlers need: the project, the active litho model (and a stable ref to it), the litho contacts and formations, several bookkeeping helpers (record imports, push undo, mark changed, request refetches, request a body recompute), the toast, the setters for the ghost overlay and related flags, and the current ghost state itself.

**Why it is here.** The same shared-state-from-the-parent pattern as the other extracted clusters (the ``desktop.renderer.src.hooks.useContactCrud`` page): the parent owns the state and passes it in, and this hook owns only the lifecycle handlers. ``requestBodyRecompute`` is optional so hand-rolled test fixtures need not supply it — call sites guard the call — which connects this hook to the debounced recompute on the ``desktop.renderer.src.hooks.useBodyRecompute`` page.

.. CG-EXPLANATION-END id=interface:UseLithoSuggestionsParams

``interface UseLithoSuggestionsResult``
---------------------------------------

.. CG-BLOCK id=interface:UseLithoSuggestionsResult lines=93-167

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useLithoSuggestions.ts
   :language: typescript
   :lines: 93-167
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseLithoSuggestionsResult

**What this does.** Lists the many handlers returned: suggest litho for one anchor or all anchors, accept one / all / bulk suggestions, reject and un-reject, edit, insert / split / merge / absorb a ghost layer, create a manual ghost, extend a ghost to the nearest contacts, strip or reseed admixtures, auto-correlate, clear suggestions, and push an accept onto the undo stack — plus a lookup for the effective suggestion at an index.

**Why it is here.** Naming the full set gives the section editor one object of suggestion actions. Most return a Promise because they call the engine; the accept handlers return the engine's response so the caller can update the section — every write goes through the API (CLAUDE.md).

.. CG-EXPLANATION-END id=interface:UseLithoSuggestionsResult

``type AcceptLithoUndoOp``
--------------------------

.. CG-BLOCK id=type:AcceptLithoUndoOp lines=168-178

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useLithoSuggestions.ts
   :language: typescript
   :lines: 168-178
   :lineno-match:

.. CG-EXPLANATION-START id=type:AcceptLithoUndoOp

**What this does.** The record captured for one accept so it can be undone and redone: the request body sent, the ids of the contacts and formations the accept created, and which ghost entries were accepted.

**Why it is here.** Undo of an accept must be able to delete exactly the rows the accept created and restore the ghosts, so all of that is captured at accept time — the reversibility the whole editor depends on (docs/ux.md).

.. CG-EXPLANATION-END id=type:AcceptLithoUndoOp

``type AcceptedGhostMark``
--------------------------

.. CG-BLOCK id=type:AcceptedGhostMark lines=179-203

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useLithoSuggestions.ts
   :language: typescript
   :lines: 179-203
   :lineno-match:

.. CG-EXPLANATION-START id=type:AcceptedGhostMark

**What this does.** Marks that one accept applied to a set of indices on one anchor, optionally carrying the contact ids created per index.

**Why it is here.** The docstring records that the per-index contact ids are set only on the single-layer accept paths, where every returned contact id belongs to the one accepted suggestion — that mapping is what later lets a drag find the committed contact by identity (the resolver on the ``desktop.renderer.src.hooks.useBoundaryDrag`` page).

.. CG-EXPLANATION-END id=type:AcceptedGhostMark

``function applyEditToSuggestion``
----------------------------------

.. CG-BLOCK id=function:applyEditToSuggestion lines=204-241

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useLithoSuggestions.ts
   :language: typescript
   :lines: 204-241
   :lineno-match:

.. CG-EXPLANATION-START id=function:applyEditToSuggestion

**What this does.** A pure helper that overlays a user's pending edit onto a raw suggestion layer — replacing the depths, lithology and admixtures where the edit supplies them — and returns the raw layer unchanged when there is no edit.

**Why it is here.** The docstring records that this merge is shared by the single-anchor effective lookup and both bulk accept paths, so the depth-and-composition overlay is computed one way everywhere. The raw admixture tokens are carried through as-is; they are translated only when displayed (Data Integrity Rule 2).

.. CG-EXPLANATION-END id=function:applyEditToSuggestion

``function useLithoSuggestions``
--------------------------------

.. CG-BLOCK id=function:useLithoSuggestions lines=242-1756

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useLithoSuggestions.ts
   :language: typescript
   :lines: 242-1756
   :lineno-match:

.. CG-EXPLANATION-START id=function:useLithoSuggestions

**What this does.** The hook itself — the large body that defines every suggestion handler. In outline: the suggest handlers ask the engine's segmenter for layers and store them as ghosts on the focused anchor; the edit / insert / split / merge / absorb / extend handlers reshape a ghost in the ephemeral overlay without touching the database; the reject and un-reject handlers mark a ghost layer out or back in; and the accept handlers send the ghost (as currently shown) to the engine, which creates the committed layers and contacts, then refetch, mark the project changed, request a body recompute, and push an undo command. The strip / reseed admixture handlers and the auto-correlate and clear handlers round out the set. It returns all of them.

**Why it is here.** Accept commits the ghost verbatim — the shape the user sees is exactly what is written, never merged or re-split at accept time (memory: litho accept is a verbatim copy of the suggestion shape). The reshape handlers work only on the ephemeral ghost overlay because a ghost is a proposal, not yet part of the saved model; nothing reaches the database until accept, and every write then goes through the API (CLAUDE.md). Every accept pushes an undo command so the action is reversible (docs/ux.md), and requests a recompute of body identity so the bodies follow the new layers (the ``desktop.renderer.src.hooks.useBodyRecompute`` page). The several ``eslint-disable react-hooks/exhaustive-deps`` sites each carry a ``// reason:`` note explaining why the linter is wrong there — for example, the manual-ghost handler lists only the formations array because it must read the latest formation list to resolve a soil code, while the stable setters it also uses would only churn the callback's identity if listed.

.. CG-EXPLANATION-END id=function:useLithoSuggestions


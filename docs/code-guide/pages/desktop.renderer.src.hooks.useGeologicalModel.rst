desktop.renderer.src.hooks.useGeologicalModel
=============================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useGeologicalModel.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useGeologicalModel.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-68

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useGeologicalModel.ts
   :language: typescript
   :lines: 1-68
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The comment and the imports (five React hooks, the API client and many response types, the several sub-hooks this hook composes, and a set of utilities). This hook owns the active geological model — its formations, contacts, and cached TIN surfaces (a TIN is a surface built from triangles) — and every contact-mutating handler.

**Why it is here.** The mutation logic is co-located with the state it updates. Two design notes are recorded: a forward-reference hazard that forced a workaround in the App component is unnecessary here because both functions live in the same module scope and can call each other directly; and the surfaces auto-refetch, where an *effect* watching the contacts' identity re-fetches the surfaces after every mutation, skipping the very first observation because bootstrap already fetched them in parallel. A comment also notes that formation name and colour are now decided server-side, so the old colour tables were removed.

.. CG-EXPLANATION-END id=module-header

``type ContactCopyPayload``
---------------------------

.. CG-BLOCK id=type:ContactCopyPayload lines=69-71

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useGeologicalModel.ts
   :language: typescript
   :lines: 69-71
   :lineno-match:

.. CG-EXPLANATION-START id=type:ContactCopyPayload

**What this does.** The payload type for the batch-copy contacts handler, re-used from the contacts layer component.

**Why it is here.** Sharing the one type keeps the hook and the component that sends the payload in agreement on its shape.

.. CG-EXPLANATION-END id=type:ContactCopyPayload

``interface FormationCandidate``
--------------------------------

.. CG-BLOCK id=interface:FormationCandidate lines=72-93

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useGeologicalModel.ts
   :language: typescript
   :lines: 72-93
   :lineno-match:

.. CG-EXPLANATION-START id=interface:FormationCandidate

**What this does.** A candidate formation discovered from borehole stratigraphy: a working display name, a stable cross-borehole key, and how many in-scope boreholes carry that key.

**Why it is here.** The key is the stable identity used across boreholes (the formal regional reference when present, otherwise the name), and both the selection dialog and the auto-populate filter are expressed in these keys — so the same candidate found in different boreholes lines up.

.. CG-EXPLANATION-END id=interface:FormationCandidate

``interface LumpingCollision``
------------------------------

.. CG-BLOCK id=interface:LumpingCollision lines=94-115

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useGeologicalModel.ts
   :language: typescript
   :lines: 94-115
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LumpingCollision

**What this does.** A normalised report of a lumping collision: the borehole where it happened, the target key and name, all the raw names that resolved to it, the kept (shallowest) top depth, and how many deeper duplicates were dropped.

**Why it is here.** A collision is when two or more layers in a single borehole resolve to the same formation key after the lumping map is applied; the server keeps the shallowest boundary and drops the rest, and this shape carries that outcome to the interface so the engineer can see it.

.. CG-EXPLANATION-END id=interface:LumpingCollision

``interface LithoSuggestionEdit``
---------------------------------

.. CG-BLOCK id=interface:LithoSuggestionEdit lines=116-151

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useGeologicalModel.ts
   :language: typescript
   :lines: 116-151
   :lineno-match:

.. CG-EXPLANATION-START id=interface:LithoSuggestionEdit

**What this does.** One user edit on a ghost suggestion: partial depth edges and/or composition (lithology and admixtures), plus an internal ``propagate-only`` marker.

**Why it is here.** The fields are partial so the caller sends only the edges or fields it touched. The propagate-only marker fixes the double-absorb bug (2026-05-26): dragging a shared boundary fires the edit twice, and without the flag the second call re-ran the neighbour-absorb scan on the already-updated ghost and absorbed the dragged layer in the wrong direction — the flag confines that scan to the first call. It is never persisted; the accept path strips it.

.. CG-EXPLANATION-END id=interface:LithoSuggestionEdit

``interface BulkAnchorGhost``
-----------------------------

.. CG-BLOCK id=interface:BulkAnchorGhost lines=152-195

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useGeologicalModel.ts
   :language: typescript
   :lines: 152-195
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BulkAnchorGhost

**What this does.** One investigation's ghost-suggestion state inside the bulk-suggest map: the kind, the segmenter's suggested layers, the surface elevation, the accepted and rejected layer indices, the per-layer edits, and an optional map of the contact ids created per accepted suggestion.

**Why it is here.** It collects into one map value what the single-anchor state spreads across several pieces of state (debt #73). The contact-ids map lets the boundary drag resolve the committed contact by identity rather than by a depth-tolerance match, so it survives contact-drift drag sequences; it is populated only by the single-layer accept paths, because associating many returned ids to many suggestion indices would need a backend ordering contract (owner decision pending).

.. CG-EXPLANATION-END id=interface:BulkAnchorGhost

``interface UseGeologicalModelResult``
--------------------------------------

.. CG-BLOCK id=interface:UseGeologicalModelResult lines=196-1047

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useGeologicalModel.ts
   :language: typescript
   :lines: 196-1047
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseGeologicalModelResult

**What this does.** The very large return shape: the active model, its formations, contacts and surfaces, the crossing state, all the create/update/delete and batch handlers, the litho suggestion and accept handlers, the bulk-suggest state, the geotech subdivision and body-recompute handlers, and the results of the composed sub-hooks.

**Why it is here.** Naming the whole surface in one place documents everything the App and the section and geology stages read and call for the interpretation model.

.. CG-EXPLANATION-END id=interface:UseGeologicalModelResult

``function indexSurfacesByFormationId``
---------------------------------------

.. CG-BLOCK id=function:indexSurfacesByFormationId lines=1048-1099

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useGeologicalModel.ts
   :language: typescript
   :lines: 1048-1099
   :lineno-match:

.. CG-EXPLANATION-START id=function:indexSurfacesByFormationId

**What this does.** Builds a lookup from a formation id to its surface. These lines also carry the documentation of the hook below.

**Why it is here.** A fast by-id map so a surface is found directly instead of scanning the whole list on every lookup.

.. CG-EXPLANATION-END id=function:indexSurfacesByFormationId

``function useGeologicalModel``
-------------------------------

.. CG-BLOCK id=function:useGeologicalModel lines=1100-3047

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useGeologicalModel.ts
   :language: typescript
   :lines: 1100-3047
   :lineno-match:

.. CG-EXPLANATION-START id=function:useGeologicalModel

**What this does.** The hook. It takes the project, the toast, the undo-push, the manifest and session-import helpers, and more; keeps the model, formations, contacts and surfaces in *state*; composes the formation-CRUD, contact-CRUD, model-ops, litho-model-ops, litho-suggestions, litho-solids and staleness sub-hooks; runs the surfaces auto-refetch *effect*; and exposes every mutation handler.

**Why it is here.** Because both mutation functions share the module scope, no forward-reference workaround is needed here — unlike in the App component. Several effects suppress the exhaustive-deps lint with a ``// reason:`` comment: values held in refs are always current so listing them would be needless noise, and module-level imports and stable state setters do not belong in a dependency list either (the CLAUDE.md rule that every suppression names why the linter is wrong). Accepting a litho suggestion is a characterisation output whose name and colour the server assigns; the design-ready parameters derived from it stay Phase 5.

.. CG-EXPLANATION-END id=function:useGeologicalModel


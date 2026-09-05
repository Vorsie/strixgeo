desktop.renderer.src.hooks.useBoundaryDrag
==========================================

.. CG-PAGE source=desktop/src/renderer/src/hooks/useBoundaryDrag.ts complete=true

*Source file:* ``desktop/src/renderer/src/hooks/useBoundaryDrag.ts``

.. contents::
   :local:
   :depth: 1

Module header — imports and top-level setup
-------------------------------------------

.. CG-BLOCK id=module-header lines=1-55

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useBoundaryDrag.ts
   :language: typescript
   :lines: 1-55
   :lineno-match:

.. CG-EXPLANATION-START id=module-header

**What this does.** The file's opening documentation, its imports, and the documentation for the tolerance value that follows. It brings in three React hooks — ``useCallback``, ``useEffect`` and ``useState`` (``useState`` remembers a value between redraws) — the types for a contact and a litho-layer suggestion, an edit type, the logger, and a set of helpers that find a layer's visible neighbours above and below and compute a layer's effective depths.

**Why it is here.** The docstring records what this hook owns: the live drag state, the document-wide mouse listeners while a drag is happening, and the single commit that fires when the mouse is released. It was split out of the ``LithoSuggestionGhostColumns`` component verbatim as a pure refactor — behaviour unchanged — so the drag logic has a clean home. The comment names the hook's contract explicitly: its behaviour is pinned by an existing 88-case test suite, which is the real specification.

.. CG-EXPLANATION-END id=module-header

``const CONTACT_MATCH_TOLERANCE_M``
-----------------------------------

.. CG-BLOCK id=const:CONTACT_MATCH_TOLERANCE_M lines=56-70

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useBoundaryDrag.ts
   :language: typescript
   :lines: 56-70
   :lineno-match:

.. CG-EXPLANATION-START id=const:CONTACT_MATCH_TOLERANCE_M

**What this does.** A fixed distance, 0.01 m (one centimetre): how close a committed contact's recorded top depth must be to a boundary depth to count as the same boundary. The block also carries the section divider that introduces the state and start-parameter types below.

**Why it is here.** The docstring explains the exact size. A contact is created at the suggestion's depth, so the two depths should match exactly, but an intermediate edit can nudge the contact before the litho-side drag starts; one centimetre absorbs that typical drift. Tighter would miss a drifted contact; looser would risk matching the wrong contact on a layer thinner than the tolerance.

.. CG-EXPLANATION-END id=const:CONTACT_MATCH_TOLERANCE_M

``interface BoundaryDragState``
-------------------------------

.. CG-BLOCK id=interface:BoundaryDragState lines=71-107

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useBoundaryDrag.ts
   :language: typescript
   :lines: 71-107
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BoundaryDragState

**What this does.** Describes the live drag: which layer and which edge (top or base) is being dragged, where the mouse started, the current dragged depth, the hard clamps on the shallow and deep sides, the lists of layers that would collapse if the drag snaps to either bound, whether it is currently snapped, and the depth the snap is bound to.

**Why it is here.** The docstring records the shape's life cycle — set on mouse-down, updated on every mouse-move, cleared on release after the commit — and one history note: an earlier Shift-drag absorb gesture was removed by owner directive (2026-06-04) so that the plain drag-to-collapse path is the single way to absorb a layer. The clamps exist because a dragged edge physically cannot cross another layer's boundary.

.. CG-EXPLANATION-END id=interface:BoundaryDragState

``interface BoundaryDragStart``
-------------------------------

.. CG-BLOCK id=interface:BoundaryDragStart lines=108-122

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useBoundaryDrag.ts
   :language: typescript
   :lines: 108-122
   :lineno-match:

.. CG-EXPLANATION-START id=interface:BoundaryDragStart

**What this does.** The smaller set of values the caller already has at the moment the mouse goes down on a hit-strip: the layer index, the edge, the starting mouse position and depth, the two bounds, and the two collapse lists.

**Why it is here.** Separating the start inputs from the full live state lets the component pass just the per-mouse-down facts it holds; the hook fills in the rest (current depth, snap flags) itself when it begins the drag.

.. CG-EXPLANATION-END id=interface:BoundaryDragStart

``interface UseBoundaryDragParams``
-----------------------------------

.. CG-BLOCK id=interface:UseBoundaryDragParams lines=123-207

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useBoundaryDrag.ts
   :language: typescript
   :lines: 123-207
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseBoundaryDragParams

**What this does.** Describes everything the hook needs while a drag runs: the pixels-per-metre scale, the live suggestion list, the pending edits map, the accepted and effectively-rejected index sets, and a family of callbacks — commit an edit, reject a layer, merge two layers, update a committed contact's depth, and preview a contact at the live drag depth. It also carries the committed contacts for the focused anchor and a map of contact ids per accepted layer.

**Why it is here.** The docstrings record why several inputs are optional. ``onEdit`` is undefined when the component is read-only, so the hook does nothing then. ``onMergeLayers`` falls back to plain reject for callers that have not opted in. The two contact inputs support a robust fix (dogfeed 2026-05-30): when the id map is present the hook matches the committed contact by IDENTITY rather than by depth, so it still finds the right contact after the user has dragged the contact away from its original depth; without the map it falls back to the one-centimetre depth match. Every write to a committed contact goes through the API, never straight to the database — the frontend always goes through the API (CLAUDE.md).

.. CG-EXPLANATION-END id=interface:UseBoundaryDragParams

``interface UseBoundaryDragReturn``
-----------------------------------

.. CG-BLOCK id=interface:UseBoundaryDragReturn lines=208-225

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useBoundaryDrag.ts
   :language: typescript
   :lines: 208-225
   :lineno-match:

.. CG-EXPLANATION-START id=interface:UseBoundaryDragReturn

**What this does.** The two things the hook hands back: ``drag`` (the current drag state, or null when nothing is being dragged) and ``startDrag`` (the function the hit-strip calls on mouse-down to begin a drag).

**Why it is here.** The component reads ``drag`` to draw the live snap indicator and the depth readout, and calls ``startDrag`` from its hit-strip; naming both makes the split of work between hook and component explicit.

.. CG-EXPLANATION-END id=interface:UseBoundaryDragReturn

``function useBoundaryDrag``
----------------------------

.. CG-BLOCK id=function:useBoundaryDrag lines=226-644

.. literalinclude:: ../../../desktop/src/renderer/src/hooks/useBoundaryDrag.ts
   :language: typescript
   :lines: 226-644
   :lineno-match:

.. CG-EXPLANATION-START id=function:useBoundaryDrag

**What this does.** The hook itself. It keeps one piece of state — the current drag, starting as null — and defines a helper that, given an accepted neighbour and the expected depth, finds the committed contact that owns that boundary (by contact id when the id map is available, otherwise by the one-centimetre depth match). ``startDrag`` logs a diagnostic line and stores the initial drag. The main effect runs only while a drag is active: it attaches mouse-move and mouse-up listeners to the whole document. On each move it converts the cursor's pixel travel into a depth, clamps that depth to the two bounds, decides whether the cursor has overshot a bound far enough to snap, updates the drag state, and — when the drag crosses an accepted neighbour — publishes a live preview so the committed contact follows the cursor. On release it logs the final state, clears the preview, then chooses exactly one commit path: if the layer collapsed onto its own opposite edge it rejects the layer and extends the neighbour to fill the gap; otherwise it commits the depth edit, propagates the shared boundary to the pending partner, resolves any collapse chain by merging or rejecting, and — when the moved boundary was shared with an accepted neighbour — sends the committed contact's depth update to the engine. Finally it clears the drag. When the drag ends the listeners are removed. The hook returns ``drag`` and ``startDrag``.

**Why it is here.** The listeners are attached to the whole document, not to the hit-strip, because the hit-zones are small SVG rectangles and the mouse routinely leaves them mid-drag; attaching to the document keeps the gesture coherent until the button is released. The snap fires only when the cursor has OVERSHOT a bound by more than a small threshold, using the un-clamped cursor depth, so a deliberate “drag past the boundary to merge” gesture registers while an ordinary small resize near the far edge does not accidentally collapse. The zero-thickness auto-reject exists because a layer squashed to no thickness would vanish visually but still sit in the list, where the neighbour walkers would return its far edge as the clamp and lock the next layer's drag — the comment records this exact bug. Several branches predict whether a follow-up merge will already absorb the partner and suppress a second, now-wrong edit (dogfeed 2026-05-26). The committed-contact update is optimistic: the local edit is committed first and the engine update fires in the background, with failures surfaced as a message higher up rather than rolled back here. The diagnostic logs at drag start and drag end stay at the visible ``info`` level on purpose, so any future “drag locked after merge” report can be read straight from the console. The comment above the dependency array explains why each listed value belongs there: the edits map and suggestions array change identity on every commit, so listing them keeps the release handler reading current data, while the callbacks are stable functions from the parent.

.. CG-EXPLANATION-END id=function:useBoundaryDrag


# Unified boundary drag — "drag any contact up/down at any stage"

**Date:** 2026-05-30
**Status:** Design proposal — awaits owner review before implementation
**Scope:** Section editor (litho axis primarily, geological axis follows)
**Estimated effort:** Multi-session. Reasonable target = 3–5 working days end-to-end.

## Problem

Today's section editor splits boundary editing into two disjoint surfaces:

- **`LithoSuggestionGhostColumns`** owns drag for *pending* litho-suggestion
  edges. Local `edits` Map. Commits via `onEdit` → reducer →
  `applyCrossMergeOnDrag` → `setGhostsByAnchor`.
- **`ContactsLayer`** owns drag for *committed* contact edges (the bands
  that exist after accept). Goes through `UpdateFormationContact` →
  HTTP PATCH → repository.

The split creates a workflow constraint that the engineer's mental model
doesn't share. When a pending layer sits adjacent to an accepted layer,
the **CLAUDE.md rule "committed contact is the source of truth, no
propagation past it"** clamps the pending drag at the shared boundary —
visually surfacing as a silent lock. Owner directive 2026-05-30:

> *"I should be able to drag contacts up or down at any stage."*

The pending vs. committed distinction is internal workflow state; the
geometric boundary is the same thing. The UI should let the engineer
move boundaries fluidly, the data layer should figure out which store
(suggestion edits Map vs. `formation_contact` row) takes the write.

## Goal

One drag system. Any boundary on the section view is grab-able with the
same gesture, the same cursor, the same snap behaviour, the same undo
stack — regardless of whether the boundary on either side is pending or
committed. The user never has to know.

## Non-goals

- **Not unifying the rendering layers.** Pending bands (hatched, with
  accept/reject icons) and committed bands (solid, with contact strip)
  keep their distinct visual treatment. The user still needs to see what
  has been accepted vs. what is still a suggestion. Unification is at
  the **drag mechanism + bound computation + commit dispatch** layer,
  not at the visual layer.
- **Not changing the accept gesture.** Double-click / right-click →
  Accept stay as today. They still convert a pending suggestion into a
  committed contact.
- **Not touching the geological-axis drag flow.** That axis works through
  `ContactsLayer` only (no pending suggestions exist there). It already
  has the unified-drag property for committed contacts; this work
  doesn't touch it.
- **Not introducing a new gesture vocabulary.** Same `ns-resize` hit
  strips, same snap, same right-click menus.

## Design

### Architecture — three layers

```
┌────────────────────────────────────────────────────────┐
│   UI: LithoSuggestionGhostColumns + ContactsLayer      │
│   (render only; emit drag events to the coordinator)    │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│   BoundaryDragCoordinator (NEW)                         │
│   - Resolves the boundary identity at a y-coord:        │
│       { kind: 'pending', anchorId, idx, edge } |        │
│       { kind: 'committed', contactId }                  │
│   - Owns the live drag state (currentDepthM, snap)      │
│   - Computes UNIFIED bounds (walk both pending and       │
│     committed neighbours together)                       │
│   - On mouseup, dispatches to the right commit:         │
│       pending → onEdit (existing path)                  │
│       committed → onUpdateContactDepth (existing path)  │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│   Data: edits Map (pending) + UpdateFormationContact    │
│   (no schema change; just two writers, one coordinator) │
└────────────────────────────────────────────────────────┘
```

The coordinator is a hook (`useBoundaryDrag`) that lives at the
`SectionsCanvas` level, where both `lithoGhostState` and `contactsState`
are already in scope.

### Bound computation — unified walker

Today's `computeDragBounds` walks `suggestions[]` for pending neighbours.
The unified walker takes **both** sources:

```ts
function computeUnifiedDragBounds(
  edge: 'top' | 'base',
  startDepthM: number,
  anchorId: string,
  pending: BulkAnchorGhost,
  committed: FormationContactResponse[],  // for this anchor
  accepted: ReadonlySet<number>,
  rejected: ReadonlySet<number>,
): { boundsAboveM: number; boundsBelowM: number; ... }
```

Walks both sets in depth order. The bound returned is the nearest
neighbour in the drag direction, **whether pending or committed**. The
"accepted barrier" rule from CLAUDE.md is retired for litho — replaced
by the natural geometric clamp at the next boundary.

### Commit dispatch

The mouseup handler in the coordinator inspects the dragged boundary's
kind:

- **Pending edge** → call the same `onEdit(idx, {depth_*_m: final})`
  the suggestion drag uses today. `applyCrossMergeOnDrag` reducer
  handles the absorb-on-cross case. No change.
- **Committed contact** → call `api.geology.updateContactDepth(...)`
  with the new depth (same path as `ContactsLayer` uses today). Undo
  stack receives a `pushUndoCommand` with revert/reapply pointing at
  the same endpoint.

### Cross-store drags (the interesting case)

When the drag CROSSES a stage boundary — e.g. user drags a pending
layer's top up past an accepted contact above — both stores get written
in one mouseup:

1. **Pending edge moves to new depth** → `onEdit`.
2. **Accepted contact above's base moves to the same depth** →
   `updateContactDepth`.

The two writes are sequenced: contact PATCH fires first (durable, can
fail), then the pending edit lands (local state, can't fail). On PATCH
failure, the pending edit is skipped and a toast surfaces. This is the
**relaxation of the "committed = source of truth" rule** — committed
contacts become editable from the suggestion-drag surface, with the
contact PATCH acting as the audit point.

## Data integrity

The rule "committed contact is the source of truth" is now scoped to:
*the committed contact is the audit point — writes to it route through
`UpdateFormationContact`, never directly through the suggestion edits
Map.* The pending edits Map never carries a contact depth. The contact
PATCH is the only writer of committed depth.

This preserves the audit trail (every committed depth change is a
backend call, logs land in the GroundModelLogger pipeline) while
removing the user-facing workflow constraint.

## Backwards compat

- `formation_contact` schema unchanged.
- `UpdateFormationContact` use case unchanged.
- `applyCrossMergeOnDrag` reducer unchanged (still operates on pending
  only).
- Existing tests for `LithoSuggestionGhostColumns` keep passing — the
  drag handlers move to the coordinator but the props contract (`onEdit`,
  `acceptedIndices`, etc.) stays.
- Existing `ContactsLayer` drag tests keep passing — same call path.

## Slicing

This lands in slices to keep risk low and review focused:

1. **Slice 1 — extract the drag mechanism.** Move the drag state + listeners
   out of `LithoSuggestionGhostColumns` into a new `useBoundaryDrag` hook
   at `SectionsCanvas` level. No behavioural change. Pure refactor;
   green tests gate the slice.
2. **Slice 2 — unified bound walker.** Replace the existing
   `computeDragBounds` with a walker that consults both pending and
   committed neighbours. Behaviour change: the "accepted barrier" clamp
   is retired. Pending drags that cross into accepted territory get a
   *bounded* drag, not a locked one. Commits still only write to the
   pending edits Map at this slice — the committed contact stays
   untouched. Pending edits sitting on top of committed contact depths
   are visible as the new (and slightly weird) state until Slice 3.
3. **Slice 3 — committed-contact commit dispatch.** When a drag crosses
   into accepted territory, also fire the contact PATCH. Cross-store
   undo command (one entry that reverts both writes).
4. **Slice 4 — clean up.** Retire the "committed = source of truth"
   wording in CLAUDE.md, replace with the audit-point framing. Drop the
   dead `accepted` codepath in `boundFromNeighbour`. Update e2e tests.

Slice 1 alone is a clear refactor win (drag state out of the render
component). Slice 2 is where the user-visible bug fix lands. Slice 3 is
the full delivery of "drag at any stage". Slice 4 is debt cleanup.

## Testing

- **Slice 1**: every existing drag test stays green (refactor-only).
- **Slice 2**: new tests for "pending drag UP across accepted contact"
  reaches the next-non-accepted boundary (not clamped at the accepted's
  near edge); pending drag UP all the way to ground crosses N accepted
  contacts without locking.
- **Slice 3**: PATCH fires when the drag's bound is reached at an
  accepted contact's edge; undo restores both stores; PATCH failure
  rolls back to pre-drag state with a toast.
- **Slice 4**: backwards-compat tests confirm the legacy `accepted` flag
  path is no longer hit.

## Risks

- **Coordinator hook complexity.** It needs to coordinate two stores
  with different consistency models (local Map vs. HTTP). Mitigated by
  the slice-by-slice approach + extensive tests at each slice.
- **Cross-store undo.** One undo command must revert both writes
  atomically (or report the partial-revert clearly). The existing
  `pushUndoCommand` shape supports this (revert is just an async fn);
  the implementation cost is moderate.
- **PATCH failures during drag.** Currently `ContactsLayer` handles
  PATCH failure by rolling back the optimistic local state. Same
  pattern applies; the coordinator must use the same rollback shape.
- **Z-order at shared boundaries.** Today's pending hit-strips overlap
  with committed contact drag strips. The coordinator needs a single
  ordering rule (e.g. always pick the topmost element under cursor;
  resolve to the boundary identity via data attributes). Test coverage
  needed for "click at shared y picks the right one".

## What this work does NOT solve

- The drag still operates on **one boundary at a time**. Multi-boundary
  drag (e.g. shift all formations down by 0.5m) is a separate feature.
- The drag still doesn't surface a tooltip with the engineer's intent
  ("are you trying to merge or just resize?"). Inferred from gesture
  shape — keeps with today's UX.
- Geological axis stays as-is. If we want pending suggestions on the
  geological axis too (future), the coordinator extends naturally; it
  doesn't need a rewrite.

## Decision points needing owner sign-off before implementation

1. **Audit-point framing.** Replacing "committed = source of truth" with
   "committed = audit point" is a CLAUDE.md doc change. Confirm direction.
2. **Cross-store atomicity.** When the drag writes both stores, do we
   accept "PATCH first, local edit second" with the rollback story
   above? Or require true atomicity (transactional)?
3. **Slicing cadence.** Land all four slices in one sustained effort, or
   ship after Slice 2 (the user-visible unlock) and queue 3+4 separately?

## Out of debt

This work supersedes the "accepted barrier" friction documented in
CLAUDE.md and partially addresses the broader litho/contact integration
debt. Once Slice 4 lands, the section editor has a single coherent drag
model, which is a prerequisite for the planned Geotech stage's
edge-editing UI.

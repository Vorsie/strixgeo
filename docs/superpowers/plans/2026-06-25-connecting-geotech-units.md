# Connecting geotech units (packing correlation) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect NAD packing sub-bands across tests into true geotech bodies — auto on matching packing sequence, manually adjustable via the litho correlate gesture — within each litho body, feeding the resolver → `body_id` → the section render and the future Parameters stage.

**Architecture:** Reuse the litho correlation machinery on the geotech axis. The geotech `litho_contact_correlation_edge` rows are the source of truth; auto-population (`SubdivideAllBodies`) becomes packing-sequence-match within each litho body; the section render reads the resolver's geotech `body_id`; a manual "Correlate packing" mode reuses the litho correlate state machine.

**Tech Stack:** Python 3.11 / async SQLAlchemy / pytest (backend); React + TypeScript + Vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-06-25-connecting-geotech-units-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/groundmodel/application/subdivide_all_bodies.py` | geotech materialise + auto edges | rewrite `_derive_geotech_edges_from_litho` to full-stack sequence match |
| `tests/unit/...` (new) | auto-rule unit tests | extract the pure matching helper + test it |
| `desktop/src/renderer/src/utils/geotechSubdivide.ts` | section subdivision/connection | drive sub-band connection by geotech `body_id`, not local sequence-match |
| `desktop/src/renderer/src/utils/geotechSubdivide.test.ts` | render-connection tests | add body_id-driven connection cases |
| `desktop/src/renderer/src/shell/stages/sections/SectionsCanvas.tsx` | geotech axis wiring | feed geotech contact edges + correlate-packing mode + body_id to the subdivision |
| `desktop/src/renderer/src/shell/stages/geotechnical/GeotechnicalCanvas.tsx` / toolbar | "Correlate packing" verb | add the verb + re-subdivide confirm prompt |

---

## Phase A — Backend: packing-sequence auto rule

The auto edge derivation must change from "map each litho edge to ONE sub-band, emit if same class" to "for each correlated litho-unit pair across adjacent tests, compare the FULL packing sub-band stacks; if the NAD-class sequences are identical, emit 1:1 edges." A litho edge already identifies a correlated litho-unit pair on adjacent tests within a body, so it stays the enumeration; only the emission changes.

### Task A1: extract + test the pure sequence-match helper

**Files:**
- Create: `src/groundmodel/domain/services/geotech_packing_edges.py`
- Test: `tests/unit/domain/services/test_geotech_packing_edges.py`

- [ ] **Step 1: Write the failing test**

```python
from groundmodel.domain.services.geotech_packing_edges import aligned_same_sequence_pairs


def test_identical_sequence_pairs_one_to_one():
    """Identical NAD-class sequences → aligned index pairs for every band."""
    left = [("LA0", 6), ("LA1", 7)]   # (layer_id, nad_class) top→base
    right = [("RB0", 6), ("RB1", 7)]
    assert aligned_same_sequence_pairs(left, right) == [("LA0", "RB0"), ("LA1", "RB1")]


def test_mismatched_count_no_pairs():
    """Different band counts → no pairs (manual fills it)."""
    left = [("LA0", 6), ("LA1", 7)]
    right = [("RB0", 6), ("RB1", 7), ("RB2", 8)]
    assert aligned_same_sequence_pairs(left, right) == []


def test_same_count_different_class_no_pairs():
    """Same count but a class differs → not an identical sequence → no pairs."""
    left = [("LA0", 6), ("LA1", 7)]
    right = [("RB0", 6), ("RB1", 8)]
    assert aligned_same_sequence_pairs(left, right) == []


def test_empty_either_side_no_pairs():
    assert aligned_same_sequence_pairs([], [("RB0", 6)]) == []
    assert aligned_same_sequence_pairs([("LA0", 6)], []) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/domain/services/test_geotech_packing_edges.py -q`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```python
"""Pure helper: pair geotech sub-bands across two tests by identical packing sequence.

Used by the geotech auto-correlation (``SubdivideAllBodies``): within one litho
body, two adjacent tests' packing sub-band stacks are connected 1:1 ONLY when
their NAD-class sequences are identical (same count, same order). Any mismatch
yields no pairs — the engineer connects those manually. See spec §4.
"""

from __future__ import annotations


def aligned_same_sequence_pairs(
    left: list[tuple[str, int]],
    right: list[tuple[str, int]],
) -> list[tuple[str, str]]:
    """Return aligned (left_layer_id, right_layer_id) pairs iff the sequences match.

    Parameters
    ----------
    left, right : list[tuple[str, int]]
        Each test's sub-band stack as ``(layer_id, nad_class)`` ordered top→base,
        for ONE litho unit on that test.

    Returns
    -------
    list[tuple[str, str]]
        One pair per band when the two NAD-class sequences are identical;
        ``[]`` on any length or class mismatch (and when either side is empty).
    """
    if not left or not right or len(left) != len(right):
        return []
    if [c for _id, c in left] != [c for _id, c in right]:
        return []
    return [(la, rb) for (la, _lc), (rb, _rc) in zip(left, right)]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/domain/services/test_geotech_packing_edges.py -q`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/domain/services/geotech_packing_edges.py tests/unit/domain/services/test_geotech_packing_edges.py
git commit -m "feat(geotech): pure helper for packing-sequence edge pairing"
```

### Task A2: rewire `_derive_geotech_edges_from_litho` to full-stack matching

**Files:**
- Modify: `src/groundmodel/application/subdivide_all_bodies.py` (`_derive_geotech_edges_from_litho`, ~line 1014)

**Read first:** the current method (1014–1140) and `geotech_layer_by_inv_depth` (`inv_id → [(top, base, layer_id, formation_id)]`) + `litho_layer_depths` (`litho_layer_id → (inv_str, top, base)`).

- [ ] **Step 1: Change the per-edge emission**

For each approved litho edge `(litho_a_id, litho_b_id)`:
1. Resolve each endpoint's `(inv, top, base)` from `litho_layer_depths` (unchanged).
2. Instead of `_find_geotech_layer_at_depth` (one sub-band at `top`), collect the FULL sub-band stack of that litho unit on each test: the entries in `geotech_layer_by_inv_depth[inv]` whose `[top, base)` falls within `[litho_top, litho_base)` (±1 mm), ordered by `top`, as `(layer_id, nad_class)`. Map `formation_id → nad_class` from a small dict you build once from the geotech formations (or carry nad_class in `geotech_layer_by_inv_depth` — extend the tuple to include it).
3. Call `aligned_same_sequence_pairs(left_stack, right_stack)`; for each returned `(la, rb)` insert a geotech edge (canonical `min/max`, dedup per section). Same-class is guaranteed by the identical-sequence precondition, so the old `skipped_cross_formation` guard is subsumed.

Concretely, replace the single-sub-band lookup block with a stack collector + the helper call:

```python
from groundmodel.domain.services.geotech_packing_edges import aligned_same_sequence_pairs

def _stack(inv_str: str, lit_top: float, lit_base: float) -> list[tuple[str, int]]:
    """Geotech sub-band stack (layer_id, nad_class) within a litho unit on a test."""
    out = []
    for top, base, layer_id, _fid, nad in sorted_geotech.get(inv_str, []):
        if top >= lit_top - _DEPTH_TOL_M and base <= lit_base + _DEPTH_TOL_M:
            out.append((str(layer_id), nad))
    return out
```

(Extend `geotech_layer_by_inv_depth` tuples to `(top, base, layer_id, formation_id, nad_class)` at the two append sites ~587/627 + the type hints, so `_stack` has the class without a second lookup.) Then:

```python
left_stack = _stack(inv_a_str, top_a, _base_a)
right_stack = _stack(inv_b_str, top_b, _base_b)
for la, rb in aligned_same_sequence_pairs(left_stack, right_stack):
    a, b = (UUID(la), UUID(rb)) if la < rb else (UUID(rb), UUID(la))
    if (a, b) in seen_layer_pairs:
        continue
    seen_layer_pairs.add((a, b))
    self._session.add(LithoContactCorrelationEdgeOrm(
        model_id=geotech_model_id, section_id=section_id,
        contact_a_id=a, contact_b_id=b, user_approved=True,
    ))
    edge_count += 1
```

(Match the exact ORM field names the current method uses — read the existing `session.add(...)` in this method.)

- [ ] **Step 2: Update the integration eval + run it**

Run: `uv run python scripts/eval_geotech_subdivision.py 2>&1 | grep -iE "COMMITTED|errored"`
Expected: COMMITTED, 0 errored. Then DB-verify a known body: a litho sand body whose two adjacent tests share a packing sequence now has geotech edges across every aligned sub-band (query `litho_contact_correlation_edge` for the geotech model id).

- [ ] **Step 3: Commit**

```bash
git add src/groundmodel/application/subdivide_all_bodies.py
git commit -m "feat(geotech): auto-correlate packing by full-sequence match within a litho body"
```

---

## Phase B — Render: connect sub-bands by geotech `body_id`

### Task B1: drive `subdivideRegionsByGeotech` connections by body_id

**Files:**
- Modify: `desktop/src/renderer/src/utils/geotechSubdivide.ts`
- Modify: `desktop/src/renderer/src/utils/geotechSubdivide.test.ts`
- Modify: `desktop/src/renderer/src/shell/stages/sections/SectionsCanvas.tsx` (pass `bodyId` per sub-layer)

**Read first:** `geotechSubdivide.ts` — today `sequencesMatch` decides whether a litho region splits into connected sub-quads vs keep-whole. Change the connection test from sequence equality to **shared geotech `body_id`**.

- [ ] **Step 1: Write the failing test**

Extend `GeotechSubLayer` with `bodyId: string | null`. Add:

```typescript
it('connects adjacent sub-bands that share a geotech body_id', () => {
  // two columns, one litho band, each split into the same two NAD classes,
  // top bands share body 'B-top', base bands share 'B-base' → two sub-quads.
  // (build via the test harness used by the existing GS cases)
  // assert: two output regions, each spanning both columns (connected).
})

it('keeps sub-bands separate when body_ids differ', () => {
  // same geometry but the top bands have different body_ids → not connected:
  // the region is recoloured to the dominant NAD (kept whole), not split into
  // a cross-column sub-quad.
})
```

(Mirror the existing `sub(top, base, formationId, srcLitho)` helper; add a `bodyId` arg.)

- [ ] **Step 2: Run → FAIL** (`bodyId` unknown / connection still by sequence).

- [ ] **Step 3: Implement**

In `subdivideRegionsByGeotech`, replace the `sequencesMatch` gate: two columns' sub-band stacks produce connected sub-quads when, position-for-position, the paired sub-bands **share a `bodyId`** (and same formation, as today). Where a position's `bodyId` differs (or is null on one side), that band does not connect — fall through to the dominant-NAD whole-region recolour (unchanged). Keep the soil-match filter and the quad-only guard.

- [ ] **Step 4: Run → PASS.** Then `npx tsc --noEmit -p tsconfig.web.json`.

- [ ] **Step 5: Wire `bodyId` in SectionsCanvas** — in the `geotechSubLayersByInv` memo (~line 294), set `bodyId` from each geotech layer's `body_id` (add it to the source map alongside `sourceLithoFormationId`).

- [ ] **Step 6: Commit**

```bash
git add desktop/src/renderer/src/utils/geotechSubdivide.ts desktop/src/renderer/src/utils/geotechSubdivide.test.ts desktop/src/renderer/src/shell/stages/sections/SectionsCanvas.tsx
git commit -m "feat(geotech): render packing connections from resolver body_id"
```

---

## Phase C — Re-subdivide confirm prompt

### Task C1: warn before a re-subdivide clears connections

**Files:**
- Modify: the geotech "Subdivide all bodies" handler (find via `grep -rn "subdivideAllBodies\|Subdivide all bodies" desktop/src/renderer/src`)

- [ ] **Step 1:** Before calling the subdivide endpoint, if geotech correlation edges already exist for the active geotech model (the handler already has access to `geotechLayers`/edges; if not, check `geotechContacts.length > 0` as the "already subdivided" proxy), open a confirmation dialog: title "Re-subdivide geotech model?", body "Re-subdividing regenerates all geotech packing connections — any manual connections you made will be cleared.", default-focus **Cancel**, confirm button "Re-subdivide" (action-named, per the irreversible-action UX rule). The first-ever subdivide (no existing connections) skips the prompt.

- [ ] **Step 2:** On confirm, proceed with the existing subdivide call (which already wipes + regenerates edges server-side). On cancel, no-op.

- [ ] **Step 3:** Vitest: prompt shown when connections exist, skipped when none; confirm calls the endpoint, cancel does not.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(geotech): confirm before re-subdivide clears packing connections"
```

---

## Phase D — Manual "Correlate packing" gesture

Reuse the litho correlate machinery on the geotech axis. **Read first:** `SectionsCanvas.tsx` `correlateMode` / `contactCorrelationEdges` / `contactEdges` prop / `onRequestAcceptEdge` (lines ~159, 446, 468, 2263, 2285) and the contact-correlation API client (`api/clients/geology.ts`, `…/contact-correlations/*`).

### Task D1: a "Correlate packing" verb on the geotech axis

**Files:**
- Modify: the geotech toolbar (sibling of the litho Correlate verb) + `SectionsCanvas.tsx`

- [ ] **Step 1:** Add a "Correlate packing" toggle to the geotech-axis toolbar that drives the existing `correlateMode` state (it already gates the contact-correlation gesture; geotech currently passes `contactEdges` when `isGeotech`). Enable the gesture on the geotech axis (today the connect handlers are litho-only — extend the `isLitho ? … : undefined` guards at the gesture-handler props to `(isLitho || isGeotech)` for the geotech model, mirroring how `contactEdges` is already shared).

- [ ] **Step 2:** The connect handler, on the geotech axis, targets the geotech sub-band layers. Add the guard: a connect is accepted only when the two bands are **same NAD class** and **same litho body** (resolve via the geotech formation's `nad_class` + the sub-band's parent litho `body_id`, both already available in `geotechFormations`/`geotechLayers`); otherwise no-op with a transient hint "packing connects the same class within one litho unit."

- [ ] **Step 3:** Right-click a geotech connection → Disconnect (reuse the litho `onRequestDeleteEdge` path, enabled for `isGeotech`).

- [ ] **Step 4:** After connect/disconnect, refetch geotech edges + re-run the resolver path (the same refetch nonce the litho correlate uses) so `body_id` + the render update.

- [ ] **Step 5: Tests** (Vitest): correlate-packing mode emits an edge for a same-class/same-body pair; rejects a cross-class tie; rejects a cross-body tie; right-click disconnects. `npx tsc --noEmit -p tsconfig.web.json` clean.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(geotech): manual Correlate-packing gesture (same class, within litho body)"
```

---

## Final verification

- [ ] `uv run pytest tests/unit -q` + `cd desktop && npx vitest run` + `npx tsc --noEmit -p tsconfig.web.json` all green.
- [ ] Re-materialise the dev DB (`uv run python scripts/eval_geotech_subdivision.py`) and dogfeed (meta-rule): on `test.strix`, a litho sand body whose adjacent tests share a packing sequence renders one connected band per class; a mismatched pair renders per-test until a manual same-class tie joins them; right-click disconnects; a re-subdivide prompts before clearing.
- [ ] `uv run ruff check src tests` clean.

## Notes / out of scope (from the spec)
- The Parameters stage (per-body statistics) — this only lays the connected-body foundation.
- Cross-litho-body connections; LCS/nearest-class auto-matching — excluded.
- No change to litho correlation, the litho partition, or the NAD classifier.

# Bottom-tie Substrate Band — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fill the 2D `computeSectionFill` partition below shallow tests down to the bottom-tie line, by extending bands across their full correlated multi-test span and following bottom-ties to the next deeper test (with onlap where only one side correlates). The 3D voxel model inherits the fix (same partition).

**Architecture:** A `computeSectionFill` POST-PASS (isolated; never mutates the existing per-gap fill). Compute the bottom-tie line (lower envelope of base-tie segments) + the substrate formation per column, then per gap add substrate region(s) filling from the existing fill's lower boundary down to the tie line — banding where both gap columns reach the substrate via the bottom-tie, onlapping where only one does. Post-pass chosen over injecting virtual units because the latter entangles with `reduceColumn`/`matchColumns`/the floor walk (repeatedly broke this session); a post-pass only ADDS regions and is verifiable by the gate.

**Tech Stack:** TypeScript, Vitest. Pure helpers in `partitionFill.ts`.

**Acceptance gate (hard):** `desktop/src/renderer/src/utils/partitionFill.cs1void.test.ts` (run `uv run python scripts/throwaway_cs1_partition_extract.py` then `CS1_GATE=1 npx vitest run …partitionFill.cs1void.test.ts`). Currently RED: 22 CS1 gaps void to −13.37. Target: **0 voids, 0 overlaps.** Plus `partitionFill.test.ts` green and `partitionFill.goldens.test.ts` (regenerate freely — the Python `section_partition.py` port is dead, zero live imports).

**Reference data (real CS1, from the extractor):** base-base ties include non-adjacent spans `col23(−13.37)↔col19(−9.96)` (span 4) and `col19↔col14` (span 5); the shallow cols 20/21/22 and 15/16/17/18 sit inside those spans and must fill to the interpolated tie line.

---

### Task 1: Bottom-tie line (lower envelope) pure helper

**Files:**
- Modify: `desktop/src/renderer/src/utils/partitionFill.ts` (new exported `computeBottomTieLine`)
- Test: `desktop/src/renderer/src/utils/partitionFill.test.ts`

A base-tie edge is a segment from `(colA, baseElevA)` to `(colB, baseElevB)`. The tie line at column `k` = the DEEPEST (min elevation) interpolated value over all segments covering `k`; the substrate formation/body at `k` = from the segment that produced that min. Open-ended ties (a base-tie endpoint whose unit is its column's deepest AND the tie has no deeper continuation on one side) extend FLAT past their last column to the section edge.

- [ ] **Step 1: Write failing test** for `computeBottomTieLine(columns, baseTieSegments)` returning `{ tieElev: (number|null)[], formationId: (string|null)[], bodyId: (string|null)[] }`. Cases: (a) single adjacent tie → both columns at their base elevs; (b) a span-2 tie → the middle column interpolated; (c) two overlapping segments → lower envelope picks the deeper; (d) a column outside all segments → null; (e) open-ended → flat extension.
- [ ] **Step 2: Run, see RED.**
- [ ] **Step 3: Implement** the helper (a `baseTieSegments` builder from the base-tie layer-id pairs + the per-column lower-envelope scan).
- [ ] **Step 4: Run, see GREEN.**
- [ ] **Step 5: Commit** (`feat(partition): bottom-tie line lower-envelope helper`).

### Task 2: Per-gap substrate region builder pure helper

**Files:**
- Modify: `desktop/src/renderer/src/utils/partitionFill.ts` (new `buildSubstrateRegions`)
- Test: `desktop/src/renderer/src/utils/partitionFill.test.ts`

Given a gap's existing regions + the two columns' tie elevations + the substrate formation, emit substrate region(s) from the gap's existing lower boundary down to the tie line. The existing lower boundary at fraction f = the deepest covered elevation among the gap's non-lens regions (sample at the union of region x-breakpoints). Classify: BOTH columns reach the substrate (both `tieElev` non-null and the bottom-tie connects across) → full BAND quad; only ONE side → ONLAP (taper to the unanchored side, meeting the existing fill); NEITHER → nothing.

- [ ] **Step 1: Write failing test** — a deep+shallow gap where the substrate must band flat to the tie line (no void below the existing fill); a one-sided case producing an onlap (`kind:'lens'`, `overlayTier:'onlap'`); assert no gap and no overlap via a point-coverage helper down to the tie line.
- [ ] **Step 2: Run, see RED.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, see GREEN.**
- [ ] **Step 5: Commit** (`feat(partition): per-gap substrate region builder`).

### Task 3: Wire the post-pass into computeSectionFill

**Files:**
- Modify: `desktop/src/renderer/src/utils/partitionFill.ts` (`computeSectionFill`: capture base-tie pairs; after the gap loop, run the substrate post-pass per gap; tag regions with `gapIndex`)
- Test: the CS1 gate + `partitionFill.test.ts`

- [ ] **Step 1:** Capture base-tie layer-id pairs while building `baseTiedSet` (store `[a,b]`).
- [ ] **Step 2:** After the gap loop, build segments via Task 1's helper, then per gap call Task 2's builder and push the substrate regions (with `gapIndex`).
- [ ] **Step 3:** Decide the flat-tail fix (`51ea227c`): keep as a fast path or remove if the post-pass subsumes it. Whichever keeps the gate green with no overlaps.
- [ ] **Step 4:** Run the CS1 gate (`CS1_GATE=1`). Iterate until **0 voids, 0 overlaps**. Run `partitionFill.test.ts`.
- [ ] **Step 5: Commit** (`fix(partition): substrate band fill below shallow tests via bottom-ties`).

### Task 4: Regenerate goldens + final verification

**Files:**
- `tests/unit/fixtures/partition_goldens/*.json` (regenerate)
- Modify: `partitionFill.goldens.test.ts` / `tests/unit/domain/test_section_partition_goldens.py` (the Python port is dead — update or mark the parity test obsolete rather than re-port)

- [ ] **Step 1:** Run goldens; if any scenario shifted, regenerate with `UPDATE_GOLDENS=1` and confirm the Python parity test (delete/mark obsolete — dead port).
- [ ] **Step 2:** Full `partitionFill.test.ts` + goldens green; CS1 gate 0/0.
- [ ] **Step 3:** Re-arm the dormant gate note; update the bottom-tie plan + memory with the resolution.
- [ ] **Step 4: Commit** docs.

---

## Self-review notes
- The onlap-on-bottom-tie case (Task 2) is the subtlest — pin it with a real-data-shaped fixture, not just a toy.
- GAP-19 (single-formation over-match) is OUT of scope here; it stays tracked separately.
- The gate is the source of truth — synthetic `assertTiles` never reproduced these voids, so every task ends by confirming the CS1 gate moves the right direction.

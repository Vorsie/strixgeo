# Geotech "Correlate packing" gesture + band/onlap/lens render — Plan

**Date:** 2026-06-25 (evening, after the orphaned-backend incident)
**Status:** scoping — awaiting owner approval before implementation
**Builds on:** the shipped Connecting-geotech-units work (auto packing-sequence
correlation + the manual-gesture *handlers* from Phase D) and the litho
correlation machinery (`CorrelationEdgesOverlay`, `computeSectionFill`).

## Problem

On the geotech axis, clicking the **"Correlate packing"** toolbar verb enters
correlate mode but the bands aren't clickable — you get the canvas pan cursor and
nothing ties. Root cause: in correlate mode the band fill turns its own
pointer-events **off** to defer clicks to a dedicated hit-target overlay
(`CorrelationEdgesOverlay`), and that overlay is mounted **`axisMode ===
'lithostratigraphic'` only** (`SectionPanel.tsx:3104`). On the geotech axis it
isn't mounted, so clicks fall through to the pan handler.

The Phase-D *handlers* (`handleCreateGeotechPackingCorrelation` with the
same-class/same-litho-body guard, the delete handler) already exist — only the
**click surface** and a **geotech-edge ribbon source** are missing.

## Owner direction (2026-06-25)

- **Full parity with the litho correlate UX**: reuse `CorrelationEdgesOverlay`
  wholesale — connection **ribbons** between tied bands, click-band-then-neighbour
  to tie, **right-click-a-ribbon to disconnect**. Suppress the litho-only extras
  (body chips, lens diamonds, pinch-out markers) on the geotech axis.
- **Edge-to-edge correlations** (contact-to-contact, same as litho), **so we can
  reuse `computeSectionFill`'s band/onlap/lens logic** for the geotech sub-bands —
  i.e. a packing sub-band should be able to form a **band / onlap / lens**, not
  just merge-or-not.

## The two pieces (phased — Phase 1 unblocks dogfeeding, Phase 2 is the render upgrade)

### Phase 1 — make the gesture clickable (the pan-hand fix)

Mount the existing hit-target overlay on the geotech axis with **geotech**
contacts + a **separate** geotech-edge list, *without* disturbing the litho-framed
partition (the `7329738b` fix — reusing one edge list for both is exactly what
caused tonight's lens regression).

1. **New state `geotechPackingEdges`** in `SectionsCanvas.tsx` — fetched from the
   **geotech** model (`api.geology.listContactCorrelations(project, geotechModelId,
   selectedSectionId)`), kept entirely separate from `contactCorrelationEdges`
   (which stays LITHO on the geotech axis and frames the partition). Refetched on:
   section change, after a connect/disconnect, after Subdivide (reuse the existing
   `correlationEdgesRefetchNonce`/`requestGeotechLayersRefetch` triggers).
2. **Mount `CorrelationEdgesOverlay`** in `SectionPanel.tsx`: change the gate
   `axisMode === 'lithostratigraphic'` → `(=== 'lithostratigraphic' || ===
   'geotechnical')`. On the geotech axis pass:
   - `contacts={geotechContacts}` (the NAD sub-band boundaries — already in scope).
   - `contactEdges={geotechPackingEdges}` (geotech ribbons + right-click targets).
   - `contactGestureState` — already routes to the geotech handlers when
     `isGeotech` (Phase D).
   - `formations={geotechFormations}` (NAD colours for the ribbons).
   - **Suppress litho-only props on geotech**: pass `crossingPinchOuts={[]}`,
     `onInspectLensBody={undefined}`, `onPropagateAdmixtures={undefined}` (or gate
     those features inside the overlay on a new `axisMode`/`minimal` prop) so the
     geotech axis shows only ribbons + gesture, no body chips / lens diamonds.
3. **Right-click-disconnect**: `onRequestDeleteEdge` already routes to the geotech
   delete handler when `isGeotech` (Phase D) — it now has a surface to fire from.
4. **Verify the guard hints** surface (same-class / same-litho-body rejection
   toasts from `canConnectPacking`).

**Phase-1 acceptance:** on the geotech axis in Correlate-packing mode you can
click a NAD band then a same-class band on a neighbour in the same litho body →
a ribbon appears + the bands connect (body_id render, Phase B); a cross-class or
cross-body click is rejected with a hint; right-click a ribbon disconnects; the
**litho partition stays fully connected** (no lens regression — explicit check).

### ★ DECISION LOCKED (owner, 2026-06-25 evening, post-dogfeed)

The geotech packing correlation should behave **exactly like litho**: free contact
ties → `computeSectionFill` band/onlap/lens → a pinch is a lens. Therefore:

- **DROP the same-NAD-class restriction** in `canConnectPacking`. You may tie across
  packing classes (e.g. correlate a dense/less-dense boundary) — the geometry
  (band/onlap/lens) expresses the result, not a guard.
- **KEEP "within the same litho body" as the only guard.** That is what stops the
  187-singleton sprawl (loose-sand-to-dense-sand across the whole model); the litho
  partition already frames every region, so the litho-body bound *replaces* the class
  bound as the sanity rail.
- **Gesture is unit-level, not contact-level** (the dogfeed model: "make it one
  band"): click a NAD sub-band on test A, the matching sub-band on test B → tie both
  bounding contacts so the unit bands; a unit that pinches becomes a lens. This
  sidesteps the "the bottom is the clay's top" confusion entirely — the guard
  evaluates the **unit being banded**, not the boundary-owning layer below.

### ★★ RENDER APPROACH LOCKED: R1 (owner, 2026-06-25, post-history-review)

Running `computeSectionFill` *directly* on geotech sub-bands is what produced the
**187-singleton (79%)** failure in the project memory → that's why the geotech
render is litho-framed today. So **R1, not R2**:
- **Keep the litho partition frame** (`subdivideRegionsByGeotech`) — it's the
  187-singleton guard.
- **Replace its all-or-nothing `body_id` connection with per-sub-band band/onlap/
  lens**, computed from the geotech edges (`geotechPackingEdges`) reusing the
  band/onlap/lens engine (`partitionFill.ts` `classifyTermination` / the 2-column
  `computePartitionFill` delegate) **per litho region**. A geotech sub-band BANDS
  when both its bounding contacts are tied, ONLAPS at 1, LENSES at 0 — exactly
  litho's contact-correlation model, but bounded inside each litho band.
- **Gesture guard DROPPED entirely** — geotech ties become as permissive as litho's
  contact-correlate (no class / body / lithology toast). The litho frame + the
  per-region geometry are what keep the result sensible; an out-of-region (nonsense)
  tie simply doesn't render, same as litho. `canConnectPacking` /
  `resolvePackingDescriptor` are removed.

### Phase 2 — reuse `computeSectionFill` for geotech band/onlap/lens

Today the geotech sub-band shapes come from `subdivideRegionsByGeotech` (split the
litho region by NAD, **merge-or-dominant-recolour** by `body_id` — all-or-nothing,
no onlap/lens). The owner wants the richer **band / onlap / lens** the litho
partition already produces from contact-correlation counts (2 tied → band, 1 →
onlap, 0 → lens). Reuse `computeSectionFill` for the geotech sub-bands, driven by
the **geotech** contact correlations (`geotechPackingEdges`).

**Key constraint (must not regress):** the geotech partition must stay **bounded
within each litho body** — a from-scratch whole-section geotech `computeSectionFill`
re-opens the **187-singleton trap** (a loose sand lenses out because it doesn't tie
to the dense sand next door even inside the same litho unit). So the band/onlap/lens
computation runs **per litho body** (or per litho region), using each test's NAD
sub-band stack *within that body* as the columns and the geotech edges as the
correlations — the litho partition still frames every region.

**DOGFEED FINDINGS (2026-06-25 evening, after Phase 1 shipped) — these reshape Phase 2:**
- The owner tried to "connect the bottom of one dense sand to the bottom of the other
  to make it one band" and got the toast **"can only link same lithology."** Root
  cause: a unit's **bottom contact is the top of the layer below** (sand's base ==
  clay's top, keyed at the clay). The contact-level gesture + the
  `canConnectPacking` guard resolve that contact to the **clay** and reject it — the
  guard is checking the wrong unit for a bottom-tie.
- Owner's mental model is **band/unit-level, not contact-level**: "make it ONE band."
  → Phase 2 should likely offer a **unit-level tie** on the geotech axis: click a NAD
  sub-band on test A, click the matching sub-band on test B → tie **both** its
  bounding contacts at once (top + the shared bottom), so the unit becomes a band
  without the user ever reasoning about "the clay's top." The guard then evaluates
  the **unit being banded** (the sand), not the boundary-owning layer.
- This also means Phase 1's all-or-nothing `body_id` render is the visible blocker: a
  single tie doesn't show until `computeSectionFill`'s band/onlap/lens lands.

**Design questions to resolve in Phase-2 detailed design (not now):**
- **Unit-level vs contact-level tie** on the geotech axis (the dogfeed strongly
  favours unit-level — tie a sub-band ⇒ both its contacts). How a unit-level tie maps
  onto the existing contact-edge storage (two edges per tie? a derived pair?).
- Where the same-class/same-body guard evaluates (the banded unit, not the
  boundary-owning layer).
- Run `computeSectionFill` once **per litho region/body** with that body's
  sub-band columns, or extend `subdivideRegionsByGeotech` to call the
  band/onlap/lens classifier (`classifyTermination`) per sub-band? (Leaning: a
  per-region `computeSectionFill` call, since it already does onlap/lens geometry.)
- How a geotech onlap/lens renders *inside* a litho band that is itself an
  onlap/lens (nested termination) — the clipping/geometry interaction.
- Whether the substrate / deep-to-deep passes need a geotech analogue.

**Phase-2 acceptance:** a NAD sub-band tied at both contacts bands across; tied at
one contact onlaps; untied lenses — all *within* its litho body, with the litho
partition unchanged. Validated on `test.strix` against owner marks.

## Risks / guardrails

- **Litho-partition regression (tonight's bug):** `geotechPackingEdges` MUST be a
  separate list from `contactCorrelationEdges`; the partition's edge source stays
  litho. Add an explicit test/assertion that the litho axis + the geotech axis
  partition connectivity are both unchanged by Phase 1.
- **Overlay coupling:** `CorrelationEdgesOverlay` is litho-flavoured; mounting it on
  geotech may surface litho-specific interactions (body chips, accept-edge). Gate
  those off on the geotech axis explicitly rather than hoping props are unused.
- **The :8765 lesson:** before any "it's not connecting" debugging, check the new
  boot log names `groundmodel` (not `_integration`), and the section
  `listContactCorrelations: N edge(s)` log.

## Testing

- **Phase 1:** Vitest — overlay mounts on the geotech axis with geotech
  contacts/edges; the gesture path emits a geotech edge for a same-class/same-body
  pair, rejects cross-class/cross-body, right-click disconnects; a litho-partition
  connectivity snapshot is unchanged. `tsc` clean. **Dogfeed** the click + the
  ribbon + right-click on `test.strix`.
- **Phase 2:** the `strix-suggestion-eval` / real-`test.strix` band/onlap/lens
  acceptance, plus `strix-section-geometry-check` for the new geotech overlay
  geometry (spacing-aware warp).

## Out of scope

- Changing the litho correlation, the litho partition, the NAD classifier, or the
  auto packing-sequence rule.
- Cross-litho-body packing connections (within-body only stays the rule).

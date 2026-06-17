# Bottom-tie correlation — correlate a test's deepest base (design)

**Date:** 2026-06-17
**Status:** design approved (owner, 2026-06-17); ready for an implementation plan
**Origin:** dogfeed of the litho cross-section fill — deep units that the geologist knows are continuous were pinching out, with no way to express the continuity.

---

## 1. Problem & goal

A litho contact is shared **between two layers**: a unit's base contact is the *top* contact of the layer below it (`litho_contact_correlation_edge` references `litho_layer.id`, which keys the contact at that layer's **top**). The **deepest** layer of a test has no layer below it, so **its base is not an addressable contact** — it can never carry a correlation edge.

Consequence (under the now-governing rule "lithos and correlations are the base truth; band/onlap/lens = 2/1/0 correlated bounding contacts"): the deepest unit can reach **at most 1** correlated contact (its top) → it can only **onlap or pinch, never band**. So a deep substrate the geologist *knows* continues across the section cannot be expressed as continuous — it always pinches. The owner's words: *"if I could correlate the bottom of a test, I would have done that at the bottom of S7."*

**Goal:** let the geologist **correlate the bottom (deepest base) of a test** to another test's bottom — a "bottom-tie" — so the deepest unit gains a correlated base contact and **bands**. It is an explicit, correlation-driven control consistent with the project's "correlations are base truth" model.

**Non-goals:** see §11. Notably this spec does **not** include the pinch-apex-cap geometry change (owner decision 2026-06-17 — out of scope), and does **not** build the automatic deepest-first geometric fill (deferred to Phase 5, logged in `docs/debt.md`).

---

## 2. Decisions (owner-confirmed 2026-06-17)

- A bottom-tie is a **correlation** (option (i)): an edge joining two tests' **deepest-layer bases**. Not a per-test "open base" flag, not a tie-to-geo-floor.
- **Reuse the existing correlation gesture** — the deepest layer's base becomes a grabbable contact; you drag a correlation to another test's bottom. No new gesture/mode.
- The bottom-tie renders **dashed / interpretive**, visually distinct from solid observed-contact correlations.
- **Bottom-tie (base-side) contacts are excluded from the confidence/distance calc** — they are interpretive, not observed, and must never reduce the confidence fade.
- **No apex-cap** in this work — un-tied deep units pinch as they do today.
- The automatic **deepest-first lithology-only fill (model "B")** is deferred to **Phase 5** as an opt-in alternative; logged in `docs/debt.md`.

---

## 3. Background / context

This builds directly on this session's correlation-aware partition work: the floor carry-through and reach guard were made correlation-aware (`a2cbeb5a`), so band-vs-lens now follows correlation everywhere and an uncorrelated deep unit pinches. The bottom-tie is the missing way to express continuity for the *deepest* unit, whose base the contact-correlation model currently cannot address. With the bottom-tie, "the deep substrate continues" becomes a correlation the geologist draws, exactly like every other band — no geometric heuristic.

---

## 4. Scope / touched modules

- **Schema / domain:** `litho_contact_correlation_edge` (ORM + migration), the edge value object / repository, the correlate use case validation.
- **API:** the correlate endpoint + edge response schema (carry the new side discriminator).
- **Frontend partition:** `desktop/src/renderer/src/utils/partitionFill.ts` (`classifyTermination` base-correlation lookup).
- **Frontend section editor:** the contact-handle + correlate gesture (ContactsLayer / correlate mode) to expose the deepest-base handle; `CorrelationEdgesOverlay` for the dashed interpretive rendering.
- **Confidence:** `utils/distanceConfidence.ts` / `tinConfidence.ts` / the confidence inputs — exclude base-side contacts.
- **Voxel:** no change (consumes the partition payload).

---

## 5. Schema — a `contact_side` discriminator on the edge endpoints

A correlation edge today joins two layers at their **top** contacts. Add an endpoint discriminator so an edge can address a layer's **base**:

- Add `contact_a_side` and `contact_b_side` to `litho_contact_correlation_edge`, enum `'top' | 'base'`, **default `'top'`**. Existing edges are `('top','top')` — unchanged behaviour.
- A **bottom-tie** is an edge with `side='base'` on **both** endpoints, referencing the two tests' deepest layers.
- Backwards-compat is suspended pre-ship (per CLAUDE.md), so the additive migration is clean; the default keeps all existing rows correct.

Rejected alternative: synthesising a phantom "substrate" layer below each test's deepest layer so the existing top-keyed edge could reference it. Rejected — it pollutes every column with phantom layers and complicates the resolver; the side discriminator is additive and local.

---

## 6. Frontend — gesture + rendering

- **Grabbable base handle:** the deepest layer of each test exposes a base contact handle in the section editor (in addition to the existing top/between-layer handles). It participates in the same correlate gesture (drag from one handle to another to create an edge).
- An edge created from base handles is persisted with `side='base'` on both endpoints (a bottom-tie). The existing single-click / drag correlate ergonomics are unchanged.
- **Rendering:** `CorrelationEdgesOverlay` draws a bottom-tie **dashed and in the interpretive style** (distinct from the solid observed-contact correlation ribbon), so it reads at a glance as an interpretation. The base handle is visually marked as a base/floor handle.
- Deletion / re-grab follow the existing correlation-edge affordances.

---

## 7. Partition — honour the base-tie in `classifyTermination`

`classifyTermination` decides band/onlap/lens by counting a unit's two bounding contacts' correlations. Today a unit's **base** correlation is found via an edge on the **layer-below's** id (top-keyed). Extend the base lookup:

> A unit's base contact counts as correlated if **either** (existing) an approved edge exists on the layer-below's contact toward the facing/reaching neighbour, **or** (new) an approved edge with `side='base'` exists on **this unit's own layer** toward that neighbour.

For the **deepest** layer (no layer below) the base correlation can come *only* from the new `side='base'` edge — the bottom-tie. With its top already correlated and its base now tied, the deepest unit reaches **2 → it bands**. All of this session's reach/defer-past-too-shallow logic stays unchanged; the bottom-tie simply supplies the previously-impossible base correlation.

---

## 8. Confidence — exclude base-side contacts

The confidence fade dims fill by distance to the nearest **observed** contact/investigation. A bottom-tie is interpretive (no data lives at that base), so:

> Contacts/edges with `side='base'` are **excluded** from the confidence/distance inputs (`distanceConfidence.ts` / `tinConfidence.ts` and whatever feeds the per-element confidence). A bottom-tie never increases confidence anywhere.

(Note: the 2D model-fill overlay already has confidence fade off — `7c08c315`. This requirement governs every *other* confidence consumer, e.g. contacts and the 3D path, so a base-tie can't inflate them.)

---

## 9. Voxel — inherits, no change

The voxel build consumes the `computeSectionFill` partition as its payload. Once the partition bands the tied deep substrate, the voxel model inherits it on the next **Build** — no labeller/build change. The 2D PartitionFillOverlay reflects it live; the 3D model needs a re-Build.

---

## 10. Correctness rules (each test-pinned)

1. **Tie → band.** A deepest unit whose base is tied (`side='base'` edge) to a reaching neighbour bands across the gap (was onlap/lens before).
2. **No tie → unchanged.** A deepest unit with no base-tie behaves exactly as today (onlap/lens per its top correlation) — no regression.
3. **Default side.** Existing edges (`side='top'`) and all current partitions are byte-identical; the migration default preserves them.
4. **Confidence ignores base.** Adding a bottom-tie does not change the confidence/fade anywhere.
5. **Voxel parity.** After a Build, the voxel model reproduces the banded substrate (the partition is the source of truth).

---

## 11. Out of scope

- **Apex-cap / pinch geometry** for un-tied deep units — explicitly excluded (owner, 2026-06-17). Un-tied deep units pinch as they do today.
- **Automatic deepest-first geometric fill ("B")** — Phase-5 debt; an opt-in mode needing only lithos, no correlations.
- Tying a deep test's bottom to a *shallow* test whose own base is far above the deep unit's depth is not meaningful; the gesture targets bottoms at comparable/reaching depth. (Validation may warn, not block — implementation detail.)

---

## 12. Testing strategy

- **Partition unit tests** (`partitionFill.test.ts`, behaviour-shaped via `coverAt`): a deepest unit with a base-tie bands; without it, pinches/onlaps (unchanged); existing partitions byte-identical with default `'top'` edges.
- **Schema / API / use-case tests:** the edge round-trips `contact_side`; a `('base','base')` edge is accepted and surfaced; default `'top'` on legacy rows.
- **Confidence test:** a `side='base'` contact does not alter the confidence/distance result.
- **Real-data validation:** reconstruct CS1 from the dev DB, tie S7's (or the relevant deep substrate's) bottom, confirm it bands; confirm un-tied deep units and CS2/CS3 are unchanged; golden / Python-port parity preserved (or the Python `section_partition` port updated in lockstep if the side lookup touches the golden paths — keep the layers in sync).
- **Frontend gesture test:** the base handle creates a `side='base'` edge; it renders dashed/interpretive.

---

## 13. Risks & mitigations

- **Python-port / golden desync:** the base-correlation lookup change must be mirrored in the backend `section_partition` port if it affects golden paths; tests pin parity.
- **Gesture discoverability:** the base handle is a new grab target — mitigated by reusing the known correlate gesture + the distinct interpretive rendering. A first-use hint can follow (debt #93).
- **Edge endpoint semantics:** `side` must be validated per endpoint (a top↔base mixed edge is unusual — decide allow/normalise during planning; the common case is base↔base).

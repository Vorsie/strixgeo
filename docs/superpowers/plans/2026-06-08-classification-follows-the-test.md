# Classification Follows the Test — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A test's geological contacts + accepted litho render on every section whose corridor contains it — automatically, with no per-section seeding — so a test is classified once.

**Architecture:** Replace the render/export gate from "contact id ∈ the section's `seeded_formation_contact_ids`" to "contact's investigation ∈ the section's in-corridor projected investigations". A small pure helper computes the in-corridor investigation set on the frontend (reused by the canvas render gate and the correlate-mode gate); the backend export filters by the projection it already computes. The `seeded_*` column is kept (bundle/compat) but no longer gates classification. Correlations are unchanged.

**Tech Stack:** React + TypeScript + Vitest (frontend); FastAPI + SQLAlchemy + pytest (`scripts/run-integration-tests.ps1`).

**Spec:** `docs/superpowers/specs/2026-06-08-classification-follows-the-test-design.md`

---

### Task 1: Pure helper — `inCorridorInvestigationIds`

**Files:**
- Create: `desktop/src/renderer/src/utils/sectionClassification.ts`
- Test: `desktop/src/renderer/src/utils/sectionClassification.test.ts`

The render gate and the correlate gate both need "which investigations does this section project". `investigationsOnSection` (in `utils/sectionProjection.ts`) already does the projection; this wraps it into an id-set over CPTs + boreholes, honouring the section's excluded ids.

- [ ] **Step 1: Write the failing test**

`desktop/src/renderer/src/utils/sectionClassification.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { inCorridorInvestigationIds } from './sectionClassification'

// A section line from (0,0) to (100,0), 10 m corridor.
const section = {
  start_x: 0, start_y: 0, end_x: 100, end_y: 0,
  projection_buffer_m: 10,
  excluded_cpt_ids: [] as string[],
  excluded_borehole_ids: [] as string[],
}
const pt = (id: string, x: number, y: number) => ({ id, location_x: x, location_y: y })

describe('inCorridorInvestigationIds', () => {
  it('includes in-corridor CPTs + boreholes, drops out-of-corridor and excluded', () => {
    const cpts = [pt('c-in', 50, 3), pt('c-far', 50, 40), pt('c-excl', 20, 0)]
    const boreholes = [pt('b-in', 80, -5)]
    const ids = inCorridorInvestigationIds(
      { ...section, excluded_cpt_ids: ['c-excl'] },
      cpts,
      boreholes,
    )
    expect(ids.has('c-in')).toBe(true)
    expect(ids.has('b-in')).toBe(true)
    expect(ids.has('c-far')).toBe(false) // offset 40 > 10 m buffer
    expect(ids.has('c-excl')).toBe(false) // excluded
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd desktop && npx vitest run src/renderer/src/utils/sectionClassification.test.ts`
Expected: FAIL — module `./sectionClassification` does not exist.

- [ ] **Step 3: Implement the helper**

`desktop/src/renderer/src/utils/sectionClassification.ts`:

```typescript
// Classification-follows-the-test (owner directive 2026-06-08): a section shows
// the classification of every test in its corridor, not only the contacts it was
// explicitly seeded with. This helper returns the in-corridor investigation id
// set the render + correlate gates filter contacts by.
import { investigationsOnSection } from './sectionProjection'
import type { InvestigationPoint, SectionEndpoints } from './sectionProjection'

type SectionCorridor = SectionEndpoints & {
  projection_buffer_m: number
  excluded_cpt_ids?: readonly string[]
  excluded_borehole_ids?: readonly string[]
}

/**
 * Ids of every CPT + borehole the section projects into its corridor
 * (within ``projection_buffer_m``, not excluded). A contact/layer belongs to a
 * section iff its anchor investigation is in this set.
 */
export function inCorridorInvestigationIds(
  section: SectionCorridor,
  cpts: readonly InvestigationPoint[],
  boreholes: readonly InvestigationPoint[],
): Set<string> {
  const ids = new Set<string>()
  const exCpt = new Set(section.excluded_cpt_ids ?? [])
  const exBh = new Set(section.excluded_borehole_ids ?? [])
  for (const p of investigationsOnSection(section, cpts, exCpt)) ids.add(p.item.id)
  for (const p of investigationsOnSection(section, boreholes, exBh)) ids.add(p.item.id)
  return ids
}
```

(If `InvestigationPoint` / `SectionEndpoints` are not exported from `sectionProjection.ts`, add `export` to their declarations there in this step.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd desktop && npx vitest run src/renderer/src/utils/sectionClassification.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/src/utils/sectionClassification.ts desktop/src/renderer/src/utils/sectionClassification.test.ts
git commit -m "feat(sections): inCorridorInvestigationIds helper (classification follows the test)"
```

---

### Task 2: Frontend render gate — `SectionsCanvas.sectionContacts`

**Files:**
- Modify: `desktop/src/renderer/src/shell/stages/sections/SectionsCanvas.tsx` (the `sectionContactIds` / `sectionContacts` memos, ~1291-1301)

`SectionsCanvas` already has `visibleCpts` / `visibleBoreholes` (the model's investigations) and `selectedSection`. Swap the seeded-id filter for the in-corridor filter.

- [ ] **Step 1: Add the import**

At the top of `SectionsCanvas.tsx`, with the other `../../../utils` imports:

```typescript
import { inCorridorInvestigationIds } from '../../../utils/sectionClassification'
```

- [ ] **Step 2: Replace the gate**

Replace the existing block (the `P2-F — explicit-content filter` comment through the `sectionContacts` memo, ~lines 1276-1301):

```typescript
  const sectionContactIds = useMemo(
    () => new Set(selectedSection?.seeded_formation_contact_ids ?? []),
    [selectedSection],
  )
  const sectionContacts = useMemo(
    () =>
      selectedSection !== null && sectionContactIds.size > 0
        ? axisContacts.filter(c => sectionContactIds.has(c.id))
        : [],
    [selectedSection, sectionContactIds, axisContacts],
  )
```

with:

```typescript
  // Classification follows the test (owner directive 2026-06-08, supersedes the
  // 2026-05-17 explicit-content filter for classification): a section shows the
  // contacts/litho of EVERY test in its corridor, not only the ids it was seeded
  // with — so a test is classified once and appears on every section through it.
  // Correlations stay relational (unchanged). The seeded set rides the bundle for
  // compat but no longer gates rendering.
  const sectionInvestigationIds = useMemo(
    () =>
      selectedSection !== null
        ? inCorridorInvestigationIds(selectedSection, visibleCpts, visibleBoreholes)
        : new Set<string>(),
    [selectedSection, visibleCpts, visibleBoreholes],
  )
  const sectionContacts = useMemo(
    () =>
      selectedSection !== null
        ? axisContacts.filter(c => sectionInvestigationIds.has(c.cpt_id ?? c.borehole_id ?? ''))
        : [],
    [selectedSection, sectionInvestigationIds, axisContacts],
  )
```

- [ ] **Step 3: tsc + the sections suite**

Run: `cd desktop && npx tsc --noEmit -p tsconfig.web.json 2>&1 | grep SectionsCanvas`
Expected: no output. (If `c.cpt_id`/`c.borehole_id` are typed `string | null`, the `?? ''` already handles it.)

Run: `cd desktop && npx vitest run src/renderer/src/shell/stages/sections/`
Expected: PASS. If a test asserted the old seeded-filter behaviour (a contact hidden because un-seeded), update it to the new behaviour: an in-corridor contact now renders without seeding. Search the sections tests for `seeded_formation_contact_ids` and reconcile each.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/renderer/src/shell/stages/sections/SectionsCanvas.tsx
git commit -m "feat(sections): render all in-corridor classification, not just seeded contacts"
```

---

### Task 3: Backend export gate — `build_section_snapshot`

**Files:**
- Modify: `src/groundmodel/application/build_section_snapshot.py` (~lines 145-235)
- Test: `tests/integration/application/test_build_section_snapshot.py` (extend; create if absent)

The snapshot already builds `investigations` by projecting CPTs/boreholes within the corridor. Replace the seeded-id contact filter with an in-corridor-investigation filter.

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/application/test_build_section_snapshot.py` (mirror an existing fixture there for the project/section/borehole/contact setup — a borehole on the section line with one accepted contact, and the section's `seeded_formation_contact_ids` left EMPTY):

```python
@pytest.mark.asyncio
async def test_in_corridor_contacts_show_without_seeding(
    db_session: AsyncSession, section_with_unseeded_contact
) -> None:
    """A contact whose anchor is in the corridor appears in the snapshot even
    when the section's seeded set is empty (classification follows the test)."""
    ctx = section_with_unseeded_contact  # section_id, project_id, contact_id
    snapshot = await BuildSectionSnapshot(db_session).execute(
        project_id=ctx.project_id, section_id=ctx.section_id
    )
    contact_ids = {c.contact_id for inv in snapshot.investigations for c in inv.contacts} \
        if hasattr(snapshot.investigations[0], "contacts") \
        else {c.contact_id for c in snapshot.contacts}
    assert ctx.contact_id in contact_ids, "in-corridor contact must show unseeded"
```

(Adapt the `contact_ids` extraction to the actual snapshot shape — read the `SectionFormationContact` / snapshot dataclass at the top of `build_section_snapshot.py` and use its real field for the contact id and where the list lives. Build the `section_with_unseeded_contact` fixture from the existing project/borehole/litho-model/contact fixtures in this test module, with `seeded_formation_contact_ids=[]` on the section and the borehole within `projection_buffer_m` of the line.)

- [ ] **Step 2: Run to verify it fails**

Run: `.\scripts\run-integration-tests.ps1 tests/integration/application/test_build_section_snapshot.py::test_in_corridor_contacts_show_without_seeding`
Expected: FAIL — the empty seeded set filters the contact out, so it's absent from the snapshot.

- [ ] **Step 3: Replace the filter**

In `build_section_snapshot.py`: after the `investigations` list is fully built (both the CPT and borehole loops), derive the in-corridor id set, and change the contact filter. Replace:

```python
        seeded_contact_ids = frozenset(section.seeded_formation_contact_ids or [])
```

— delete that line. Then where the contacts loop filters (~line 212-214):

```python
            if c.id not in seeded_contact_ids:
                continue
```

replace with:

```python
            if c_anchor_id not in in_corridor_ids:
                continue
```

and just before the contacts loop add:

```python
        # Classification follows the test (owner directive 2026-06-08): include
        # the contacts of every in-corridor investigation, not only the seeded
        # ids. The seeded set is no longer the section-render gate.
        in_corridor_ids = {inv.investigation_id for inv in investigations}
```

and inside the loop, compute the contact's anchor id before the check:

```python
            c_anchor_id = c.borehole_id if c.borehole_id is not None else c.cpt_id
```

(Verify the loop variable name `c` and the contact's anchor columns against the actual code; the contact carries `cpt_id` / `borehole_id`.)

- [ ] **Step 4: Run to verify it passes**

Run: `.\scripts\run-integration-tests.ps1 tests/integration/application/test_build_section_snapshot.py`
Expected: PASS (the new test + the existing ones — an existing seeded section's contacts are a subset of its in-corridor contacts, so they still appear).

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/application/build_section_snapshot.py tests/integration/application/test_build_section_snapshot.py
git commit -m "feat(api): section snapshot includes all in-corridor classification (not just seeded)"
```

---

### Task 4: Correlate-mode gate — `SectionsToolbar.sectionHasLithoContacts`

**Files:**
- Modify: `desktop/src/renderer/src/shell/stages/sections/SectionsToolbar.tsx` (~lines 131-138)

The gate currently blocks correlate-mode entry unless a litho contact id is in the seeded set. Re-point it at the in-corridor set so it matches the new render rule.

- [ ] **Step 1: Confirm the toolbar's investigation lists**

Run: `rg -n "visibleCpts|visibleBoreholes|cpts|boreholes" desktop/src/renderer/src/shell/stages/sections/SectionsToolbar.tsx | head`

- If the toolbar already receives CPT + borehole lists (via props/context), use them in Step 2.
- If NOT, lift the canvas's `sectionInvestigationIds` (Task 2) into the shared shell context and consume it here instead of recomputing. (Check `ShellContext` for an existing slot; add one if needed, set from `SectionsCanvas`.)

- [ ] **Step 2: Replace the gate**

Replace (~lines 131-138):

```typescript
  const sectionHasLithoContacts = useMemo(() => {
    if (!selectedSection) return false
    const seeded = new Set(selectedSection.seeded_formation_contact_ids ?? [])
    if (seeded.size === 0) return false
    return lithoContacts.some(c => seeded.has(c.id))
  }, [selectedSection, lithoContacts])
```

with (using the toolbar's CPT/borehole lists — substitute the real prop names found in Step 1):

```typescript
  const sectionHasLithoContacts = useMemo(() => {
    if (!selectedSection) return false
    // Classification follows the test: a litho contact is "on this section" iff
    // its anchor is in the section's corridor (matches SectionsCanvas render).
    const invIds = inCorridorInvestigationIds(selectedSection, cpts, boreholes)
    return lithoContacts.some(c => invIds.has(c.cpt_id ?? c.borehole_id ?? ''))
  }, [selectedSection, lithoContacts, cpts, boreholes])
```

Add the import: `import { inCorridorInvestigationIds } from '../../../utils/sectionClassification'`.

- [ ] **Step 3: tsc + the correlate test**

Run: `cd desktop && npx tsc --noEmit -p tsconfig.web.json 2>&1 | grep SectionsToolbar`
Expected: no output.

Run: `cd desktop && npx vitest run src/renderer/src/shell/stages/sections/SectionsToolbar.correlate.test.tsx`
Expected: PASS. If CT7/CT8 asserted the seeded-based gate, update the fixture so the section's investigations carry the litho contacts (the gate now reads the corridor, not the seeded set).

- [ ] **Step 4: Commit**

```bash
git add desktop/src/renderer/src/shell/stages/sections/SectionsToolbar.tsx
git commit -m "fix(sections): correlate-mode gate reads in-corridor classification, not seeded ids"
```

---

### Task 5: Docs — record the directive reversal

**Files:**
- Modify: `docs/commercial-direction.md` (the explicit-content invariant section)

- [ ] **Step 1: Update the invariant description**

In `docs/commercial-direction.md`, find the **explicit-content invariant** passage and add a note that, per the 2026-06-08 owner directive, the invariant applies to **correlations** only; **classification** (geological contacts + accepted litho) follows the test and renders on every section in whose corridor the test sits. Reference the spec `docs/superpowers/specs/2026-06-08-classification-follows-the-test-design.md`.

- [ ] **Step 2: Commit**

```bash
git add docs/commercial-direction.md
git commit -m "docs: classification follows the test (explicit-content now correlations-only)"
```

---

### Task 6: Verify end-to-end (dogfeed)

- [ ] **Step 1:** Restart the dev app (backend changed). Open the project.
- [ ] **Step 2:** Draw a **new** section through tests that already have geological contacts + accepted litho. **Expected:** their boundaries + litho appear **immediately**, with no Seed step.
- [ ] **Step 3:** Confirm correlate mode is enterable on that section (the gate now sees the in-corridor litho contacts).
- [ ] **Step 4:** Export the section (DXF/PDF) and confirm it contains the in-corridor classification.
- [ ] **Step 5 (regression):** An existing, previously-seeded section renders the same content as before (its seeded contacts are a subset of its in-corridor contacts).

---

## Notes for the implementer

- Use `.\scripts\run-integration-tests.ps1` for backend tests (sibling `_integration` DB). Running it truncates the shared DB, wiping the Playwright e2e fixture — re-seed before any e2e run.
- Node must be 22.x for Vitest.
- This intentionally leaves `seeded_formation_contact_ids` in the schema + bundle (compat). Removing it / the now-redundant seeding in the accept/draw flows is a **follow-up**, not part of this plan.
- Out of scope (do NOT touch): correlation creation, auto-correlate adjacency (already projection-based), the TIN/Build path (already model-wide).

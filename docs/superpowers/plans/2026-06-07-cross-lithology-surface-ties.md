# Cross-Lithology Surface Ties Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user correlate a top or bottom contact to the next test *across lithologies* as a continuous surface line (never a body), unblocking the "the top is the same as in the next test" gesture.

**Architecture:** Remove the same-lithology creation guard so a cross-lithology contact edge can exist. It is a *surface tie* (vs a *body correlation*), classified at render time by comparing the two endpoints' `litho_main_soil_code` — no schema, no migration. The resolver already drops cross-lithology edges from body formation, so a tie never creates a mixed body. `CorrelationEdgesOverlay` renders a tie as a clean connecting line instead of the filled seam ribbon, which also removes the old "black diagonal" stray ribbon the guard was patching.

**Tech Stack:** FastAPI + SQLAlchemy (async) backend; React + TypeScript + Vitest desktop renderer; pytest integration tests via `scripts/run-integration-tests.ps1`.

**Spec:** `docs/superpowers/specs/2026-06-07-cross-lithology-surface-ties-design.md`

---

### Task 1: Backend — allow cross-lithology contact ties

**Files:**
- Modify: `src/groundmodel/application/correlate_litho_contacts.py` (remove the step-4b same-lithology guard + its now-unused `_litho_code` helper)
- Test: `tests/integration/api/test_litho_contact_correlations.py` (invert `test_cross_lithology_correlation_is_422`)

The same-lithology invariant for *bodies* is already covered by the resolver unit test (`tests/unit/domain/services/test_resolve_litho_instances.py` — it drops cross-lithology edges from the adjacency graph), so this task only changes the *creation* behaviour.

- [ ] **Step 1: Invert the guard test**

In `tests/integration/api/test_litho_contact_correlations.py`, replace the whole `test_cross_lithology_correlation_is_422` function (around line 227) with this. It keeps the identical ZAND/KLEI setup but now asserts the edge is **created** (201) and appears in the list:

```python
async def test_cross_lithology_correlation_is_allowed_as_surface_tie(
    async_client: AsyncClient,
    project: ProjectOrm,
    db_session: AsyncSession,
    two_contacts_in_litho_model: tuple[str, str, str],
) -> None:
    """A correlation between two DIFFERENT lithologies is now allowed (201).

    It is a *surface tie* (the boundary is one continuous surface even though
    the material differs). The resolver still drops cross-lithology edges from
    body formation (covered by test_resolve_litho_instances), so this never
    creates a mixed-lithology body — it is a pure surface correlation.
    """
    from uuid import UUID

    litho_id, ca, cb = two_contacts_in_litho_model
    # Give the two endpoints distinct lithologies: ca → ZAND, cb → KLEI.
    ca_contact = await db_session.get(FormationContactOrm, UUID(ca))
    assert ca_contact is not None
    sand = await db_session.get(GeologicalFormationOrm, ca_contact.formation_id)
    assert sand is not None
    sand.litho_main_soil_code = "ZAND"
    clay = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="KLEI-CC",
        color="#6b7280",
        display_order=1,
        litho_main_soil_code="KLEI",
    )
    db_session.add(clay)
    cb_contact = await db_session.get(FormationContactOrm, UUID(cb))
    assert cb_contact is not None
    cb_contact.formation_id = clay.id
    await db_session.commit()

    base = f"/projects/{project.id}/geology/models/{litho_id}/contact-correlations"
    r = await async_client.post(base, json={"contact_a_id": ca, "contact_b_id": cb})
    assert r.status_code == 201, r.text

    # The tie persists and is listed like any other edge.
    listed = await async_client.get(base)
    assert listed.status_code == 200, listed.text
    assert len(listed.json()) == 1
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `.\scripts\run-integration-tests.ps1 tests/integration/api/test_litho_contact_correlations.py::test_cross_lithology_correlation_is_allowed_as_surface_tie`
Expected: FAIL — the POST returns 422 (the guard still rejects cross-lithology), so `assert r.status_code == 201` fails with `422`.

- [ ] **Step 3: Remove the same-lithology guard**

In `src/groundmodel/application/correlate_litho_contacts.py`, delete the entire step-4b block in `CorrelateLithoContacts.execute` (it sits between the same-investigation guard and the canonical-ordering step):

```python
        # ------------------------------------------------------------------ #
        # 4b. Same-lithology guard. Correlations group same-lithology units    #
        #     into one body and the resolver DROPS any cross-lithology edge —  #
        #     so a silt↔clay edge groups nothing yet still renders as a stray  #
        #     ribbon (the "black diagonal", dogfeed 2026-06-05). Reject it at   #
        #     creation so it can never land.                                    #
        # ------------------------------------------------------------------ #
        soil_a = await self._litho_code(ca.formation_id)
        soil_b = await self._litho_code(cb.formation_id)
        if soil_a is not None and soil_b is not None and soil_a != soil_b:
            raise ValueError(
                f"Cannot correlate across lithologies ({soil_a} ↔ {soil_b}) — "
                "a correlation joins same-lithology units into one body"
            )
```

Then delete the now-unused `_litho_code` helper method (defined earlier in the same class — it has no other caller):

```python
    async def _litho_code(self, formation_id: UUID) -> str | None:
        """Return a formation's ``litho_main_soil_code`` (None if unset/missing)."""
        return (
            await self._session.execute(
                select(GeologicalFormationOrm.litho_main_soil_code).where(
                    GeologicalFormationOrm.id == formation_id
                )
            )
        ).scalar_one_or_none()
```

After removing both, check whether `GeologicalFormationOrm` is still imported/used elsewhere in the file; if the import is now unused, remove it (ruff will flag `F401`). Run `uv run ruff check --fix src/groundmodel/application/correlate_litho_contacts.py` to auto-clean imports.

- [ ] **Step 4: Run the tests to verify green**

Run: `.\scripts\run-integration-tests.ps1 tests/integration/api/test_litho_contact_correlations.py`
Expected: PASS (all, including the inverted test).

Run: `uv run pytest tests/unit/domain/services/test_resolve_litho_instances.py -q`
Expected: PASS — confirms the resolver still drops cross-lithology edges (no mixed body), so the safety invariant holds after the guard removal.

- [ ] **Step 5: Commit (one file per commit)**

```bash
git add src/groundmodel/application/correlate_litho_contacts.py
git commit -m "feat(litho): allow cross-lithology contact correlations as surface ties"
git add tests/integration/api/test_litho_contact_correlations.py
git commit -m "test(litho): cross-lithology correlation now creates a surface tie (201)"
```

---

### Task 2: Frontend — render a cross-lithology tie as a line, not a ribbon

**Files:**
- Modify: `desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx`
- Test: `desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.test.tsx`

The overlay already has `contacts`, `formations`, and `contactScreenMap` (contact id → `{ x, topY }`) and `formationById` (formation id → formation). A tie is classified by comparing the two endpoints' `litho_main_soil_code`.

- [ ] **Step 1: Write the failing test**

Add this to `CorrelationEdgesOverlay.test.tsx` inside the `describe('CorrelationEdgesOverlay', ...)` block (after the CC9 test). It mirrors the CC8/CC9 fixtures but gives the two endpoints different lithologies:

```typescript
  // TIE1: a cross-lithology edge renders a surface-tie LINE (no ribbon),
  // while a same-lithology edge still renders the ribbon. Surface ties are
  // the "top is the same as next test, across lithologies" gesture.
  it('TIE1: cross-lithology edge renders a tie line and no ribbon', () => {
    const fSand = { ...makeFormation('f-sand', 'Zand', 1), litho_main_soil_code: 'ZAND', color: '#fbbf24' }
    const fClay = { ...makeFormation('f-clay', 'Klei', 2), litho_main_soil_code: 'KLEI', color: '#6b7280' }
    const contacts = [
      makeContact('ca', 'f-sand', 'inv-A', 'cpt', 2.0),
      makeContact('cb', 'f-clay', 'inv-B', 'cpt', 2.0),
    ]
    const edge = {
      id: 'e1', contact_a_id: 'ca', contact_b_id: 'cb', model_id: 'm1',
      source: 'manual', user_approved: true, created_at: '2026-01-01T00:00:00Z',
    }
    renderOverlay({
      contacts, formations: [fSand, fClay],
      placedColumns: [makeColumn('inv-A', 100, 10, 5), makeColumn('inv-B', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(), plotTop: 20, plotBottom: 200,
      contactEdges: [edge],
    })
    // Cross-litho → a connecting line, NOT a filled ribbon.
    expect(screen.getByTestId('tie-line-e1')).not.toBeNull()
    expect(screen.queryByTestId('ribbon-e1')).toBeNull()
  })

  it('TIE2: same-lithology edge still renders a ribbon and no tie line', () => {
    const fSand = { ...makeFormation('f-sand', 'Zand', 1), litho_main_soil_code: 'ZAND', color: '#fbbf24' }
    const contacts = [
      makeContact('ca', 'f-sand', 'inv-A', 'cpt', 2.0),
      makeContact('cb', 'f-sand', 'inv-B', 'cpt', 2.0),
    ]
    const edge = {
      id: 'e2', contact_a_id: 'ca', contact_b_id: 'cb', model_id: 'm1',
      source: 'manual', user_approved: true, created_at: '2026-01-01T00:00:00Z',
    }
    renderOverlay({
      contacts, formations: [fSand],
      placedColumns: [makeColumn('inv-A', 100, 10, 5), makeColumn('inv-B', 200, 10, 20)],
      levelToScreen: makeLevelToScreen(), plotTop: 20, plotBottom: 200,
      contactEdges: [edge],
    })
    expect(screen.getByTestId('ribbon-e2')).not.toBeNull()
    expect(screen.queryByTestId('tie-line-e2')).toBeNull()
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd desktop && npx vitest run src/renderer/src/components/sections/CorrelationEdgesOverlay.test.tsx -t TIE`
Expected: FAIL — TIE1 fails because `tie-line-e1` does not exist (the overlay renders `ribbon-e1` for every edge today). TIE2 passes already.

- [ ] **Step 3: Implement the tie classification + line branch**

In `CorrelationEdgesOverlay.tsx`, add a `lithoByContactId` lookup next to the other memoised maps (just after the `stripeColorsByContactId` useMemo, ~line 856):

```typescript
  // Lithology per contact (debt B / cross-lithology surface ties): a contact's
  // litho_main_soil_code via its formation. Used to classify an edge as a
  // surface tie (endpoints differ in lithology) vs a body correlation.
  const lithoByContactId = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const c of contacts) {
      m.set(c.id, formationById.get(c.formation_id)?.litho_main_soil_code ?? null)
    }
    return m
  }, [contacts, formationById])
```

Then in the `contactEdges.map(ce => { ... })` render block (the group that returns `<g ... key={`ribbon-${ce.id}`}>`, ~line 1168), insert this branch at the **top of the callback**, before any ribbon geometry is computed:

```typescript
          // Cross-lithology edge → SURFACE TIE: draw the clean connecting line
          // only (no seam ribbon / no body chip — there is no body). The
          // resolver drops cross-lithology edges from body formation, so a tie
          // is purely a "same surface, different material" correlation.
          const lithoA = lithoByContactId.get(ce.contact_a_id) ?? null
          const lithoB = lithoByContactId.get(ce.contact_b_id) ?? null
          const isSurfaceTie = lithoA !== null && lithoB !== null && lithoA !== lithoB
          if (isSurfaceTie) {
            const a = contactScreenMap.get(ce.contact_a_id)
            const b = contactScreenMap.get(ce.contact_b_id)
            if (!a || !b) return null
            const color = ce.user_approved ? CONTACT_EDGE_COLOR : UNAPPROVED_EDGE_COLOR
            return (
              <line
                key={`tie-${ce.id}`}
                data-testid={`tie-line-${ce.id}`}
                data-approved={ce.user_approved ? 'true' : 'false'}
                x1={a.x}
                y1={a.topY}
                x2={b.x}
                y2={b.topY}
                stroke={color}
                strokeWidth={CONTACT_EDGE_WIDTH}
                strokeDasharray={ce.user_approved ? undefined : UNAPPROVED_EDGE_DASH}
              />
            )
          }
```

(`CONTACT_EDGE_COLOR`, `UNAPPROVED_EDGE_COLOR`, `CONTACT_EDGE_WIDTH`, `UNAPPROVED_EDGE_DASH` are existing module constants. `contactScreenMap` returns `{ x, topY }` per contact id.)

- [ ] **Step 4: Run the tests + tsc to verify green**

Run: `cd desktop && npx vitest run src/renderer/src/components/sections/CorrelationEdgesOverlay.test.tsx`
Expected: PASS (all, including TIE1 + TIE2).

Run: `cd desktop && npx tsc --noEmit -p tsconfig.web.json 2>&1 | grep CorrelationEdgesOverlay`
Expected: no output (no type errors in the file).

- [ ] **Step 5: Commit (one file per commit)**

```bash
git add desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx
git commit -m "feat(sections): render cross-lithology ties as a line, not a ribbon"
git add desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.test.tsx
git commit -m "test(sections): TIE1/TIE2 pin surface-tie line vs body-correlation ribbon"
```

---

### Task 3: Manual verification in the app (dogfeed)

No code — confirm the end-to-end gesture against the running desktop app.

- [ ] **Step 1: Restart the dev app** so it picks up the backend change (new uvicorn on :8765; no migration needed). Open a litho cross-section that has adjacent tests with different lithologies at a shared boundary.

- [ ] **Step 2: Enter correlate mode.** Click a contact on one test (e.g. the top of a sand band), then the corresponding contact on the next test (e.g. the top of a clay band).

Expected: the correlation is **created** (no "Could not create the boundary correlation" toast, no 422 in the console) and renders as a **clean connecting line** between the two contacts — NOT a filled ribbon, and with no `#N` body chip.

- [ ] **Step 3: Confirm it's not a body.** The two bands keep their own colours; nothing merges into one band. Right-click the line / its contact → the existing delete path removes it.

- [ ] **Step 4 (regression):** a *same-lithology* correlation on the same section still renders the filled ribbon + `#N` chip as before.

---

## Notes for the implementer

- **Run order for backend tests:** always use `.\scripts\run-integration-tests.ps1` — it points `DATABASE_URL` at the sibling `groundmodel_integration` DB. A bare `pytest tests/integration` would hit the dev DB. Running the integration suite also truncates the shared `_integration` DB, which wipes the Playwright e2e fixture — re-seed before any e2e run.
- **Node must be 22.x** for Vitest (`node --version`); Node 24 segfaults the test runner.
- The armed-correlation drag tint for a pending cross-lithology pair is intentionally **out of scope** (YAGNI) — add only if the gesture reads ambiguously in Task 3.

# Litho 3D — Phase 1b: Tie Accept-All + Right-Click Menu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add (a) an "Accept all ties" toolbar button backed by a one-commit batch create endpoint, and (b) a right-click Accept/Reject context menu on each tie ghost — replacing the current left-click-accept + red-dot gestures.

**Architecture:** Backend gains `POST /projects/{id}/sections/batch` (BatchCreateSections use case, N creates + one commit, mirroring `BatchAcceptLithoSuggestions`). Frontend: `api.section.createBatch`, `handleAcceptAllTies` in `useSections`, an "Accept all" `ToolbarButton`, and a `contextmenu` handler on the tie `Polyline` opening the shared `ContextMenu` with Accept/Reject (mirroring the correlation edge menu). The red dot + left-click accept are removed.

**Tech Stack:** FastAPI + SQLAlchemy (async), React + react-leaflet, the existing `ContextMenu` (`components/ui/ContextMenu.tsx`), Vitest + Playwright + pytest integration.

**Precedents (read these):** `BatchAcceptLithoSuggestions` (`application/batch_accept_litho_suggestions.py`, router `api/routers/geology/contacts.py:1266`), `cross_section.py:155-199` + `CrossSectionRepository.create` (`:37-86`, flush-not-commit), `SectionsToolbar.tsx:815-830` (litho Accept-all button), `ContextMenu.tsx` + `CorrelationEdgesOverlay.tsx:693-732,1200-1224` (edge menu), `tests/integration/api/test_batch_accept_litho.py`, `components/sections/BodyContextMenu.test.tsx`.

---

## File Structure

**Backend — create:**
- `src/groundmodel/api/schemas/project/batch_create_sections_request.py` — `BatchCreateSectionsRequest`.
- `src/groundmodel/api/schemas/project/batch_create_sections_response.py` — `BatchCreateSectionsResponse`.
- `src/groundmodel/application/batch_create_sections.py` — `BatchCreateSections` use case.
- `tests/integration/api/test_batch_create_sections.py` — integration test.

**Backend — modify:**
- `src/groundmodel/api/routers/cross_section.py` — add the `POST .../sections/batch` route.

**Frontend — modify:**
- `desktop/src/renderer/src/api/clients/section.ts` — `createBatch` + payload/response types.
- `desktop/src/renderer/src/hooks/useSections.ts` — `handleAcceptAllTies` + expose.
- `desktop/src/renderer/src/hooks/useShellContextValue.ts` + `App.tsx` — thread it.
- `desktop/src/renderer/src/shell/stages/sections/SectionsToolbar.tsx` — "Accept all ties" button.
- `desktop/src/renderer/src/components/TieSuggestionOverlay.tsx` — right-click menu, remove dot + left-click accept.
- `desktop/tests/e2e/flow_auto_tie.spec.ts` — use the right-click menu; add accept-all.

**Frontend — create:**
- `desktop/src/renderer/src/components/TieSuggestionOverlay.test.tsx` — context-menu interaction test.

---

## Task 1: Backend batch-create endpoint (TDD via integration test)

**Files:**
- Create: the two schema files, the use case, the integration test.
- Modify: `src/groundmodel/api/routers/cross_section.py`.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/api/test_batch_create_sections.py`. Mirror the fixture style of `tests/integration/api/test_batch_accept_litho.py` (project fixture + async client from conftest). Minimal:

```python
"""Integration test: POST /projects/{id}/sections/batch creates N sections in one commit."""
import pytest

pytestmark = pytest.mark.asyncio


async def test_batch_create_sections_creates_all(async_client, project_id):
    payload = {
        "sections": [
            {
                "name": f"Tie-section {i}",
                "start_x": 100.0 + i, "start_y": 200.0,
                "end_x": 300.0 + i, "end_y": 400.0,
                "epsg": 31370, "projection_buffer_m": 10.0,
                "vertical_exaggeration": 1.0, "display_order": i,
            }
            for i in range(1, 4)
        ]
    }
    resp = await async_client.post(f"/projects/{project_id}/sections/batch", json=payload)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["sections"]) == 3
    names = {s["name"] for s in body["sections"]}
    assert names == {"Tie-section 1", "Tie-section 2", "Tie-section 3"}
    # All persisted + listable
    listed = await async_client.get(f"/projects/{project_id}/sections")
    listed_names = {s["name"] for s in listed.json()}
    assert {"Tie-section 1", "Tie-section 2", "Tie-section 3"} <= listed_names


async def test_batch_create_sections_empty_list(async_client, project_id):
    resp = await async_client.post(f"/projects/{project_id}/sections/batch", json={"sections": []})
    assert resp.status_code == 200, resp.text
    assert resp.json()["sections"] == []
```
Check the exact `project_id`/`async_client` fixture names used by neighbouring tests in `tests/integration/api/` and match them. If `project_id` isn't a fixture, copy the project-create setup from `test_batch_accept_litho.py`.

- [ ] **Step 2: Run it; confirm it fails**

Run: `.\scripts\run-integration-tests.ps1 tests/integration/api/test_batch_create_sections.py`
Expected: FAIL — 404 (route doesn't exist).

- [ ] **Step 3: Add the schemas**

`src/groundmodel/api/schemas/project/batch_create_sections_request.py`:
```python
"""Request schema for batch cross-section creation."""
from pydantic import BaseModel, Field
from groundmodel.api.schemas.project.cross_section import CrossSectionCreateRequest


class BatchCreateSectionsRequest(BaseModel):
    """A list of cross-sections to create in a single transaction.

    Parameters
    ----------
    sections : list[CrossSectionCreateRequest]
        The sections to create. Each is validated exactly as a single
        create. An empty list is allowed (creates nothing, returns []).
    """

    sections: list[CrossSectionCreateRequest] = Field(default_factory=list)
```

`src/groundmodel/api/schemas/project/batch_create_sections_response.py`:
```python
"""Response schema for batch cross-section creation."""
from pydantic import BaseModel
from groundmodel.api.schemas.project.cross_section import CrossSectionResponse


class BatchCreateSectionsResponse(BaseModel):
    """The created sections, in request order.

    Parameters
    ----------
    sections : list[CrossSectionResponse]
        The persisted sections with their assigned ids.
    """

    sections: list[CrossSectionResponse]
```
(Confirm the exact import path + class name of `CrossSectionResponse` / `CrossSectionCreateRequest` in `schemas/project/cross_section.py`.)

- [ ] **Step 4: Add the use case**

`src/groundmodel/application/batch_create_sections.py`:
```python
"""Batch cross-section creation — N creates, one commit."""
from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.repositories.cross_section_repository import (
    CrossSectionRepository,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class BatchCreateSections(GroundModelLogger):
    """Create several cross-sections atomically (one commit).

    Mirrors the single-create path (``CrossSectionRepository.create`` flushes
    per row) but commits exactly once so a batch is all-or-nothing.
    """

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(__name__)
        self._session = session
        self._repo = CrossSectionRepository(session)

    async def execute(
        self, *, app_project_id: UUID, sections: list[dict[str, Any]]
    ) -> list[CrossSectionOrm]:
        """Create every section, then commit once.

        Parameters
        ----------
        app_project_id : UUID
            Owning project.
        sections : list[dict]
            One create-kwargs dict per section (name, endpoints, epsg, …).

        Returns
        -------
        list[CrossSectionOrm]
            The created rows, in input order.
        """
        self.info(f"batch-creating {len(sections)} section(s) for project {app_project_id}")
        created: list[CrossSectionOrm] = []
        for spec in sections:
            row = await self._repo.create(app_project_id, **spec)
            created.append(row)
        await self._session.commit()
        for row in created:
            await self._session.refresh(row)
        self.success(f"batch-created {len(created)} section(s)")
        return created
```

- [ ] **Step 5: Add the route**

In `src/groundmodel/api/routers/cross_section.py`, after `create_section`, add:
```python
@router.post("/projects/{project_id}/sections/batch")
async def batch_create_sections(
    project_id: UUID,
    request: BatchCreateSectionsRequest,
    session: AsyncSession = Depends(get_session),
) -> BatchCreateSectionsResponse:
    """Create several cross-sections in one transaction.

    Used by "Accept all tie-sections": one round-trip, one commit.
    """
    use_case = BatchCreateSections(session)
    specs = [
        s.model_dump(exclude_none=True) for s in request.sections
    ]
    rows = await use_case.execute(app_project_id=project_id, sections=specs)
    return BatchCreateSectionsResponse(
        sections=[CrossSectionResponse.model_validate(r, from_attributes=True) for r in rows]
    )
```
Match the file's existing import style + how `create_section` builds `CrossSectionResponse` (copy its serialization exactly — it may use a helper rather than `model_validate`). Add imports for `BatchCreateSectionsRequest`, `BatchCreateSectionsResponse`, `BatchCreateSections`. Note: `model_dump` keys must match `CrossSectionRepository.create` kwargs (name, start_x, start_y, end_x, end_y, epsg, projection_buffer_m, description, vertical_exaggeration, excluded_borehole_ids, excluded_cpt_ids, min_depth_m, max_depth_m, display_order, view_state) — if `CrossSectionCreateRequest` has an extra field the repo doesn't accept, pop it before passing.

- [ ] **Step 6: Run the integration test; confirm pass**

Run: `.\scripts\run-integration-tests.ps1 tests/integration/api/test_batch_create_sections.py`
Expected: PASS (2 tests).

- [ ] **Step 7: ruff + commit (per file)**

```bash
uv run ruff format src/groundmodel/application/batch_create_sections.py src/groundmodel/api/schemas/project/batch_create_sections_request.py src/groundmodel/api/schemas/project/batch_create_sections_response.py src/groundmodel/api/routers/cross_section.py
uv run ruff check --fix <same files>
git add src/groundmodel/api/schemas/project/batch_create_sections_request.py && git commit -m "feat(sections): batch-create request schema"
git add src/groundmodel/api/schemas/project/batch_create_sections_response.py && git commit -m "feat(sections): batch-create response schema"
git add src/groundmodel/application/batch_create_sections.py && git commit -m "feat(sections): BatchCreateSections use case (one commit)"
git add src/groundmodel/api/routers/cross_section.py && git commit -m "feat(sections): POST /sections/batch endpoint"
git add tests/integration/api/test_batch_create_sections.py && git commit -m "test(sections): batch-create integration test"
```

---

## Task 2: Frontend batch client

**Files:** Modify `desktop/src/renderer/src/api/clients/section.ts`.

- [ ] **Step 1: Add types + method**

Add request/response types mirroring `CrossSectionCreatePayload`:
```typescript
export interface BatchCreateSectionsPayload {
  sections: CrossSectionCreatePayload[]
}
export interface BatchCreateSectionsResult {
  sections: CrossSectionResponse[]
}
```
Add to the `section` client object (next to `create`):
```typescript
  createBatch: (
    projectId: string,
    body: BatchCreateSectionsPayload,
  ): Promise<BatchCreateSectionsResult> =>
    post(`/projects/${projectId}/sections/batch`, body),
```
Confirm `CrossSectionResponse` is imported in this file (it is — `create` returns it).

- [ ] **Step 2: tsc + commit**

Run: `cd desktop && npx tsc --noEmit -p tsconfig.web.json`
```bash
git add desktop/src/renderer/src/api/clients/section.ts
git commit -m "feat(sections): api.section.createBatch client"
```

---

## Task 3: handleAcceptAllTies in useSections + expose

**Files:** Modify `useSections.ts`, `useShellContextValue.ts`, `App.tsx` (+ test fixtures if tsc flags missing context fields).

- [ ] **Step 1: Add the handler** near `handleAcceptTie` (above any early return):
```typescript
const handleAcceptAllTies = useCallback(async () => {
  if (!project) return
  const epsg = effectiveHorizontalEpsg
  if (epsg == null) return
  const ties = suggestedTies
  if (ties.length === 0) return
  const vexag = readSectionDefaults(project.view_state ?? null).verticalExaggeration
  const baseOrdinal = visibleSections.length
  const payloads = ties.map((tie, i) => ({
    name: `Tie-section ${baseOrdinal + i + 1}`,
    epsg,
    start_x: tie.start.x,
    start_y: tie.start.y,
    end_x: tie.end.x,
    end_y: tie.end.y,
    projection_buffer_m: tie.bufferM,
    vertical_exaggeration: vexag,
  }))
  const { sections: created } = await api.section.createBatch(project.id, { sections: payloads })
  setSections(prev => [...prev, ...created])
  created.forEach(s => handleSectionCreated(s.id))
  if (created.length > 0) setSelectedSectionId(created[created.length - 1].id)
  setSuggestedTies([])
  log.success('section', `accepted all ${created.length} tie-section(s)`)
}, [project, effectiveHorizontalEpsg, suggestedTies, visibleSections, handleSectionCreated])
```

- [ ] **Step 2: Expose** `handleAcceptAllTies` from the hook return + its `UseSectionsResult` type (signature `() => Promise<void>`), then add it to `useShellContextValue.ts` (`sections` slice + its type) and the `App.tsx` destructure + forward. If tsc flags test fixtures missing the field, add `handleAcceptAllTies: vi.fn()` to each (mirror the `handleAcceptTie` stub already there) — one commit per fixture file.

- [ ] **Step 3: tsc + tests + commit**

Run: `cd desktop && npx tsc --noEmit -p tsconfig.web.json && npm test`
```bash
git add desktop/src/renderer/src/hooks/useSections.ts && git commit -m "feat(sections): handleAcceptAllTies (batch create)"
git add desktop/src/renderer/src/hooks/useShellContextValue.ts && git commit -m "feat(sections): thread handleAcceptAllTies through shell"
git add desktop/src/renderer/src/App.tsx && git commit -m "feat(sections): forward handleAcceptAllTies in App"
# + per-fixture stub commits if needed
```

---

## Task 4: "Accept all ties" toolbar button

**Files:** Modify `SectionsToolbar.tsx`.

- [ ] **Step 1: Add the button** next to the existing "Suggest tie-sections" button. Read `handleAcceptAllTies` from `useShell().sections`. Mirror the litho Accept-all (`SectionsToolbar.tsx:815-830`):
```tsx
const [acceptingAllTies, setAcceptingAllTies] = useState(false)
// ... in JSX, only when suggestions exist:
{suggestedTies.length > 0 && (
  <ToolbarButton
    icon={<CheckCheck size={13} />}
    label={acceptingAllTies ? 'Accepting…' : 'Accept all ties'}
    busy={acceptingAllTies}
    disabled={acceptingAllTies}
    testid="tie-accept-all"
    title="Create a cross-section for every proposed tie"
    onClick={async () => {
      setAcceptingAllTies(true)
      try {
        await handleAcceptAllTies()
      } finally {
        setAcceptingAllTies(false)
      }
    }}
  />
)}
```
Add `CheckCheck` to the lucide-react import. Match the exact `ToolbarButton` prop names used by the litho Accept-all (it uses `icon`/`label`/`busy`/`disabled`/`testid`/`title`/`onClick`).

- [ ] **Step 2: tsc + tests + commit**
```bash
git add desktop/src/renderer/src/shell/stages/sections/SectionsToolbar.tsx
git commit -m "feat(sections): Accept all ties toolbar button"
```

---

## Task 5: Right-click context menu on tie ghosts (replace gestures)

**Files:** Modify `TieSuggestionOverlay.tsx`; create `TieSuggestionOverlay.test.tsx`; modify `flow_auto_tie.spec.ts`.

- [ ] **Step 1: Write the failing component test**

`desktop/src/renderer/src/components/TieSuggestionOverlay.test.tsx` — test the extracted menu, mirroring `BodyContextMenu.test.tsx`. Extract a small `TieContextMenu` (Accept/Reject) sub-component so it's testable without Leaflet:
```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TieContextMenu } from './TieSuggestionOverlay'

describe('TieContextMenu', () => {
  it('Accept item fires onAccept', () => {
    const onAccept = vi.fn()
    render(<TieContextMenu x={10} y={10} index={2} onAccept={onAccept} onReject={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByTestId('tie-context-accept'))
    expect(onAccept).toHaveBeenCalledWith(2)
  })
  it('Reject item fires onReject', () => {
    const onReject = vi.fn()
    render(<TieContextMenu x={10} y={10} index={1} onAccept={vi.fn()} onReject={onReject} onClose={vi.fn()} />)
    fireEvent.click(screen.getByTestId('tie-context-reject'))
    expect(onReject).toHaveBeenCalledWith(1)
  })
})
```
Run it → fails (TieContextMenu missing).

- [ ] **Step 2: Rewrite `TieSuggestionOverlay.tsx`**

Remove the `CircleMarker` (red dot) and the `click: () => onAccept(i)`. Add a `contextmenu` handler that opens a menu; render an exported `TieContextMenu` via `createPortal` so it escapes the Leaflet element tree:
```tsx
import { Fragment, useState } from 'react'
import { createPortal } from 'react-dom'
import { Polyline } from 'react-leaflet'
import type { LeafletMouseEvent } from 'leaflet'
import ContextMenu from './ui/ContextMenu'
import { tieToLatLngLine } from '../utils/tieToLatLngLine'
import type { SuggestedTie } from '../utils/tieAutoSuggest'

interface TieMenuState { x: number; y: number; index: number }

export interface TieContextMenuProps {
  x: number
  y: number
  index: number
  onAccept: (index: number) => void
  onReject: (index: number) => void
  onClose: () => void
}

/** Accept/Reject menu for a single tie ghost (mirrors the correlation edge menu). */
export function TieContextMenu({ x, y, index, onAccept, onReject, onClose }: TieContextMenuProps): JSX.Element {
  return (
    <ContextMenu
      portal="fixed"
      x={x}
      y={y}
      minWidth={160}
      testid="tie-context-menu"
      onClose={onClose}
      items={[
        { label: 'Accept tie', onClick: () => onAccept(index), testid: 'tie-context-accept' },
        { label: 'Reject tie', onClick: () => onReject(index), danger: true, testid: 'tie-context-reject' },
      ]}
    />
  )
}

export interface TieSuggestionOverlayProps {
  ties: readonly SuggestedTie[]
  epsg: number
  onAccept: (index: number) => void
  onReject: (index: number) => void
}

/** Green dashed ghost ties; right-click one to Accept/Reject (no left-click action). */
export function TieSuggestionOverlay({ ties, epsg, onAccept, onReject }: TieSuggestionOverlayProps): JSX.Element {
  const [menu, setMenu] = useState<TieMenuState | null>(null)
  return (
    <>
      {ties.map((tie, i) => (
        <Polyline
          key={`tie-ghost-${i}`}
          positions={tieToLatLngLine(tie, epsg)}
          pane="section-overlays"
          pathOptions={{ color: '#22c55e', weight: 3, opacity: 0.75, dashArray: '7 5' }}
          eventHandlers={{
            contextmenu: (e: LeafletMouseEvent) => {
              e.originalEvent.preventDefault()
              e.originalEvent.stopPropagation()
              setMenu({ x: e.originalEvent.clientX, y: e.originalEvent.clientY, index: i })
            },
          }}
        />
      ))}
      {menu &&
        createPortal(
          <TieContextMenu
            x={menu.x}
            y={menu.y}
            index={menu.index}
            onAccept={(idx) => { setMenu(null); onAccept(idx) }}
            onReject={(idx) => { setMenu(null); onReject(idx) }}
            onClose={() => setMenu(null)}
          />,
          document.body,
        )}
    </>
  )
}
```
Verify `ContextMenu`'s `portal="fixed"` positions at viewport `x/y` (clientX/clientY). If it instead expects container-local coords, subtract the map container's `getBoundingClientRect()` (the Leaflet event's `e.target._map.getContainer()`), matching the `CorrelationEdgesOverlay` pattern. Confirm the `ContextMenuItem` field names (`label`/`onClick`/`danger`/`testid`) against `ContextMenu.tsx`.

- [ ] **Step 3: Run the component test → pass; tsc.**

- [ ] **Step 4: Update the e2e** `flow_auto_tie.spec.ts`: replace the accept step (`ghosts.first().click()`) with a right-click + menu click:
```typescript
await ghosts.first().click({ button: 'right' })
await page.getByTestId('tie-context-accept').click()
await expect(page.getByText(/Tie-section/).first()).toBeVisible({ timeout: 10000 })
```
Optionally add a second test for "Accept all ties": click `getByTestId('tie-accept-all')`, assert multiple `Tie-section` rows. Run `./scripts/run-e2e.ps1 flow_auto_tie`.

- [ ] **Step 5: Commit (per file)**
```bash
git add desktop/src/renderer/src/components/TieSuggestionOverlay.tsx desktop/src/renderer/src/components/TieSuggestionOverlay.test.tsx
git commit -m "feat(sections): right-click Accept/Reject menu on tie ghosts (replace click+dot)"
git add desktop/tests/e2e/flow_auto_tie.spec.ts
git commit -m "test(sections): e2e drives tie accept via right-click menu"
```

---

## Self-Review

- **Accept-all batch:** Task 1 (endpoint/use case/test) + 2 (client) + 3 (handler) + 4 (button) — one commit, all-or-nothing. ✓
- **Right-click menu replacing gestures:** Task 5 removes dot + left-click, adds contextmenu → ContextMenu(Accept/Reject). ✓
- **Reuse:** batch use case reuses `CrossSectionRepository.create`; menu reuses `ContextMenu`; button mirrors litho Accept-all; no new infra invented.
- **Types consistent:** `BatchCreateSectionsPayload`/`Result` (TS) ↔ `BatchCreateSections{Request,Response}` (py); `handleAcceptAllTies: () => Promise<void>` across hook/shell/App.
- **Integration verification points:** exact `CrossSectionResponse` serialization in the router; `ContextMenu` `portal="fixed"` coordinate semantics; `ToolbarButton` prop names; `async_client`/`project_id` fixture names.

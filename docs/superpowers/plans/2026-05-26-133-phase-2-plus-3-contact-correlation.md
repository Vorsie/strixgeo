# #133 Phase 2+3 — Contact-level correlation, lens detection, lens companions, formation-level removal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the formation-level correlation system with a contact-level system that supports user-approved auto-correlate, lens detection from the #135 topology, and section-gated perpendicular companion creation — in one PR that drops the legacy `litho_correlation_edge` table and rewrites the resolver + admixture propagation.

**Architecture:** Three layers mirroring #127's pattern. Pure-domain `auto_correlate_contact_edges` (no Theil-Sen — boundary-signature group + depth-window + MNN) and `detect_lenses_from_graph` (#135 topology graph query); application use cases for auto-correlate, accept, detect-lenses, materialise-companions; new contact-level API endpoints; FE toolbar buttons (Accept correlations, Materialise lens companions) with edge styling driven by a new `user_approved` column; full removal of formation-level edges, gesture, ribbon, endpoints, and use cases; resolver + admixture propagation rewritten to derive the formation graph from contact edges.

**Tech Stack:** Python 3.11 (FastAPI / SQLAlchemy async / Alembic / Polars), PostgreSQL + PostGIS, pytest + pytest-asyncio. Frontend: Electron + React + TypeScript + Vitest + Playwright.

**Spec:** `docs/superpowers/specs/2026-05-26-133-phase-2-auto-correlate-and-lens-detection-design.md`.

**Pre-flight:** verify Node 22 LTS (`node --version` should be `v22.x`), `uv sync --group dev` is current, dev DB is migrated (`uv run alembic upgrade head`), integration DB exists (`scripts/run-integration-tests.ps1 --collect-only` if not).

---

## File map

### New files (create)

| File | Responsibility |
|---|---|
| `src/groundmodel/domain/services/auto_correlate_helpers.py` | Shared MNN helper (extracted from `auto_correlate.py` before that file is deleted). |
| `src/groundmodel/domain/services/auto_correlate_contact_edges.py` | Pure-domain contact-level auto-correlate (boundary-signature + depth-window + MNN). |
| `src/groundmodel/domain/services/auto_correlate_contact_edges_constants.py` | Algorithm constants. |
| `src/groundmodel/domain/services/detect_lenses_from_graph.py` | Pure-domain lens detector consuming #135 topology. |
| `src/groundmodel/application/auto_correlate_contact_edges.py` | `AutoCorrelateContactEdges` use case. |
| `src/groundmodel/application/detect_litho_lenses.py` | `DetectLithoLenses` use case. |
| `src/groundmodel/application/accept_contact_correlations.py` | `AcceptContactCorrelations` use case. |
| `src/groundmodel/application/materialise_lens_companions.py` | `MaterialiseLensCompanions` use case. |
| `src/groundmodel/api/schemas/project/litho_contact_correlation/auto_schemas.py` | Auto endpoint request/response. |
| `src/groundmodel/api/schemas/project/litho_contact_correlation/accept_schemas.py` | Accept endpoint request/response. |
| `src/groundmodel/api/schemas/project/litho_contact_correlation/lens_companion_schemas.py` | Materialise endpoint response. |
| `src/groundmodel/infrastructure/db/migrations/versions/<rev1>_add_user_approved_to_litho_contact_correlation_edge.py` | Alembic — add column. |
| `src/groundmodel/infrastructure/db/migrations/versions/<rev2>_drop_litho_correlation_edge_table.py` | Alembic — drop table. |
| `tests/unit/domain/services/test_auto_correlate_contact_edges.py` | Unit tests for the auto-correlate algo. |
| `tests/unit/domain/services/test_detect_lenses_from_graph.py` | Unit tests for the lens detector. |
| `tests/integration/application/test_auto_correlate_contact_edges.py` | Integration test. |
| `tests/integration/application/test_detect_litho_lenses.py` | Integration test. |
| `tests/integration/application/test_accept_contact_correlations.py` | Integration test. |
| `tests/integration/application/test_materialise_lens_companions.py` | Integration test. |
| `tests/integration/application/test_resolve_litho_instances_contact_based.py` | Integration test for rewritten resolver. |
| `tests/integration/application/test_propagate_litho_admixtures_contact_based.py` | Integration test for rewritten admixture propagation. |
| `desktop/tests/e2e/auto-correlate-and-lenses.spec.ts` | Playwright e2e. |

### Existing files (modify)

| File | Change |
|---|---|
| `src/groundmodel/infrastructure/db/models/litho_contact_correlation_edge_orm.py` | Add `user_approved` column. |
| `src/groundmodel/application/correlate_litho_contacts.py` | Add optional `request_section_id`; call `ResolveLithoInstances` + `DetectLithoLenses` after insert; insert with `user_approved=True`. |
| `src/groundmodel/application/uncorrelate_litho_contacts.py` (same file as Correlate) | Add optional `request_section_id`; call `ResolveLithoInstances` + `DetectLithoLenses` after delete. |
| `src/groundmodel/application/resolve_litho_instances_use_case.py` | Rewrite to consume contact edges via the contact-based domain helper. |
| `src/groundmodel/domain/services/resolve_litho_instances.py` | Rewrite to derive formation graph from contact edges. |
| `src/groundmodel/application/propagate_litho_admixtures.py` | Rewrite to derive graph from contact edges. |
| `src/groundmodel/application/clear_litho_model.py` | Switch from deleting formation-level edges to deleting contact-level edges. |
| `src/groundmodel/api/routers/geology/contact_correlations.py` | Add `/auto`, `/accept`, `/admixtures` endpoints; extend POST/DELETE request schemas with `request_section_id`; widen GET response with `user_approved`. |
| `src/groundmodel/api/routers/geology/__init__.py` | Register new lens-companions router; remove formation-level `correlations` router. |
| `src/groundmodel/api/schemas/project/litho_contact_correlation/litho_contact_correlation_schemas.py` | Extend Phase 1 schemas with `request_section_id` and `user_approved` fields. |
| `src/groundmodel/api/schemas/project/project_bundle.py` | Add `litho_contact_correlation_edges` field; remove `litho_correlation_edges` field (or keep ignored-on-read — see task). |
| `src/groundmodel/infrastructure/db/repositories/project_bundle.py` | Save/restore contact-level edges; stop saving formation-level edges. |
| `desktop/src/renderer/src/api/client.ts` | New `autoCorrelateContacts`, `acceptContactCorrelations`, `materialiseLensCompanions`; extend `createContactCorrelation`, `deleteContactCorrelation` with `requestSectionId`; widen `listContactCorrelations` response with `user_approved`; remove formation-level `correlate`, `uncorrelate`, `listCorrelations`, `autoCorrelate`, `resolveLithoInstances`. |
| `desktop/src/renderer/src/utils/projectFile.ts` | Add `litho_contact_correlation_edges` to `ProjectFileV3`; drop `litho_correlation_edges`. |
| `desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx` | Remove `CorrelateGestureState` plumbing + formation-level ribbon paths; style approved vs unapproved contact edges; add right-click Reject. |
| `desktop/src/renderer/src/components/SectionPanel.tsx` | Remove `CorrelateGestureState` prop + pass-through. |
| `desktop/src/renderer/src/shell/stages/sections/SectionsCanvas.tsx` | Pass `requestSectionId`; remove `correlateGestureState`; refetch on Accept / Materialise. |
| `desktop/src/renderer/src/shell/stages/sections/SectionsToolbar.tsx` | Add Accept correlations + Materialise lens companions buttons; remove Resolve button; rename Auto-correlate to call contact-level endpoint. |

### Files to delete (existing)

| File | Reason |
|---|---|
| `src/groundmodel/application/correlate_litho_units.py` | Formation-level manual create — superseded by contact-level. |
| `src/groundmodel/application/uncorrelate_litho_units.py` | Formation-level manual delete — superseded. |
| `src/groundmodel/application/auto_correlate_litho_bodies.py` | Formation-level auto-correlate — superseded. |
| `src/groundmodel/domain/services/auto_correlate.py` | Formation-level pure algo — superseded. |
| `src/groundmodel/domain/services/auto_correlate_constants.py` | Formation-level constants — superseded (after MNN helper extraction). |
| `src/groundmodel/infrastructure/db/models/litho_correlation_edge_orm.py` | Table dropped. |
| `src/groundmodel/api/routers/geology/correlations.py` | Formation-level routes. |
| `src/groundmodel/api/schemas/project/litho_correlation/litho_correlation_schemas.py` (and `__init__.py`) | Formation-level schemas. |
| Tests covering deleted use cases (full list in Task 25). | Stale. |

---

## Task 1: Add `user_approved` column to `litho_contact_correlation_edge` (Alembic)

**Files:**
- Create: `src/groundmodel/infrastructure/db/migrations/versions/<rev1>_add_user_approved_to_litho_contact_correlation_edge.py`
- Modify: `src/groundmodel/infrastructure/db/models/litho_contact_correlation_edge_orm.py`

- [ ] **Step 1: Generate the Alembic migration scaffold**

Run:
```powershell
uv run alembic revision -m "add user_approved to litho_contact_correlation_edge"
```
Note the new file path printed; the `<rev1>` token in this plan refers to it.

- [ ] **Step 2: Fill in the migration body**

Open the new file under `src/groundmodel/infrastructure/db/migrations/versions/`. Replace its `upgrade`/`downgrade` with:

```python
"""add user_approved to litho_contact_correlation_edge

Revision ID: <auto>
Revises: <previous head>
Create Date: 2026-05-26 ...
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "<auto>"
down_revision = "<previous head>"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add user_approved bool column; existing rows (all manual) default TRUE."""
    op.add_column(
        "litho_contact_correlation_edge",
        sa.Column(
            "user_approved",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )


def downgrade() -> None:
    """Drop the column (reverses the add)."""
    op.drop_column("litho_contact_correlation_edge", "user_approved")
```

Keep `<auto>` / `<previous head>` Alembic left in place; only edit the column-level statements.

- [ ] **Step 3: Add the column to the ORM model**

Modify `src/groundmodel/infrastructure/db/models/litho_contact_correlation_edge_orm.py`:

Find the `source` column declaration and add immediately below:

```python
    # User-approved flag — distinguishes auto-proposed edges (False) from
    # manual #135 gestures and accepted auto edges (True).  The lens detector
    # filters to user_approved=True only; auto edges are speculative until
    # the user clicks "Accept correlations" on the section.  Default TRUE so
    # all existing Phase 1 manual edges migrate forward as approved.
    user_approved: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default="true",
    )
```

If `Boolean` is not yet imported at the top, add it to the existing `from sqlalchemy import ...` line.

- [ ] **Step 4: Run the migration against the dev DB**

```powershell
uv run alembic upgrade head
```
Expected: the new migration applies cleanly. Verify with:
```powershell
docker exec strix-db-1 psql -U groundmodel -d groundmodel -c "\d litho_contact_correlation_edge"
```
Expected: `user_approved | boolean | not null | default true` appears in the column listing.

- [ ] **Step 5: Run the integration DB migration too**

```powershell
.\scripts\run-integration-tests.ps1 --collect-only
```
Expected: collection succeeds (Alembic auto-applies via the wrapper).

- [ ] **Step 6: Commit**

```powershell
git add src/groundmodel/infrastructure/db/migrations/versions/ src/groundmodel/infrastructure/db/models/litho_contact_correlation_edge_orm.py
git commit -m "feat(schema): add user_approved column to litho_contact_correlation_edge"
```

---

## Task 2: Extract the MNN helper from `auto_correlate.py`

**Files:**
- Create: `src/groundmodel/domain/services/auto_correlate_helpers.py`
- Modify: `src/groundmodel/domain/services/auto_correlate.py` (import from helpers; remove local def)

- [ ] **Step 1: Locate the existing MNN helper in `auto_correlate.py`**

Open `src/groundmodel/domain/services/auto_correlate.py`. Find the `mutual_nearest_neighbour` function (or whatever it's named; should be near the top with `robust_slope_fit`).

- [ ] **Step 2: Create the helpers module**

Create `src/groundmodel/domain/services/auto_correlate_helpers.py`:

```python
"""Shared helpers for the auto-correlate algorithms.

These helpers were originally defined inline in ``auto_correlate.py``
(formation-level, #127).  Phase 2+3 of #133 extracts them so the new
contact-level algorithm (``auto_correlate_contact_edges.py``) can reuse
them without depending on the formation-level module — which is being
removed in this same slice.

The module is pure: no I/O, no ORM, no SQLAlchemy, no FastAPI, no logging.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Generic, TypeVar
from uuid import UUID

T = TypeVar("T")


@dataclass(frozen=True)
class _Candidate(Generic[T]):
    """Internal MNN row: source id, target id, score (lower is better)."""

    source_id: UUID
    target_id: UUID
    score: float
    payload: T


def mutual_nearest_neighbour(
    candidates: list[_Candidate[T]],
) -> list[_Candidate[T]]:
    """Filter a candidate list to mutually-nearest-neighbour pairs.

    A pair (A, B) survives iff A is B's lowest-scoring candidate among all
    candidates where B is the target, AND B is A's lowest-scoring candidate
    among all candidates where A is the source.  Ties are broken by lower
    target_id (deterministic).

    Parameters
    ----------
    candidates : list[_Candidate[T]]
        Pre-filtered candidate pairs.

    Returns
    -------
    list[_Candidate[T]]
        The MNN-surviving subset.
    """
    # Index by source.
    best_per_source: dict[UUID, _Candidate[T]] = {}
    for c in candidates:
        cur = best_per_source.get(c.source_id)
        if cur is None or (c.score, c.target_id) < (cur.score, cur.target_id):
            best_per_source[c.source_id] = c

    # Index by target.
    best_per_target: dict[UUID, _Candidate[T]] = {}
    for c in candidates:
        cur = best_per_target.get(c.target_id)
        if cur is None or (c.score, c.source_id) < (cur.score, cur.source_id):
            best_per_target[c.target_id] = c

    # Mutual survivors.
    survivors: list[_Candidate[T]] = []
    for c in candidates:
        if (
            best_per_source.get(c.source_id) is c
            and best_per_target.get(c.target_id) is c
        ):
            survivors.append(c)
    return survivors
```

(If the existing `mutual_nearest_neighbour` has a different shape, mirror it exactly; the goal of this task is *extract*, not *rewrite*.)

- [ ] **Step 3: Add a unit test for the helper**

Create `tests/unit/domain/services/test_auto_correlate_helpers.py`:

```python
"""Unit tests for auto_correlate_helpers (MNN extraction)."""

from __future__ import annotations

from uuid import UUID, uuid4

from groundmodel.domain.services.auto_correlate_helpers import (
    _Candidate,
    mutual_nearest_neighbour,
)


def _make_uuid(seed: int) -> UUID:
    """Deterministic UUID for test fixtures."""
    return UUID(int=seed)


def test_mnn_empty_returns_empty() -> None:
    """No candidates → no survivors."""
    assert mutual_nearest_neighbour([]) == []


def test_mnn_keeps_mutual_pair() -> None:
    """Two candidates A↔B with no competitors → both survive (one row)."""
    a = _make_uuid(1)
    b = _make_uuid(2)
    cands = [_Candidate(source_id=a, target_id=b, score=0.5, payload=None)]
    assert mutual_nearest_neighbour(cands) == cands


def test_mnn_drops_non_mutual() -> None:
    """A→B is best for A but B prefers C → drop the pair."""
    a = _make_uuid(1)
    b = _make_uuid(2)
    c = _make_uuid(3)
    cands = [
        _Candidate(source_id=a, target_id=b, score=0.5, payload="a-b"),
        _Candidate(source_id=c, target_id=b, score=0.3, payload="c-b"),
    ]
    survivors = mutual_nearest_neighbour(cands)
    assert len(survivors) == 1
    assert survivors[0].payload == "c-b"
```

- [ ] **Step 4: Run the helper test, expect PASS**

```powershell
uv run pytest tests/unit/domain/services/test_auto_correlate_helpers.py -v
```
Expected: 3 PASSED.

- [ ] **Step 5: Update `auto_correlate.py` to import from the helper**

In `src/groundmodel/domain/services/auto_correlate.py`: delete the local `mutual_nearest_neighbour` definition and add at the top of the imports:

```python
from groundmodel.domain.services.auto_correlate_helpers import (
    mutual_nearest_neighbour,
)
```

- [ ] **Step 6: Run the existing formation-level tests, expect PASS**

```powershell
uv run pytest tests/unit/domain/services/test_auto_correlate.py -v
```
Expected: all formation-level tests still PASS (they exercise `mutual_nearest_neighbour` via the formation-level `auto_correlate_litho_bodies`).

- [ ] **Step 7: Commit**

```powershell
git add src/groundmodel/domain/services/auto_correlate_helpers.py src/groundmodel/domain/services/auto_correlate.py tests/unit/domain/services/test_auto_correlate_helpers.py
git commit -m "refactor(domain): extract mutual_nearest_neighbour helper from auto_correlate"
```

---

## Task 3: Pure-domain `auto_correlate_contact_edges` algorithm

**Files:**
- Create: `src/groundmodel/domain/services/auto_correlate_contact_edges_constants.py`
- Create: `src/groundmodel/domain/services/auto_correlate_contact_edges.py`
- Test: `tests/unit/domain/services/test_auto_correlate_contact_edges.py`

- [ ] **Step 1: Create the constants module**

Create `src/groundmodel/domain/services/auto_correlate_contact_edges_constants.py`:

```python
"""Constants for the contact-level auto-correlate algorithm (#133 Phase 2+3).

Mirror the formation-level defaults from #127 where they apply.  The
Theil-Sen dip transfer is intentionally absent here (per the spec — the
simpler depth-window algorithm caught the Accept-flow safety net).
"""

from __future__ import annotations

# Largest column-to-column distance at which a candidate pair is considered.
# Beyond this, geological correlation is unreliable without per-project
# input from the engineer.
MAX_COLUMN_DISTANCE_M: float = 200.0

# Base depth window — two contacts in the same boundary-signature group
# whose depth difference is below this threshold are eligible to pair.
BASE_DEPTH_THRESHOLD_M: float = 0.5

# Per-metre column-distance contribution to the depth window.  At 200 m
# column distance the window expands by 0.4 m → 0.9 m total.  Captures
# the soft dip effect without the Theil-Sen helper.
DISTANCE_FACTOR: float = 0.002

# Provenance token written to the source column on edges proposed by the
# algorithm.  ``user_approved`` defaults to False on insert; the Accept
# flow flips it to True.
AUTO_SOURCE: str = "auto"
```

- [ ] **Step 2: Create the domain algorithm — DTOs and signature**

Create `src/groundmodel/domain/services/auto_correlate_contact_edges.py`. Start with the public API (DTOs + `auto_correlate_contact_edges` declaration):

```python
"""Pure domain algorithm — contact-level auto-correlate (#133 Phase 2+3).

Takes a snapshot of contacts + investigation locations + lithology context,
returns ``ContactCorrelationCandidate`` rows the application layer may
persist as ``litho_contact_correlation_edge`` records with
``user_approved=False``.

No I/O, no ORM, no SQLAlchemy, no FastAPI, no logging.  The caller owns
all side effects.

Algorithm
---------
1. Group contacts by boundary signature
   ``(parent_formation_id, litho_main_soil_code, litho_below_code)`` —
   the third element ensures we only match horizons that have the same
   lithology above AND below.  ``litho_below_code`` is ``None`` for the
   deepest contact on a column; nulls match only against nulls.
2. Per column-pair within ``MAX_COLUMN_DISTANCE_M``: pair contacts whose
   ``|depth_A - depth_B| < BASE_DEPTH_THRESHOLD_M + DISTANCE_FACTOR · column_distance``.
3. Mutual-nearest-neighbour disambiguation.
4. Emit canonical-ordered ``(contact_a_id, contact_b_id)`` candidates.

No Theil-Sen dip transfer — see spec for the trade-off discussion.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from uuid import UUID

from groundmodel.domain.services.auto_correlate_contact_edges_constants import (
    AUTO_SOURCE,
    BASE_DEPTH_THRESHOLD_M,
    DISTANCE_FACTOR,
    MAX_COLUMN_DISTANCE_M,
)
from groundmodel.domain.services.auto_correlate_helpers import (
    _Candidate,
    mutual_nearest_neighbour,
)


@dataclass(frozen=True)
class ContactRecord:
    """Minimal snapshot of one formation_contact for the algorithm.

    Attributes
    ----------
    contact_id : UUID
        Primary key.
    formation_id : UUID
        The formation this contact is the top of.
    investigation_id : UUID
        The CPT or borehole the contact is anchored to.
    depth_top_m : float
        Contact depth below the investigation collar (metres).
    parent_formation_id : UUID | None
        Parent geological formation id.  ``None`` for litho units without
        a parent (shouldn't happen in v1.0 — defensive).
    litho_main_soil_code : str
        BaseLithology token (ZAND / KLEI / SILT / GRIND / VEEN).
    litho_below_code : str | None
        Lithology of the formation immediately deeper on the same column.
        ``None`` when this is the deepest contact on the column.
    """

    contact_id: UUID
    formation_id: UUID
    investigation_id: UUID
    depth_top_m: float
    parent_formation_id: UUID | None
    litho_main_soil_code: str
    litho_below_code: str | None


@dataclass(frozen=True)
class InvestigationLocation:
    """Planar location of one investigation (CPT or borehole)."""

    investigation_id: UUID
    x: float
    y: float


@dataclass(frozen=True)
class AutoCorrelateContactParams:
    """Tunable inputs.  Defaults from the constants module."""

    max_column_distance_m: float = MAX_COLUMN_DISTANCE_M
    base_depth_threshold_m: float = BASE_DEPTH_THRESHOLD_M
    distance_factor: float = DISTANCE_FACTOR


@dataclass(frozen=True)
class ContactCorrelationCandidate:
    """One proposed correlation edge.

    Endpoints are canonical-ordered (``min(a, b), max(a, b)``).
    """

    contact_a_id: UUID
    contact_b_id: UUID
    source: str = AUTO_SOURCE


def _dist(a: InvestigationLocation, b: InvestigationLocation) -> float:
    """Euclidean distance between two investigation locations (metres)."""
    return math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)


def auto_correlate_contact_edges(
    contacts: list[ContactRecord],
    locations: list[InvestigationLocation],
    params: AutoCorrelateContactParams | None = None,
) -> list[ContactCorrelationCandidate]:
    """Run the contact-level auto-correlate algorithm.

    Returns ``ContactCorrelationCandidate`` rows the application layer
    may insert with ``user_approved=False``.  Always returns canonical-
    ordered pairs.  Idempotent for identical inputs.
    """
    p = params or AutoCorrelateContactParams()
    loc_by_id = {loc.investigation_id: loc for loc in locations}

    # Group by boundary signature.
    groups: dict[tuple[UUID | None, str, str | None], list[ContactRecord]] = {}
    for c in contacts:
        key = (c.parent_formation_id, c.litho_main_soil_code, c.litho_below_code)
        groups.setdefault(key, []).append(c)

    out: list[ContactCorrelationCandidate] = []

    # Per group, build candidate pairs across column-pairs within distance.
    for group_contacts in groups.values():
        # Bucket contacts by investigation_id for fast pair iteration.
        by_inv: dict[UUID, list[ContactRecord]] = {}
        for c in group_contacts:
            by_inv.setdefault(c.investigation_id, []).append(c)

        inv_ids = list(by_inv.keys())
        candidates: list[_Candidate[tuple[UUID, UUID]]] = []
        for i in range(len(inv_ids)):
            for j in range(i + 1, len(inv_ids)):
                inv_a = inv_ids[i]
                inv_b = inv_ids[j]
                loc_a = loc_by_id.get(inv_a)
                loc_b = loc_by_id.get(inv_b)
                if loc_a is None or loc_b is None:
                    continue
                col_dist = _dist(loc_a, loc_b)
                if col_dist > p.max_column_distance_m:
                    continue
                window = p.base_depth_threshold_m + p.distance_factor * col_dist
                for ca in by_inv[inv_a]:
                    for cb in by_inv[inv_b]:
                        residual = abs(ca.depth_top_m - cb.depth_top_m)
                        if residual < window:
                            # Use min(a, b) as source for symmetric MNN.
                            sid = min(ca.contact_id, cb.contact_id)
                            tid = max(ca.contact_id, cb.contact_id)
                            candidates.append(
                                _Candidate(
                                    source_id=sid,
                                    target_id=tid,
                                    score=residual,
                                    payload=(sid, tid),
                                )
                            )

        # MNN disambiguation.
        for survivor in mutual_nearest_neighbour(candidates):
            a_id, b_id = survivor.payload
            out.append(ContactCorrelationCandidate(contact_a_id=a_id, contact_b_id=b_id))

    return out
```

- [ ] **Step 3: Write the failing unit tests**

Create `tests/unit/domain/services/test_auto_correlate_contact_edges.py`:

```python
"""Unit tests for contact-level auto-correlate (#133 Phase 2+3)."""

from __future__ import annotations

from uuid import UUID, uuid4

from groundmodel.domain.services.auto_correlate_contact_edges import (
    AutoCorrelateContactParams,
    ContactCorrelationCandidate,
    ContactRecord,
    InvestigationLocation,
    auto_correlate_contact_edges,
)


def _uid(n: int) -> UUID:
    return UUID(int=n)


def _make_contact(
    cid: int,
    inv_id: int,
    depth: float,
    parent: int,
    above: str,
    below: str | None,
    formation: int | None = None,
) -> ContactRecord:
    return ContactRecord(
        contact_id=_uid(cid),
        formation_id=_uid(formation or cid),
        investigation_id=_uid(inv_id),
        depth_top_m=depth,
        parent_formation_id=_uid(parent),
        litho_main_soil_code=above,
        litho_below_code=below,
    )


def test_happy_path_three_columns_two_boundaries_each() -> None:
    """Three columns at distance 50 m apart, each with a sand-on-clay
    boundary at ~5 m and a clay-on-silt boundary at ~10 m → MNN converges
    to 2 horizontal pairs per group × 3 column-pairs = 6 candidates."""
    contacts = [
        _make_contact(1, 10, 5.0, 99, "ZAND", "KLEI"),
        _make_contact(2, 10, 10.0, 99, "KLEI", "SILT"),
        _make_contact(3, 11, 5.1, 99, "ZAND", "KLEI"),
        _make_contact(4, 11, 10.1, 99, "KLEI", "SILT"),
        _make_contact(5, 12, 5.2, 99, "ZAND", "KLEI"),
        _make_contact(6, 12, 10.2, 99, "KLEI", "SILT"),
    ]
    locations = [
        InvestigationLocation(_uid(10), 0.0, 0.0),
        InvestigationLocation(_uid(11), 50.0, 0.0),
        InvestigationLocation(_uid(12), 100.0, 0.0),
    ]
    result = auto_correlate_contact_edges(contacts, locations)
    # 3 column-pairs × 2 boundaries = 6 candidates
    assert len(result) == 6


def test_boundary_signature_filter_rejects_different_below_litho() -> None:
    """Same above-litho, different below-litho → no candidate."""
    contacts = [
        _make_contact(1, 10, 5.0, 99, "ZAND", "KLEI"),
        _make_contact(2, 11, 5.0, 99, "ZAND", "SILT"),
    ]
    locations = [
        InvestigationLocation(_uid(10), 0.0, 0.0),
        InvestigationLocation(_uid(11), 50.0, 0.0),
    ]
    assert auto_correlate_contact_edges(contacts, locations) == []


def test_null_below_litho_matches_only_other_nulls() -> None:
    """Two deepest-contact (None below) sand contacts match each other.
    A sand-below-something contact in another column does NOT match them."""
    contacts = [
        _make_contact(1, 10, 5.0, 99, "ZAND", None),
        _make_contact(2, 11, 5.1, 99, "ZAND", None),
        _make_contact(3, 12, 5.0, 99, "ZAND", "KLEI"),
    ]
    locations = [
        InvestigationLocation(_uid(10), 0.0, 0.0),
        InvestigationLocation(_uid(11), 50.0, 0.0),
        InvestigationLocation(_uid(12), 100.0, 0.0),
    ]
    result = auto_correlate_contact_edges(contacts, locations)
    assert len(result) == 1
    pair = result[0]
    # Canonical-ordered: contacts 1 and 2.
    assert {pair.contact_a_id, pair.contact_b_id} == {_uid(1), _uid(2)}


def test_distance_gate_rejects_far_pairs() -> None:
    """Column-pair beyond MAX_COLUMN_DISTANCE_M produces no candidates."""
    contacts = [
        _make_contact(1, 10, 5.0, 99, "ZAND", "KLEI"),
        _make_contact(2, 11, 5.0, 99, "ZAND", "KLEI"),
    ]
    locations = [
        InvestigationLocation(_uid(10), 0.0, 0.0),
        InvestigationLocation(_uid(11), 300.0, 0.0),
    ]
    assert auto_correlate_contact_edges(contacts, locations) == []


def test_mnn_tie_breaking() -> None:
    """A at depth 5.0; B and B' both at 5.4 (same residual). MNN should
    keep exactly one pair (the deterministic winner)."""
    contacts = [
        _make_contact(1, 10, 5.0, 99, "ZAND", "KLEI"),
        _make_contact(2, 11, 5.4, 99, "ZAND", "KLEI"),
        _make_contact(3, 11, 5.4, 99, "ZAND", "KLEI"),
    ]
    locations = [
        InvestigationLocation(_uid(10), 0.0, 0.0),
        InvestigationLocation(_uid(11), 50.0, 0.0),
    ]
    result = auto_correlate_contact_edges(contacts, locations)
    # MNN picks one of the two equal candidates deterministically.
    assert len(result) == 1
```

- [ ] **Step 4: Run unit tests, expect PASS**

```powershell
uv run pytest tests/unit/domain/services/test_auto_correlate_contact_edges.py -v
```
Expected: 5 PASSED. If any FAILs, fix the algorithm/test until green.

- [ ] **Step 5: Format + commit**

```powershell
uv run ruff format src/groundmodel/domain/services/auto_correlate_contact_edges.py src/groundmodel/domain/services/auto_correlate_contact_edges_constants.py tests/unit/domain/services/test_auto_correlate_contact_edges.py
uv run ruff check --fix src/groundmodel/domain/services/auto_correlate_contact_edges.py src/groundmodel/domain/services/auto_correlate_contact_edges_constants.py tests/unit/domain/services/test_auto_correlate_contact_edges.py
git add src/groundmodel/domain/services/auto_correlate_contact_edges.py src/groundmodel/domain/services/auto_correlate_contact_edges_constants.py tests/unit/domain/services/test_auto_correlate_contact_edges.py
git commit -m "feat(domain): contact-level auto-correlate algorithm (no Theil-Sen)"
```

---

## Task 4: Pure-domain `detect_lenses_from_graph`

**Files:**
- Create: `src/groundmodel/domain/services/detect_lenses_from_graph.py`
- Test: `tests/unit/domain/services/test_detect_lenses_from_graph.py`

- [ ] **Step 1: Create the domain module**

Create `src/groundmodel/domain/services/detect_lenses_from_graph.py`:

```python
"""Pure domain algorithm — lens detection from the #135 topology (#133 Phase 2+3).

Consumes the user-approved contact-edge graph plus per-investigation
contact stacks; returns ``LensCandidate`` rows the application layer
materialises as ``LithoLensOrm`` records.

Topology
--------
A lens body is detected iff two distinct source contacts on the same
investigation A both have a correlation edge to the same target contact
on another investigation B.  The layer living between the two source
contacts on A is the lens body — it exists on A but pinches out to a
single boundary at B.

Generalisation: N source contacts on A converging on one target on B
produce (N-1) stacked lens candidates (between adjacent source pairs).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True)
class ContactStackEntry:
    """One contact within an investigation's depth-sorted stack."""

    contact_id: UUID
    formation_id: UUID
    depth_top_m: float


@dataclass(frozen=True)
class ContactStack:
    """All contacts on one investigation, sorted by depth_top_m ascending."""

    investigation_id: UUID
    entries: tuple[ContactStackEntry, ...]


@dataclass(frozen=True)
class ContactEdge:
    """User-approved contact-correlation edge.  Canonical-ordered endpoints."""

    contact_a_id: UUID
    contact_b_id: UUID


@dataclass(frozen=True)
class LensCandidate:
    """One detected lens body."""

    formation_id: UUID
    contact_above_id: UUID
    contact_below_id: UUID
    source_investigation_id: UUID
    target_investigation_id: UUID
    target_contact_id: UUID


def detect_lenses_from_graph(
    edges: list[ContactEdge],
    stacks: list[ContactStack],
) -> list[LensCandidate]:
    """Detect lens bodies from the user-approved contact-edge graph.

    Parameters
    ----------
    edges : list[ContactEdge]
        ALL edges passed in are assumed user-approved.  The caller filters
        ``user_approved=True`` before calling.
    stacks : list[ContactStack]
        Per-investigation depth-sorted contact stacks.  Each contact_id in
        ``edges`` must appear in exactly one stack.

    Returns
    -------
    list[LensCandidate]
        One candidate per detected lens body.  Order: by
        (source_investigation_id, depth_above, depth_below) for determinism.
    """
    # Index: contact_id → (investigation_id, formation_id, depth)
    contact_meta: dict[UUID, tuple[UUID, UUID, float]] = {}
    # Index: investigation_id → ordered list of (depth, contact_id, formation_id)
    stack_index: dict[UUID, list[tuple[float, UUID, UUID]]] = {}
    for stack in stacks:
        ordered = sorted((e.depth_top_m, e.contact_id, e.formation_id) for e in stack.entries)
        stack_index[stack.investigation_id] = ordered
        for depth, cid, fid in ordered:
            contact_meta[cid] = (stack.investigation_id, fid, depth)

    # Build adjacency: contact_id → list of neighbour contact ids.
    neighbours: dict[UUID, list[UUID]] = defaultdict(list)
    for e in edges:
        neighbours[e.contact_a_id].append(e.contact_b_id)
        neighbours[e.contact_b_id].append(e.contact_a_id)

    out: list[LensCandidate] = []

    # For each target contact t, group its neighbours by their investigation.
    # Any group with ≥2 distinct contacts is the #135 topology.
    for target_id, neigh in neighbours.items():
        target_meta = contact_meta.get(target_id)
        if target_meta is None:
            continue
        target_inv_id, _, _ = target_meta

        by_inv: dict[UUID, list[tuple[float, UUID, UUID]]] = defaultdict(list)
        for n_id in neigh:
            n_meta = contact_meta.get(n_id)
            if n_meta is None:
                continue
            n_inv_id, n_fid, n_depth = n_meta
            if n_inv_id == target_inv_id:
                # Self-loop guard at use-case level prevents this; defensive.
                continue
            by_inv[n_inv_id].append((n_depth, n_id, n_fid))

        for source_inv_id, source_neigh in by_inv.items():
            if len(source_neigh) < 2:
                continue
            source_neigh.sort()  # by depth ascending
            # Adjacent pairs: (i, i+1) — yields N-1 stacked lens candidates.
            stack = stack_index.get(source_inv_id, [])
            stack_by_depth = {entry[1]: entry for entry in stack}
            for k in range(len(source_neigh) - 1):
                d_above, cid_above, _ = source_neigh[k]
                d_below, cid_below, _ = source_neigh[k + 1]

                # The lens body is the formation living between these two
                # contacts on the source investigation.  Walk the stack:
                # the lens body's formation is the one whose contact is at
                # cid_above's depth (its top is cid_above; its bottom is the
                # next deeper contact, which should be cid_below).
                body_formation_id: UUID | None = None
                for depth, cid, fid in stack:
                    if cid == cid_above:
                        body_formation_id = fid
                        break
                if body_formation_id is None:
                    continue  # source contact not in stack — defensive

                out.append(
                    LensCandidate(
                        formation_id=body_formation_id,
                        contact_above_id=cid_above,
                        contact_below_id=cid_below,
                        source_investigation_id=source_inv_id,
                        target_investigation_id=target_inv_id,
                        target_contact_id=target_id,
                    )
                )

    # Deterministic order.
    out.sort(
        key=lambda c: (
            str(c.source_investigation_id),
            str(c.contact_above_id),
            str(c.contact_below_id),
        )
    )
    return out
```

- [ ] **Step 2: Write the failing unit tests**

Create `tests/unit/domain/services/test_detect_lenses_from_graph.py`:

```python
"""Unit tests for detect_lenses_from_graph (#133 Phase 2+3 / consumes #135 topology)."""

from __future__ import annotations

from uuid import UUID

from groundmodel.domain.services.detect_lenses_from_graph import (
    ContactEdge,
    ContactStack,
    ContactStackEntry,
    detect_lenses_from_graph,
)


def _uid(n: int) -> UUID:
    return UUID(int=n)


def test_happy_path_single_lens() -> None:
    """Column A has contacts c1 (sand top) at 2 m, c2 (clay top) at 5 m,
    c3 (deepest) at 8 m → silt body between c1 and c2 is the lens.
    Column B has contact c10 at 3 m.  Both c1↔c10 and c2↔c10 are approved.
    Lens detector should emit ONE candidate: silt body on A between c1 and c2."""
    stacks = [
        ContactStack(
            investigation_id=_uid(100),
            entries=(
                ContactStackEntry(_uid(1), _uid(1000), 2.0),  # sand top
                ContactStackEntry(_uid(2), _uid(1001), 5.0),  # silt body (lens)
                ContactStackEntry(_uid(3), _uid(1002), 8.0),  # clay
            ),
        ),
        ContactStack(
            investigation_id=_uid(200),
            entries=(
                ContactStackEntry(_uid(10), _uid(1003), 3.0),  # sand-clay boundary on B
            ),
        ),
    ]
    edges = [
        ContactEdge(_uid(1), _uid(10)),
        ContactEdge(_uid(2), _uid(10)),
    ]
    result = detect_lenses_from_graph(edges, stacks)
    assert len(result) == 1
    lens = result[0]
    assert lens.contact_above_id == _uid(1)
    assert lens.contact_below_id == _uid(2)
    assert lens.target_contact_id == _uid(10)
    assert lens.target_investigation_id == _uid(200)
    assert lens.source_investigation_id == _uid(100)
    assert lens.formation_id == _uid(1001)  # the silt body


def test_one_to_one_edges_no_lens() -> None:
    """Only 1-to-1 edges in the graph → empty result."""
    stacks = [
        ContactStack(_uid(100), (ContactStackEntry(_uid(1), _uid(1000), 2.0),)),
        ContactStack(_uid(200), (ContactStackEntry(_uid(10), _uid(1003), 3.0),)),
    ]
    edges = [ContactEdge(_uid(1), _uid(10))]
    assert detect_lenses_from_graph(edges, stacks) == []


def test_empty_graph() -> None:
    """No edges → empty result."""
    assert detect_lenses_from_graph([], []) == []


def test_stacked_lenses() -> None:
    """Three source contacts on A all edged to one target on B → 2 lens
    candidates (between contacts 1-2 and 2-3)."""
    stacks = [
        ContactStack(
            _uid(100),
            (
                ContactStackEntry(_uid(1), _uid(1000), 2.0),
                ContactStackEntry(_uid(2), _uid(1001), 5.0),
                ContactStackEntry(_uid(3), _uid(1002), 8.0),
                ContactStackEntry(_uid(4), _uid(1003), 11.0),
            ),
        ),
        ContactStack(
            _uid(200),
            (ContactStackEntry(_uid(10), _uid(1004), 3.0),),
        ),
    ]
    edges = [
        ContactEdge(_uid(1), _uid(10)),
        ContactEdge(_uid(2), _uid(10)),
        ContactEdge(_uid(3), _uid(10)),
    ]
    result = detect_lenses_from_graph(edges, stacks)
    assert len(result) == 2
    # Verify the two stacked pairs are present.
    pairs = {(c.contact_above_id, c.contact_below_id) for c in result}
    assert (_uid(1), _uid(2)) in pairs
    assert (_uid(2), _uid(3)) in pairs


def test_two_independent_lens_topologies() -> None:
    """Two unrelated lens topologies in the same model → 2 candidates."""
    stacks = [
        ContactStack(
            _uid(100),
            (
                ContactStackEntry(_uid(1), _uid(1000), 2.0),
                ContactStackEntry(_uid(2), _uid(1001), 5.0),
            ),
        ),
        ContactStack(_uid(200), (ContactStackEntry(_uid(10), _uid(1002), 3.0),)),
        ContactStack(
            _uid(300),
            (
                ContactStackEntry(_uid(20), _uid(1003), 4.0),
                ContactStackEntry(_uid(21), _uid(1004), 7.0),
            ),
        ),
        ContactStack(_uid(400), (ContactStackEntry(_uid(30), _uid(1005), 5.0),)),
    ]
    edges = [
        ContactEdge(_uid(1), _uid(10)),
        ContactEdge(_uid(2), _uid(10)),
        ContactEdge(_uid(20), _uid(30)),
        ContactEdge(_uid(21), _uid(30)),
    ]
    result = detect_lenses_from_graph(edges, stacks)
    assert len(result) == 2
```

- [ ] **Step 3: Run the tests, expect PASS**

```powershell
uv run pytest tests/unit/domain/services/test_detect_lenses_from_graph.py -v
```
Expected: 5 PASSED. Fix until green.

- [ ] **Step 4: Format + commit**

```powershell
uv run ruff format src/groundmodel/domain/services/detect_lenses_from_graph.py tests/unit/domain/services/test_detect_lenses_from_graph.py
uv run ruff check --fix src/groundmodel/domain/services/detect_lenses_from_graph.py tests/unit/domain/services/test_detect_lenses_from_graph.py
git add src/groundmodel/domain/services/detect_lenses_from_graph.py tests/unit/domain/services/test_detect_lenses_from_graph.py
git commit -m "feat(domain): detect_lenses_from_graph — #135 topology consumer"
```

---

## Task 5: Rewrite `ResolveLithoInstances` to consume contact edges

**Files:**
- Modify: `src/groundmodel/domain/services/resolve_litho_instances.py` (rewrite the graph-build step)
- Modify: `src/groundmodel/application/resolve_litho_instances_use_case.py` (load contact edges instead of formation edges)
- Existing test: `tests/integration/application/test_resolve_litho_instances.py` (probably named — verify; update inputs)
- Create: `tests/integration/application/test_resolve_litho_instances_contact_based.py` (additional cases)

- [ ] **Step 1: Read the existing resolver to map what changes**

```powershell
code src/groundmodel/domain/services/resolve_litho_instances.py
```
The existing `_find_components` (or similar) reads `CorrelationEdge` rows that point to `formation_a_id` / `formation_b_id`. The change is in how these `CorrelationEdge` records are *built* — they're now derived from contact edges in the use case layer.

- [ ] **Step 2: Adjust the application use case to load contact edges**

In `src/groundmodel/application/resolve_litho_instances_use_case.py`, replace the section that loads `LithoCorrelationEdgeOrm` rows with a load of `LithoContactCorrelationEdgeOrm` filtered to `user_approved=True`. For each contact edge, derive a `CorrelationEdge` (formation-to-formation) by mapping each contact_id to its formation_id via a preloaded contact dict.

Pseudo-code outline (adapt to the existing structure):

```python
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)

# ... inside execute() ...

# Load all user-approved contact edges for the model.
contact_edges_stmt = select(LithoContactCorrelationEdgeOrm).where(
    LithoContactCorrelationEdgeOrm.model_id == model_id,
    LithoContactCorrelationEdgeOrm.user_approved.is_(True),
)
contact_edges = (await self._session.execute(contact_edges_stmt)).scalars().all()

# Load all contacts to map contact_id → formation_id.
contacts_stmt = select(FormationContactOrm.id, FormationContactOrm.formation_id).where(
    FormationContactOrm.model_id == model_id,
)
formation_by_contact: dict[UUID, UUID] = dict(
    (await self._session.execute(contacts_stmt)).all()
)

# Derive formation-level edges from contact-level edges.
derived_edges: list[CorrelationEdge] = []
for ce in contact_edges:
    fa = formation_by_contact.get(ce.contact_a_id)
    fb = formation_by_contact.get(ce.contact_b_id)
    if fa is None or fb is None or fa == fb:
        # Skip self-loops (both contacts in the same formation) and orphans.
        continue
    derived_edges.append(CorrelationEdge(formation_a_id=fa, formation_b_id=fb))

# Pass derived_edges to resolve_litho_instances exactly as the old code
# passed the formation-level edges.
```

The pure-domain `resolve_litho_instances` function signature stays the same (it takes a list of `CorrelationEdge`); only its data source changes.

- [ ] **Step 3: Update the existing integration test for the resolver**

If `tests/integration/application/test_resolve_litho_instances.py` exists, update its fixture to seed `LithoContactCorrelationEdgeOrm` rows (with `user_approved=True`) instead of `LithoCorrelationEdgeOrm` rows. Mirror each formation-level edge with two contact-level edges (one per endpoint formation's "shallowest contact" — the design rationale matches Phase 3's projection).

If the file does NOT exist, create:

```python
"""Integration test for the rewritten ResolveLithoInstances (#133 Phase 2+3).

Verifies that the resolver now derives the formation graph from
contact edges rather than formation-level edges, but produces the
same ordinal output for equivalent topologies.
"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.resolve_litho_instances_use_case import (
    ResolveLithoInstances,
)
# Fixture imports — adapt to the existing conftest helpers in tests/integration/.
# (Look at tests/integration/conftest.py and reuse the litho_model_factory or
# similar; do NOT roll a new factory if one exists.)


@pytest.mark.asyncio
async def test_resolver_assigns_ordinal_zero_to_a_connected_component(
    session: AsyncSession,
    # factories: litho_model_factory, formation_factory, contact_factory,
    # contact_correlation_factory  — replace with the real fixture names
) -> None:
    """Two formations linked via contact edge → one connected component →
    both get instance_ordinal=0."""
    # ... build the fixture per existing patterns ...
    # ... call ResolveLithoInstances(session).execute(model_id=...) ...
    # ... assert both formations now have instance_ordinal == 0 ...
    pass


@pytest.mark.asyncio
async def test_resolver_ignores_unapproved_contact_edges(
    session: AsyncSession,
) -> None:
    """An auto-proposed (user_approved=False) edge between two formations
    does NOT form a connected component → each formation keeps a separate
    instance_ordinal (0 and 1 respectively)."""
    # ... build fixture ...
    # ... assert formations get DIFFERENT ordinals ...
    pass


@pytest.mark.asyncio
async def test_resolver_respects_instance_ordinal_locked(
    session: AsyncSession,
) -> None:
    """A formation with instance_ordinal_locked=True keeps its ordinal even
    when topology would re-assign it.  Other formations flow around it."""
    # ... build fixture ...
    pass
```

(Plan note: filling in fixture details depends on the existing conftest. The implementer should mirror existing tests in `tests/integration/application/` for factory usage.)

- [ ] **Step 4: Run the integration tests, expect PASS**

```powershell
.\scripts\run-integration-tests.ps1 tests/integration/application/test_resolve_litho_instances_contact_based.py -v
```
Expected: tests pass against the new derivation. If the existing `test_resolve_litho_instances.py` has cases that depended on formation-level edge insertion, update them to insert contact-level edges instead.

- [ ] **Step 5: Run ALL integration tests for the resolver area**

```powershell
.\scripts\run-integration-tests.ps1 tests/integration/application/ -k "resolve or litho" -v
```
Expected: no regressions.

- [ ] **Step 6: Commit**

```powershell
uv run ruff format src/groundmodel/domain/services/resolve_litho_instances.py src/groundmodel/application/resolve_litho_instances_use_case.py tests/integration/application/test_resolve_litho_instances_contact_based.py
git add src/groundmodel/domain/services/resolve_litho_instances.py src/groundmodel/application/resolve_litho_instances_use_case.py tests/integration/application/test_resolve_litho_instances_contact_based.py
git commit -m "refactor(litho): ResolveLithoInstances now consumes contact edges"
```

---

## Task 6: Rewrite `PropagateCorrelatedLithoAdmixtures` to consume contact edges

**Files:**
- Modify: `src/groundmodel/application/propagate_litho_admixtures.py`
- Create: `tests/integration/application/test_propagate_litho_admixtures_contact_based.py`

- [ ] **Step 1: Inspect the existing implementation**

```powershell
code src/groundmodel/application/propagate_litho_admixtures.py
```
The existing BFS walks `LithoCorrelationEdgeOrm` rows. The change is identical in shape to Task 5: load `LithoContactCorrelationEdgeOrm` (user_approved=True) + contact→formation mapping, derive formation adjacency, then BFS from the seed formation as before.

- [ ] **Step 2: Replace the edge-load query**

In the use case, replace the formation-edge load block with the contact-edge → derived-formation-edge block from Task 5 (Step 2). Reuse the helper if you factored it (you may extract a `_load_derived_formation_edges(session, model_id)` helper in `groundmodel/application/_litho_correlation_helpers.py` — but only if both use cases benefit; otherwise inline).

- [ ] **Step 3: Write the integration test**

Create `tests/integration/application/test_propagate_litho_admixtures_contact_based.py`:

```python
"""Integration test for the rewritten admixture propagation."""

# ... mirror the existing test in test_propagate_litho_admixtures.py
# but build the graph via contact edges. Verify the BFS visits the
# same formations and admixtures land on all of them.
```

(Concrete fixture wiring depends on existing conftest helpers.)

- [ ] **Step 4: Run tests**

```powershell
.\scripts\run-integration-tests.ps1 tests/integration/application/test_propagate_litho_admixtures_contact_based.py -v
.\scripts\run-integration-tests.ps1 tests/integration/application/ -k "admixture or propagate" -v
```
Expected: PASS, no regressions.

- [ ] **Step 5: Commit**

```powershell
uv run ruff format src/groundmodel/application/propagate_litho_admixtures.py tests/integration/application/test_propagate_litho_admixtures_contact_based.py
git add src/groundmodel/application/propagate_litho_admixtures.py tests/integration/application/test_propagate_litho_admixtures_contact_based.py
git commit -m "refactor(litho): PropagateLithoAdmixtures now consumes contact edges"
```

---

## Task 7: `AutoCorrelateContactEdges` use case

**Files:**
- Create: `src/groundmodel/application/auto_correlate_contact_edges.py`
- Create: `tests/integration/application/test_auto_correlate_contact_edges.py`

- [ ] **Step 1: Write the use case**

Create `src/groundmodel/application/auto_correlate_contact_edges.py`:

```python
"""Auto-correlate contact-edges use case — #133 Phase 2+3.

Loads contacts + investigation locations + lithology context, calls the
pure-domain ``auto_correlate_contact_edges`` algorithm, and persists
net-new edges with ``user_approved=False``.  Does NOT call the resolver
or lens detection — auto edges are not approved, so they don't yet
participate in the user's correlation graph.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.domain.services.auto_correlate_contact_edges import (
    AutoCorrelateContactParams,
    ContactRecord,
    InvestigationLocation,
    auto_correlate_contact_edges,
)
from groundmodel.domain.services.auto_correlate_contact_edges_constants import (
    AUTO_SOURCE,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass
class AutoCorrelateContactResult:
    """Outcome counts for the auto-correlate batch."""

    edges_created: int
    edges_skipped_existing: int


class AutoCorrelateContactEdges(GroundModelLogger):
    """Run contact-level auto-correlate for a litho model.

    Idempotent: existing edges (any source, any approval state) are skipped
    via ``ON CONFLICT DO NOTHING``.  Auto edges insert with
    ``user_approved=False`` — the lens detector + resolver do NOT fire
    here; the Accept flow is the trigger.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        *,
        project_id: UUID,
        model_id: UUID,
        params: AutoCorrelateContactParams | None = None,
    ) -> AutoCorrelateContactResult:
        """Run the use case.

        Parameters
        ----------
        project_id : UUID
            Project scope guard.
        model_id : UUID
            The lithostratigraphic model.
        params : AutoCorrelateContactParams | None
            Algorithm tunables.  Defaults via the constants module.

        Returns
        -------
        AutoCorrelateContactResult
            ``edges_created`` (net-new) + ``edges_skipped_existing``.

        Raises
        ------
        ValueError
            When the model does not belong to ``project_id``.
        """
        self.info(f"AutoCorrelateContactEdges.execute: model={model_id} project={project_id}")

        # 1. Scope guard.
        model = await self._session.get(GeologicalModelOrm, model_id)
        if model is None or model.app_project_id != project_id:
            raise ValueError(f"Geological model {model_id} not found in project {project_id}")

        # 2. Load all contacts with their formation's litho info.
        contacts_stmt = (
            select(
                FormationContactOrm.id,
                FormationContactOrm.formation_id,
                FormationContactOrm.cpt_id,
                FormationContactOrm.borehole_id,
                FormationContactOrm.depth_top_m,
                GeologicalFormationOrm.parent_formation_id,
                GeologicalFormationOrm.litho_main_soil_code,
            )
            .join(GeologicalFormationOrm, GeologicalFormationOrm.id == FormationContactOrm.formation_id)
            .where(FormationContactOrm.model_id == model_id)
        )
        rows = (await self._session.execute(contacts_stmt)).all()

        # 3. Build contact stacks per investigation and derive litho_below_code.
        stacks: dict[UUID, list[tuple[float, UUID, UUID, UUID | None, str]]] = {}
        for row in rows:
            inv_id = row.borehole_id if row.borehole_id is not None else row.cpt_id
            if inv_id is None:
                continue
            stacks.setdefault(inv_id, []).append(
                (
                    row.depth_top_m,
                    row.id,
                    row.formation_id,
                    row.parent_formation_id,
                    row.litho_main_soil_code or "",
                )
            )
        for s in stacks.values():
            s.sort()  # by depth ascending

        contact_records: list[ContactRecord] = []
        for inv_id, entries in stacks.items():
            for i, (depth, cid, fid, parent, litho_above) in enumerate(entries):
                litho_below = entries[i + 1][4] if i + 1 < len(entries) else None
                contact_records.append(
                    ContactRecord(
                        contact_id=cid,
                        formation_id=fid,
                        investigation_id=inv_id,
                        depth_top_m=depth,
                        parent_formation_id=parent,
                        litho_main_soil_code=litho_above,
                        litho_below_code=litho_below,
                    )
                )

        # 4. Load investigation locations.
        cpt_locs = (
            await self._session.execute(
                select(CptOrm.id, CptOrm.location_x, CptOrm.location_y).where(
                    CptOrm.app_project_id == project_id,
                )
            )
        ).all()
        bh_locs = (
            await self._session.execute(
                select(BoreholeOrm.id, BoreholeOrm.location_x, BoreholeOrm.location_y).where(
                    BoreholeOrm.app_project_id == project_id,
                )
            )
        ).all()
        locations = [
            InvestigationLocation(investigation_id=r.id, x=r.location_x, y=r.location_y)
            for r in (*cpt_locs, *bh_locs)
        ]

        # 5. Run the pure-domain algorithm.
        candidates = auto_correlate_contact_edges(contact_records, locations, params)
        self.debug(f"AutoCorrelateContactEdges: {len(candidates)} candidate pair(s)")

        # 6. Bulk-insert with ON CONFLICT DO NOTHING (Postgres-specific).
        if not candidates:
            await self._session.commit()
            return AutoCorrelateContactResult(edges_created=0, edges_skipped_existing=0)

        values = [
            {
                "id": uuid7(),
                "model_id": model_id,
                "contact_a_id": c.contact_a_id,
                "contact_b_id": c.contact_b_id,
                "source": AUTO_SOURCE,
                "user_approved": False,
            }
            for c in candidates
        ]
        stmt = (
            insert(LithoContactCorrelationEdgeOrm)
            .values(values)
            .on_conflict_do_nothing(
                index_elements=["model_id", "contact_a_id", "contact_b_id"]
            )
        )
        result = await self._session.execute(stmt)
        edges_created = result.rowcount or 0
        edges_skipped = len(values) - edges_created

        await self._session.commit()
        self.success(
            f"AutoCorrelateContactEdges: created={edges_created} "
            f"skipped_existing={edges_skipped}"
        )
        return AutoCorrelateContactResult(
            edges_created=edges_created,
            edges_skipped_existing=edges_skipped,
        )
```

- [ ] **Step 2: Verify the unique constraint name expected by `ON CONFLICT`**

```powershell
docker exec strix-db-1 psql -U groundmodel -d groundmodel -c "\d litho_contact_correlation_edge"
```
Look for the unique constraint on `(model_id, contact_a_id, contact_b_id)`. If it has an explicit name, swap the `index_elements=...` line for `constraint="<actual name>"`. If it's the implicit unique-index from the column list, the `index_elements` form is correct as written.

- [ ] **Step 3: Write the integration test**

Create `tests/integration/application/test_auto_correlate_contact_edges.py`:

```python
"""Integration test for AutoCorrelateContactEdges."""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.auto_correlate_contact_edges import (
    AutoCorrelateContactEdges,
)
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)


@pytest.mark.asyncio
async def test_inserts_auto_edges_with_user_approved_false(
    session: AsyncSession,
    # litho_model_with_two_columns_and_matching_boundaries,
) -> None:
    """End-to-end: two columns with same sand-on-clay boundary at similar
    depth → one auto edge inserted with source='auto', user_approved=False."""
    # ... seed fixture ...
    model_id = ...  # from fixture
    project_id = ...  # from fixture

    result = await AutoCorrelateContactEdges(session).execute(
        project_id=project_id,
        model_id=model_id,
    )
    assert result.edges_created >= 1
    rows = (
        await session.execute(
            select(LithoContactCorrelationEdgeOrm).where(
                LithoContactCorrelationEdgeOrm.model_id == model_id
            )
        )
    ).scalars().all()
    auto_rows = [r for r in rows if r.source == "auto"]
    assert all(r.user_approved is False for r in auto_rows)


@pytest.mark.asyncio
async def test_rerun_is_idempotent(
    session: AsyncSession,
) -> None:
    """Calling execute twice → second call returns edges_skipped_existing = N."""
    # ... seed, call once, snapshot count, call again, assert skip count = original count ...
    pass


@pytest.mark.asyncio
async def test_resolver_not_triggered_by_auto_run(
    session: AsyncSession,
) -> None:
    """instance_ordinal on the involved formations should NOT change after
    AutoCorrelateContactEdges — auto edges don't drive the resolver."""
    # ... snapshot ordinals, run auto-correlate, assert ordinals unchanged ...
    pass
```

- [ ] **Step 4: Run the tests**

```powershell
.\scripts\run-integration-tests.ps1 tests/integration/application/test_auto_correlate_contact_edges.py -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
uv run ruff format src/groundmodel/application/auto_correlate_contact_edges.py tests/integration/application/test_auto_correlate_contact_edges.py
git add src/groundmodel/application/auto_correlate_contact_edges.py tests/integration/application/test_auto_correlate_contact_edges.py
git commit -m "feat(application): AutoCorrelateContactEdges use case"
```

---

## Task 8: `DetectLithoLenses` use case + wire into Correlate/Uncorrelate

**Files:**
- Create: `src/groundmodel/application/detect_litho_lenses.py`
- Modify: `src/groundmodel/application/correlate_litho_contacts.py` (both `CorrelateLithoContacts` and `UncorrelateLithoContacts` classes)
- Create: `tests/integration/application/test_detect_litho_lenses.py`

- [ ] **Step 1: Write the `DetectLithoLenses` use case**

Create `src/groundmodel/application/detect_litho_lenses.py`:

```python
"""Detect-litho-lenses use case — #133 Phase 2+3.

Materialises ``LithoLensOrm`` rows for bodies that match the #135 topology
in the user-approved contact-edge graph.  Removes ``LithoLensOrm`` rows
whose body no longer matches.  Idempotent.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.domain.services.detect_lenses_from_graph import (
    ContactEdge,
    ContactStack,
    ContactStackEntry,
    detect_lenses_from_graph,
)
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_lens_orm import LithoLensOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass
class DetectLensesResult:
    """Outcome counts for the detection pass."""

    lenses_created: int
    lenses_removed: int
    lenses_skipped_unresolved_ordinal: int


class DetectLithoLenses(GroundModelLogger):
    """Detect lens bodies and reconcile ``LithoLensOrm`` rows.

    Reads ``user_approved=True`` contact edges only.  Materialises a
    ``LithoLensOrm`` row per detected lens body.  Removes rows whose body
    is no longer lens-shaped.  Does NOT create companion sections — that's
    the separate ``MaterialiseLensCompanions`` use case.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        *,
        project_id: UUID,
        model_id: UUID,
        prefer_section_id: UUID | None = None,
    ) -> DetectLensesResult:
        """Run the detection + reconciliation pass.

        Parameters
        ----------
        project_id : UUID
            Project scope guard.
        model_id : UUID
            The lithostratigraphic model.
        prefer_section_id : UUID | None
            When set, used as the candidate primary section first;
            otherwise the deterministic lookup picks the lowest-id
            section containing both investigations.

        Returns
        -------
        DetectLensesResult
            Counts of created, removed, and ordinal-skipped lens rows.
        """
        self.info(
            f"DetectLithoLenses.execute: model={model_id} prefer_section_id={prefer_section_id}"
        )

        # 1. Load all user-approved contact edges.
        edges_stmt = select(
            LithoContactCorrelationEdgeOrm.contact_a_id,
            LithoContactCorrelationEdgeOrm.contact_b_id,
        ).where(
            LithoContactCorrelationEdgeOrm.model_id == model_id,
            LithoContactCorrelationEdgeOrm.user_approved.is_(True),
        )
        edge_rows = (await self._session.execute(edges_stmt)).all()
        edges = [ContactEdge(contact_a_id=r.contact_a_id, contact_b_id=r.contact_b_id) for r in edge_rows]

        # 2. Load contact stacks (model-scoped).
        contacts_stmt = select(
            FormationContactOrm.id,
            FormationContactOrm.formation_id,
            FormationContactOrm.cpt_id,
            FormationContactOrm.borehole_id,
            FormationContactOrm.depth_top_m,
        ).where(FormationContactOrm.model_id == model_id)
        contact_rows = (await self._session.execute(contacts_stmt)).all()
        stacks_dict: dict[UUID, list[ContactStackEntry]] = {}
        for r in contact_rows:
            inv_id = r.borehole_id if r.borehole_id is not None else r.cpt_id
            if inv_id is None:
                continue
            stacks_dict.setdefault(inv_id, []).append(
                ContactStackEntry(contact_id=r.id, formation_id=r.formation_id, depth_top_m=r.depth_top_m)
            )
        stacks = [ContactStack(investigation_id=inv, entries=tuple(entries)) for inv, entries in stacks_dict.items()]

        # 3. Run the pure-domain detector.
        candidates = detect_lenses_from_graph(edges, stacks)
        self.debug(f"DetectLithoLenses: {len(candidates)} candidate(s)")

        # 4. Resolve body_ordinal per candidate from the formation.instance_ordinal.
        formation_ordinals: dict[UUID, int | None] = dict(
            (
                await self._session.execute(
                    select(GeologicalFormationOrm.id, GeologicalFormationOrm.instance_ordinal).where(
                        GeologicalFormationOrm.id.in_({c.formation_id for c in candidates})
                    )
                )
            ).all()
        )

        # 5. Resolve primary_section_id per candidate.
        # Map: section_id -> set of investigation_ids the section contains.
        sections_stmt = select(CrossSectionOrm.id, CrossSectionOrm.seeded_formation_contact_ids).where(
            CrossSectionOrm.app_project_id == project_id,
        )
        # Pull contact→investigation map for the section's seeded contact ids.
        # (Implementation detail: the section's investigations can be derived
        # from the contacts it seeds + the contact_rows above. Skip for brevity
        # in this plan step — see Step 6 fixture code.)
        section_inv_index: dict[UUID, set[UUID]] = {}
        contact_inv_map = {
            r.id: (r.borehole_id if r.borehole_id is not None else r.cpt_id)
            for r in contact_rows
        }
        section_rows = (await self._session.execute(sections_stmt)).all()
        for sr in section_rows:
            invs = {contact_inv_map[cid] for cid in (sr.seeded_formation_contact_ids or []) if cid in contact_inv_map}
            section_inv_index[sr.id] = invs

        def resolve_primary(source_inv: UUID, target_inv: UUID) -> UUID | None:
            # Prefer the supplied section if it contains both.
            if prefer_section_id is not None:
                invs = section_inv_index.get(prefer_section_id, set())
                if source_inv in invs and target_inv in invs:
                    return prefer_section_id
            # Otherwise: lowest-id section containing both.
            matches = [
                sid for sid, invs in section_inv_index.items()
                if source_inv in invs and target_inv in invs
            ]
            return min(matches) if matches else None

        # 6. Build the target lens set (formation_id, body_ordinal).
        target_set: set[tuple[UUID, int]] = set()
        lenses_created = 0
        lenses_skipped_unresolved_ordinal = 0
        for c in candidates:
            ordinal = formation_ordinals.get(c.formation_id)
            if ordinal is None:
                lenses_skipped_unresolved_ordinal += 1
                self.warning(
                    f"DetectLithoLenses: skipping lens — formation {c.formation_id} "
                    "has no instance_ordinal yet (resolver hasn't run?)"
                )
                continue
            target_set.add((c.formation_id, ordinal))

            # 7. Upsert LithoLensOrm.
            primary_sid = resolve_primary(c.source_investigation_id, c.target_investigation_id)
            existing_stmt = select(LithoLensOrm).where(
                LithoLensOrm.model_id == model_id,
                LithoLensOrm.formation_id == c.formation_id,
                LithoLensOrm.body_ordinal == ordinal,
            )
            existing = (await self._session.execute(existing_stmt)).scalar_one_or_none()
            if existing is None:
                self._session.add(
                    LithoLensOrm(
                        id=uuid7(),
                        app_project_id=project_id,
                        model_id=model_id,
                        formation_id=c.formation_id,
                        body_ordinal=ordinal,
                        primary_section_id=primary_sid,
                    )
                )
                lenses_created += 1
            else:
                # Update primary if we now have a better one and existing is null.
                if existing.primary_section_id is None and primary_sid is not None:
                    existing.primary_section_id = primary_sid

        # 8. Reconcile: delete LithoLensOrm rows whose body is no longer in target_set.
        existing_lenses = (
            await self._session.execute(
                select(LithoLensOrm).where(LithoLensOrm.model_id == model_id)
            )
        ).scalars().all()
        lenses_removed = 0
        for lens in existing_lenses:
            if (lens.formation_id, lens.body_ordinal) not in target_set:
                await self._session.delete(lens)
                lenses_removed += 1

        await self._session.flush()  # commit happens at caller's transaction boundary
        self.success(
            f"DetectLithoLenses: created={lenses_created} removed={lenses_removed} "
            f"skipped_unresolved_ordinal={lenses_skipped_unresolved_ordinal}"
        )
        return DetectLensesResult(
            lenses_created=lenses_created,
            lenses_removed=lenses_removed,
            lenses_skipped_unresolved_ordinal=lenses_skipped_unresolved_ordinal,
        )
```

- [ ] **Step 2: Wire into `CorrelateLithoContacts` and `UncorrelateLithoContacts`**

Modify `src/groundmodel/application/correlate_litho_contacts.py`. Two changes:

**Change A** — extend the `execute` signature on both classes with `request_section_id: UUID | None = None`:

```python
async def execute(
    self,
    *,
    project_id: UUID,
    model_id: UUID,
    contact_a_id: UUID,
    contact_b_id: UUID,
    source: str = "manual",
    request_section_id: UUID | None = None,
) -> ContactCorrelateResult:
```

**Change B** — after the existing insert/delete (just before the final `commit`), insert the new edges' approval flag and call the resolver + detection:

For `CorrelateLithoContacts`, on the INSERT path:

```python
edge = LithoContactCorrelationEdgeOrm(
    id=uuid7(),
    model_id=model_id,
    contact_a_id=a_id,
    contact_b_id=b_id,
    source=source,
    user_approved=True,  # NEW: manual = implicit acceptance
)
```

And after the flush:

```python
# Approved-edge mutations trigger the resolver + lens detection in the
# same transaction so instance_ordinal + LithoLensOrm rows stay in sync.
from groundmodel.application.resolve_litho_instances_use_case import (
    ResolveLithoInstances,
)
from groundmodel.application.detect_litho_lenses import DetectLithoLenses

await ResolveLithoInstances(self._session).execute(
    project_id=project_id, model_id=model_id
)
await DetectLithoLenses(self._session).execute(
    project_id=project_id,
    model_id=model_id,
    prefer_section_id=request_section_id,
)
```

For `UncorrelateLithoContacts`, do the same after the delete branch (in both the "edge existed → deleted" path and the no-op path; the no-op path can skip these calls since topology is unchanged).

- [ ] **Step 3: Write the integration test**

Create `tests/integration/application/test_detect_litho_lenses.py`:

```python
"""Integration tests for DetectLithoLenses + the wired Correlate/Uncorrelate path."""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.correlate_litho_contacts import (
    CorrelateLithoContacts,
    UncorrelateLithoContacts,
)
from groundmodel.application.detect_litho_lenses import DetectLithoLenses
from groundmodel.infrastructure.db.models.litho_lens_orm import LithoLensOrm


@pytest.mark.asyncio
async def test_manual_135_gesture_materialises_lens_metadata(session: AsyncSession) -> None:
    """Two CorrelateLithoContacts calls forming the #135 topology
    (two A-side contacts → same B contact) result in one LithoLensOrm row."""
    # ... fixture: model with 2 columns, A has 3 contacts, B has 1 contact ...
    # ... create c1↔t and c2↔t via CorrelateLithoContacts ...
    # ... assert exactly one LithoLensOrm row exists with formation_id == body's formation ...
    pass


@pytest.mark.asyncio
async def test_uncorrelate_removes_lens_when_topology_breaks(session: AsyncSession) -> None:
    """Removing one of the two defining edges → lens metadata row deleted."""
    # ... seed two edges forming a lens, call Uncorrelate on one of them ...
    # ... assert no LithoLensOrm rows remain ...
    pass


@pytest.mark.asyncio
async def test_unapproved_edges_do_not_seed_lenses(session: AsyncSession) -> None:
    """Insert two edges with user_approved=False that would form a lens.
    DetectLithoLenses runs but creates no LithoLensOrm rows."""
    # ... seed unapproved edges, call DetectLithoLenses directly, assert empty ...
    pass


@pytest.mark.asyncio
async def test_unresolved_ordinal_logged_and_skipped(session: AsyncSession) -> None:
    """When instance_ordinal is null on the lens body's formation,
    detector skips with lenses_skipped_unresolved_ordinal++ and no row created."""
    # ... seed but suppress the resolver between insert and detect ...
    pass
```

- [ ] **Step 4: Run the tests, expect PASS**

```powershell
.\scripts\run-integration-tests.ps1 tests/integration/application/test_detect_litho_lenses.py -v
```

- [ ] **Step 5: Commit**

```powershell
uv run ruff format src/groundmodel/application/detect_litho_lenses.py src/groundmodel/application/correlate_litho_contacts.py tests/integration/application/test_detect_litho_lenses.py
git add src/groundmodel/application/detect_litho_lenses.py src/groundmodel/application/correlate_litho_contacts.py tests/integration/application/test_detect_litho_lenses.py
git commit -m "feat(application): DetectLithoLenses + wire into Correlate/Uncorrelate"
```

---

## Task 9: `AcceptContactCorrelations` use case

**Files:**
- Create: `src/groundmodel/application/accept_contact_correlations.py`
- Create: `tests/integration/application/test_accept_contact_correlations.py`

- [ ] **Step 1: Write the use case**

Create `src/groundmodel/application/accept_contact_correlations.py`:

```python
"""Accept-contact-correlations use case — #133 Phase 2+3.

Flips ``user_approved=False → True`` in scope, then runs the resolver +
lens detection in the same transaction.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.detect_litho_lenses import DetectLithoLenses
from groundmodel.application.resolve_litho_instances_use_case import (
    ResolveLithoInstances,
)
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass
class AcceptResult:
    """Outcome counts for the accept pass."""

    edges_accepted: int
    lenses_created: int
    lenses_removed: int
    ordinals_changed: int  # diagnostic; populated from ResolveLithoInstances if available


class AcceptContactCorrelations(GroundModelLogger):
    """Approve unapproved contact-correlation edges in scope.

    Scope is section-local when ``section_id`` is supplied (both endpoints
    must be on that section); model-wide otherwise.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        *,
        project_id: UUID,
        model_id: UUID,
        section_id: UUID | None = None,
    ) -> AcceptResult:
        """Run the accept flow.

        Parameters
        ----------
        project_id : UUID
            Project scope guard.
        model_id : UUID
            The lithostratigraphic model.
        section_id : UUID | None
            Section to scope to.  When None, accept every unapproved edge
            in the model.

        Returns
        -------
        AcceptResult
            Counts of edges accepted + downstream lens deltas.
        """
        self.info(f"AcceptContactCorrelations: model={model_id} section={section_id}")

        # 1. Scope guard.
        model = await self._session.get(GeologicalModelOrm, model_id)
        if model is None or model.app_project_id != project_id:
            raise ValueError(f"Geological model {model_id} not found in project {project_id}")

        # 2. Build the in-scope edge id set.
        if section_id is not None:
            sec = await self._session.get(CrossSectionOrm, section_id)
            if sec is None or sec.app_project_id != project_id:
                raise ValueError(f"Cross-section {section_id} not found in project {project_id}")
            section_contact_ids = set(sec.seeded_formation_contact_ids or [])
            in_scope_stmt = select(LithoContactCorrelationEdgeOrm.id).where(
                LithoContactCorrelationEdgeOrm.model_id == model_id,
                LithoContactCorrelationEdgeOrm.user_approved.is_(False),
                LithoContactCorrelationEdgeOrm.contact_a_id.in_(section_contact_ids),
                LithoContactCorrelationEdgeOrm.contact_b_id.in_(section_contact_ids),
            )
        else:
            in_scope_stmt = select(LithoContactCorrelationEdgeOrm.id).where(
                LithoContactCorrelationEdgeOrm.model_id == model_id,
                LithoContactCorrelationEdgeOrm.user_approved.is_(False),
            )
        edge_ids = [r[0] for r in (await self._session.execute(in_scope_stmt)).all()]

        # 3. Flip approval.
        if edge_ids:
            await self._session.execute(
                update(LithoContactCorrelationEdgeOrm)
                .where(LithoContactCorrelationEdgeOrm.id.in_(edge_ids))
                .values(user_approved=True)
            )
        edges_accepted = len(edge_ids)

        # 4. Run resolver + lens detection.
        await ResolveLithoInstances(self._session).execute(
            project_id=project_id, model_id=model_id
        )
        detect_result = await DetectLithoLenses(self._session).execute(
            project_id=project_id,
            model_id=model_id,
            prefer_section_id=section_id,
        )

        await self._session.commit()
        self.success(
            f"AcceptContactCorrelations: accepted={edges_accepted} "
            f"lenses_created={detect_result.lenses_created} "
            f"lenses_removed={detect_result.lenses_removed}"
        )
        return AcceptResult(
            edges_accepted=edges_accepted,
            lenses_created=detect_result.lenses_created,
            lenses_removed=detect_result.lenses_removed,
            ordinals_changed=0,  # populate when ResolveLithoInstances exposes it
        )
```

- [ ] **Step 2: Write the integration tests**

Create `tests/integration/application/test_accept_contact_correlations.py`:

```python
"""Integration tests for AcceptContactCorrelations."""

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.accept_contact_correlations import AcceptContactCorrelations
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_lens_orm import LithoLensOrm


@pytest.mark.asyncio
async def test_section_scoped_accept_flips_only_in_scope_edges(session: AsyncSession) -> None:
    """Insert 4 unapproved edges: 2 on section A, 2 on section B.
    Accept section A → only the 2 on A flip to True."""
    pass


@pytest.mark.asyncio
async def test_model_scoped_accept_flips_everything(session: AsyncSession) -> None:
    """Accept with section_id=None → all unapproved edges in the model flip."""
    pass


@pytest.mark.asyncio
async def test_accept_triggers_lens_detection(session: AsyncSession) -> None:
    """Two unapproved edges forming a lens → after Accept, one LithoLensOrm exists."""
    pass


@pytest.mark.asyncio
async def test_accept_is_idempotent_when_nothing_unapproved(session: AsyncSession) -> None:
    """Re-run accept → edges_accepted=0, lens detection still runs (no-op)."""
    pass
```

- [ ] **Step 3: Run tests + commit**

```powershell
.\scripts\run-integration-tests.ps1 tests/integration/application/test_accept_contact_correlations.py -v
uv run ruff format src/groundmodel/application/accept_contact_correlations.py tests/integration/application/test_accept_contact_correlations.py
git add src/groundmodel/application/accept_contact_correlations.py tests/integration/application/test_accept_contact_correlations.py
git commit -m "feat(application): AcceptContactCorrelations use case"
```

---

## Task 10: `MaterialiseLensCompanions` use case

**Files:**
- Create: `src/groundmodel/application/materialise_lens_companions.py`
- Create: `tests/integration/application/test_materialise_lens_companions.py`

- [ ] **Step 1: Write the use case**

Create `src/groundmodel/application/materialise_lens_companions.py`:

```python
"""Materialise-lens-companions use case — #133 Phase 2+3.

For each ``LithoLensOrm`` row that lacks a companion section, evaluates
the strict gate (every contact on the primary section has at least one
``user_approved=True`` outbound edge).  Qualifying lenses get a
companion section via ``CreatePerpendicularCompanion``.  Per-lens
errors are caught and counted; the loop continues.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.create_perpendicular_companion import (
    CreatePerpendicularCompanion,
)
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_lens_orm import LithoLensOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


@dataclass
class MaterialiseLensCompanionsResult:
    """Outcome counts for the materialise pass."""

    companion_sections_created: int
    skipped_no_primary: int
    skipped_unfinished_section: int
    errored: int


class MaterialiseLensCompanions(GroundModelLogger):
    """Create perpendicular companion sections for qualifying lenses.

    Idempotent: lenses that already have companions are skipped silently
    by ``CreatePerpendicularCompanion``'s existence guard.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        *,
        project_id: UUID,
        model_id: UUID,
    ) -> MaterialiseLensCompanionsResult:
        """Run the materialisation pass."""
        self.info(f"MaterialiseLensCompanions: model={model_id}")

        # 1. Load lenses for the model that lack a companion section.
        no_companion = ~exists(
            select(CrossSectionOrm.id).where(CrossSectionOrm.companion_lens_id == LithoLensOrm.id)
        )
        lenses_stmt = select(LithoLensOrm).where(
            LithoLensOrm.model_id == model_id,
            no_companion,
        )
        lenses = (await self._session.execute(lenses_stmt)).scalars().all()
        self.debug(f"MaterialiseLensCompanions: {len(lenses)} lens(es) without companion")

        created = 0
        skipped_no_primary = 0
        skipped_unfinished = 0
        errored = 0

        for lens in lenses:
            if lens.primary_section_id is None:
                skipped_no_primary += 1
                self.debug(f"  lens {lens.id} skipped — no primary section")
                continue

            # 2. Load the primary section's seeded contacts.
            sec = await self._session.get(CrossSectionOrm, lens.primary_section_id)
            if sec is None:
                # Section was deleted between LithoLens creation and now.
                skipped_no_primary += 1
                continue
            contact_ids = sec.seeded_formation_contact_ids or []

            # 3. Gate: every contact has at least one user_approved edge.
            if contact_ids:
                # SELECT contact_id FROM (SELECT contact_a_id AS contact_id ... UNION ...)
                # but ORM-friendly: per-contact existence check.
                # Faster: load all approved edges' contact ids in one query.
                approved_stmt = select(
                    LithoContactCorrelationEdgeOrm.contact_a_id,
                    LithoContactCorrelationEdgeOrm.contact_b_id,
                ).where(
                    LithoContactCorrelationEdgeOrm.model_id == model_id,
                    LithoContactCorrelationEdgeOrm.user_approved.is_(True),
                )
                approved_rows = (await self._session.execute(approved_stmt)).all()
                approved_contact_ids: set[UUID] = set()
                for r in approved_rows:
                    approved_contact_ids.add(r.contact_a_id)
                    approved_contact_ids.add(r.contact_b_id)
                unfinished = [cid for cid in contact_ids if cid not in approved_contact_ids]
                if unfinished:
                    skipped_unfinished += 1
                    self.debug(
                        f"  lens {lens.id} skipped — section {sec.id} has "
                        f"{len(unfinished)} uncorrelated contact(s)"
                    )
                    continue

            # 4. Create the companion section.
            try:
                await CreatePerpendicularCompanion(self._session).execute(
                    project_id=project_id, model_id=model_id, lens_id=lens.id
                )
                created += 1
            except Exception as exc:
                self.warning(f"  lens {lens.id} errored: {exc}")
                errored += 1

        self.success(
            f"MaterialiseLensCompanions: created={created} "
            f"skipped_no_primary={skipped_no_primary} "
            f"skipped_unfinished_section={skipped_unfinished} errored={errored}"
        )
        return MaterialiseLensCompanionsResult(
            companion_sections_created=created,
            skipped_no_primary=skipped_no_primary,
            skipped_unfinished_section=skipped_unfinished,
            errored=errored,
        )
```

- [ ] **Step 2: Write the integration tests**

Create `tests/integration/application/test_materialise_lens_companions.py`:

```python
"""Integration tests for MaterialiseLensCompanions."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.application.materialise_lens_companions import MaterialiseLensCompanions


@pytest.mark.asyncio
async def test_gate_pass_creates_companion(session: AsyncSession) -> None:
    """LithoLens with primary section where every contact has an approved
    edge → companion section created."""
    pass


@pytest.mark.asyncio
async def test_gate_fail_skips_companion(session: AsyncSession) -> None:
    """One contact on the primary section has no approved edge →
    skipped_unfinished_section++; no companion created."""
    pass


@pytest.mark.asyncio
async def test_null_primary_skipped(session: AsyncSession) -> None:
    """LithoLens with primary_section_id=null → skipped_no_primary++."""
    pass


@pytest.mark.asyncio
async def test_idempotent(session: AsyncSession) -> None:
    """Re-running materialise → no new companions for already-companioned lenses."""
    pass
```

- [ ] **Step 3: Run + commit**

```powershell
.\scripts\run-integration-tests.ps1 tests/integration/application/test_materialise_lens_companions.py -v
uv run ruff format src/groundmodel/application/materialise_lens_companions.py tests/integration/application/test_materialise_lens_companions.py
git add src/groundmodel/application/materialise_lens_companions.py tests/integration/application/test_materialise_lens_companions.py
git commit -m "feat(application): MaterialiseLensCompanions use case"
```

---

## Task 11: New API endpoints — auto, accept, materialise + extend POST/DELETE/GET schemas

**Files:**
- Modify: `src/groundmodel/api/routers/geology/contact_correlations.py` (add new routes; extend existing schemas)
- Modify: `src/groundmodel/api/schemas/project/litho_contact_correlation/litho_contact_correlation_schemas.py` (extend `ContactCorrelationRequest` with `request_section_id`; extend response with `user_approved`)
- Create: `src/groundmodel/api/schemas/project/litho_contact_correlation/auto_schemas.py`
- Create: `src/groundmodel/api/schemas/project/litho_contact_correlation/accept_schemas.py`
- Create: `src/groundmodel/api/schemas/project/litho_contact_correlation/lens_companion_schemas.py`

- [ ] **Step 1: Extend the request schema with `request_section_id`**

In `src/groundmodel/api/schemas/project/litho_contact_correlation/litho_contact_correlation_schemas.py`, add to `ContactCorrelationRequest`:

```python
class ContactCorrelationRequest(BaseModel):
    """..."""

    contact_a_id: UUID
    contact_b_id: UUID
    source: Literal["manual"] = "manual"
    # New: when the gesture originates from a specific section, pass its id
    # so the lens detector can prefer it as the candidate primary_section_id.
    request_section_id: UUID | None = None

    # ... existing _no_self_loop validator ...
```

And add `user_approved: bool` to `ContactCorrelationEdgeListItem`:

```python
class ContactCorrelationEdgeListItem(BaseModel):
    """..."""

    model_config = {"from_attributes": True}

    id: UUID
    contact_a_id: UUID
    contact_b_id: UUID
    model_id: UUID
    source: str
    user_approved: bool  # NEW
    created_at: datetime
```

- [ ] **Step 2: Pass `request_section_id` through the existing POST + DELETE handlers**

In `src/groundmodel/api/routers/geology/contact_correlations.py`:

In the POST handler (`create_contact_correlation`):

```python
result = await CorrelateLithoContacts(session).execute(
    project_id=project_id,
    model_id=model_id,
    contact_a_id=body.contact_a_id,
    contact_b_id=body.contact_b_id,
    source=body.source,
    request_section_id=body.request_section_id,  # NEW
)
```

Same shape in `delete_contact_correlation`.

- [ ] **Step 3: Add the auto endpoint schemas + route**

Create `src/groundmodel/api/schemas/project/litho_contact_correlation/auto_schemas.py`:

```python
"""Schemas for POST .../contact-correlations/auto."""

from __future__ import annotations

from pydantic import BaseModel


class AutoCorrelateContactResponse(BaseModel):
    """Response body for auto-correlate."""

    edges_created: int
    edges_skipped_existing: int
```

Add to `contact_correlations.py`:

```python
from groundmodel.application.auto_correlate_contact_edges import (
    AutoCorrelateContactEdges,
)
from groundmodel.api.schemas.project.litho_contact_correlation.auto_schemas import (
    AutoCorrelateContactResponse,
)


@router.post(
    "/models/{model_id}/contact-correlations/auto",
    response_model=AutoCorrelateContactResponse,
    status_code=status.HTTP_200_OK,
    summary="Auto-propose contact-level correlation edges (#133 Phase 2)",
)
async def auto_correlate_contact(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> AutoCorrelateContactResponse:
    """Run the contact-level auto-correlate algorithm."""
    repo = GeologyRepository(session)
    await get_in_project_or_404(
        repo.get_model(model_id),
        project_id,
        detail="Geological model not found",
    )
    result = await AutoCorrelateContactEdges(session).execute(
        project_id=project_id, model_id=model_id
    )
    return AutoCorrelateContactResponse(
        edges_created=result.edges_created,
        edges_skipped_existing=result.edges_skipped_existing,
    )
```

- [ ] **Step 4: Add the accept endpoint schemas + route**

Create `src/groundmodel/api/schemas/project/litho_contact_correlation/accept_schemas.py`:

```python
"""Schemas for POST .../contact-correlations/accept."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel


class AcceptContactCorrelationsRequest(BaseModel):
    """Optional section scope."""

    section_id: UUID | None = None


class AcceptContactCorrelationsResponse(BaseModel):
    """Response body for accept."""

    edges_accepted: int
    lenses_created: int
    lenses_removed: int
    ordinals_changed: int
```

Add route in `contact_correlations.py`:

```python
from groundmodel.application.accept_contact_correlations import AcceptContactCorrelations
from groundmodel.api.schemas.project.litho_contact_correlation.accept_schemas import (
    AcceptContactCorrelationsRequest,
    AcceptContactCorrelationsResponse,
)


@router.post(
    "/models/{model_id}/contact-correlations/accept",
    response_model=AcceptContactCorrelationsResponse,
    status_code=status.HTTP_200_OK,
    summary="Approve auto-proposed contact-correlation edges in scope (#133 Phase 2)",
)
async def accept_contact_correlations(
    project_id: UUID,
    model_id: UUID,
    body: AcceptContactCorrelationsRequest,
    session: AsyncSession = Depends(get_session),
) -> AcceptContactCorrelationsResponse:
    """Flip user_approved=True for in-scope unapproved edges + run resolver + lens detection."""
    repo = GeologyRepository(session)
    await get_in_project_or_404(
        repo.get_model(model_id),
        project_id,
        detail="Geological model not found",
    )
    try:
        result = await AcceptContactCorrelations(session).execute(
            project_id=project_id, model_id=model_id, section_id=body.section_id
        )
    except ValueError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
    return AcceptContactCorrelationsResponse(
        edges_accepted=result.edges_accepted,
        lenses_created=result.lenses_created,
        lenses_removed=result.lenses_removed,
        ordinals_changed=result.ordinals_changed,
    )
```

- [ ] **Step 5: Add the lens-companions/materialise endpoint**

Create `src/groundmodel/api/schemas/project/litho_contact_correlation/lens_companion_schemas.py`:

```python
"""Schemas for POST .../lens-companions/materialise."""

from __future__ import annotations

from pydantic import BaseModel


class MaterialiseLensCompanionsResponse(BaseModel):
    """Response body for materialise."""

    companion_sections_created: int
    skipped_no_primary: int
    skipped_unfinished_section: int
    errored: int
```

Add to `contact_correlations.py` (under a new sub-path):

```python
from groundmodel.application.materialise_lens_companions import MaterialiseLensCompanions
from groundmodel.api.schemas.project.litho_contact_correlation.lens_companion_schemas import (
    MaterialiseLensCompanionsResponse,
)


@router.post(
    "/models/{model_id}/lens-companions/materialise",
    response_model=MaterialiseLensCompanionsResponse,
    status_code=status.HTTP_200_OK,
    summary="Auto-create perpendicular companion sections for qualifying lenses (#133 Phase 2)",
)
async def materialise_lens_companions(
    project_id: UUID,
    model_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> MaterialiseLensCompanionsResponse:
    """Create perpendicular companion sections for lenses whose primary section is fully correlated."""
    repo = GeologyRepository(session)
    await get_in_project_or_404(
        repo.get_model(model_id),
        project_id,
        detail="Geological model not found",
    )
    result = await MaterialiseLensCompanions(session).execute(
        project_id=project_id, model_id=model_id
    )
    return MaterialiseLensCompanionsResponse(
        companion_sections_created=result.companion_sections_created,
        skipped_no_primary=result.skipped_no_primary,
        skipped_unfinished_section=result.skipped_unfinished_section,
        errored=result.errored,
    )
```

- [ ] **Step 6: Add basic e2e tests for the new routes**

Add to `tests/e2e/test_contact_correlations.py` (or create the file if absent):

```python
"""E2E tests for the new contact-correlation routes (#133 Phase 2)."""

# Three test cases: POST /auto returns 200 with expected JSON shape;
# POST /accept with section_id flips approval and returns counts;
# POST /lens-companions/materialise returns 200 with the four counters.
```

- [ ] **Step 7: Run + commit**

```powershell
uv run ruff format src/groundmodel/api/routers/geology/contact_correlations.py src/groundmodel/api/schemas/project/litho_contact_correlation/
.\scripts\run-integration-tests.ps1 tests/integration/application/test_auto_correlate_contact_edges.py tests/integration/application/test_accept_contact_correlations.py tests/integration/application/test_materialise_lens_companions.py -v
uv run pytest tests/e2e/test_contact_correlations.py -v
git add src/groundmodel/api/ tests/e2e/test_contact_correlations.py
git commit -m "feat(api): contact-correlations auto + accept + lens-companions endpoints"
```

---

## Task 12: Rename `/correlations/admixtures` to `/contact-correlations/admixtures`

**Files:**
- Modify: `src/groundmodel/api/routers/geology/correlations.py` (move route OR copy + delete)
- Modify: `src/groundmodel/api/routers/geology/contact_correlations.py` (host the renamed route)

- [ ] **Step 1: Identify the existing admixtures route**

```powershell
grep -n "admixtures" src/groundmodel/api/routers/geology/correlations.py
```
Note the handler name + body schema + use-case wiring.

- [ ] **Step 2: Cut the handler into `contact_correlations.py`**

Move the entire `PATCH .../correlations/admixtures` handler block to `contact_correlations.py`, change the path to `/models/{model_id}/contact-correlations/admixtures`. Keep the handler body identical for now — the use-case internals were already rewritten in Task 6.

- [ ] **Step 3: Delete the route from `correlations.py`**

Remove just the admixtures handler from `correlations.py` for this commit; other formation-level routes in this file are removed in Task 14.

- [ ] **Step 4: Verify the new route works**

```powershell
uv run pytest tests/e2e/ -k "admixture" -v
```
Update the test path if any test hits the old URL.

- [ ] **Step 5: Commit**

```powershell
git add src/groundmodel/api/routers/geology/
git commit -m "refactor(api): move admixtures PATCH under /contact-correlations"
```

---

## Task 13: Wire the new FastAPI routes into the router registry

**Files:**
- Modify: `src/groundmodel/api/routers/geology/__init__.py`

- [ ] **Step 1: Inspect current router registration**

```powershell
code src/groundmodel/api/routers/geology/__init__.py
```
Look for `router.include_router(contact_correlations.router)` (added in Phase 1).

- [ ] **Step 2: No new registration needed**

The new endpoints from Task 11 + 12 are added to the **same** `contact_correlations.router` already registered. Confirm by importing the module + calling the test client (covered by Task 11's e2e tests).

- [ ] **Step 3: Skip if no change required**

If `__init__.py` doesn't need editing, no commit for this task.

---

## Task 14: Delete formation-level use cases + tests + endpoints

**Files (delete):**
- `src/groundmodel/application/auto_correlate_litho_bodies.py`
- `src/groundmodel/application/correlate_litho_units.py`
- `src/groundmodel/application/uncorrelate_litho_units.py`
- `src/groundmodel/domain/services/auto_correlate.py`
- `src/groundmodel/domain/services/auto_correlate_constants.py`
- `src/groundmodel/api/routers/geology/correlations.py`
- `src/groundmodel/api/schemas/project/litho_correlation/litho_correlation_schemas.py` (+ `__init__.py`)
- Their associated test files in `tests/unit/`, `tests/integration/`, `tests/e2e/`

**Files (modify):**
- `src/groundmodel/api/routers/geology/__init__.py` (remove `from . import correlations` + `router.include_router(correlations.router)`)
- Any file that imports the deleted use cases (grep for them first)

- [ ] **Step 1: Grep for consumers**

```powershell
grep -rn "from groundmodel.application.auto_correlate_litho_bodies\|from groundmodel.application.correlate_litho_units\|from groundmodel.application.uncorrelate_litho_units\|from groundmodel.domain.services.auto_correlate import\|from groundmodel.api.routers.geology.correlations\|from groundmodel.api.schemas.project.litho_correlation" src/ tests/ --include="*.py"
```
Note every consumer.

- [ ] **Step 2: Update each consumer**

For each hit, replace the import / call with the contact-level analogue. Most will be in tests for the deleted use cases — those tests get deleted in Step 4. Production code consumers should be zero post-Task 5 / 6 (resolver + admixture propagation no longer import the formation-level edge ORM).

- [ ] **Step 3: Delete the production files**

```powershell
git rm src/groundmodel/application/auto_correlate_litho_bodies.py
git rm src/groundmodel/application/correlate_litho_units.py
git rm src/groundmodel/application/uncorrelate_litho_units.py
git rm src/groundmodel/domain/services/auto_correlate.py
git rm src/groundmodel/domain/services/auto_correlate_constants.py
git rm src/groundmodel/api/routers/geology/correlations.py
git rm -r src/groundmodel/api/schemas/project/litho_correlation/
```

- [ ] **Step 4: Delete the associated tests**

```powershell
git rm tests/unit/domain/services/test_auto_correlate.py
git rm tests/integration/application/test_auto_correlate_litho_bodies.py
git rm tests/integration/application/test_correlate_litho_units.py
git rm tests/integration/application/test_uncorrelate_litho_units.py
git rm tests/e2e/test_correlations.py
```
(Verify these filenames exist via `git ls-files` first; adjust if names differ.)

- [ ] **Step 5: Remove the router registration**

In `src/groundmodel/api/routers/geology/__init__.py`, delete the lines:
```python
from . import correlations
...
router.include_router(correlations.router)
```

- [ ] **Step 6: Run the full backend test suite**

```powershell
uv run pytest tests/unit -q
.\scripts\run-integration-tests.ps1 -q
uv run pytest tests/e2e -q
```
Expected: PASS. If any test fails because of a still-dangling formation-level reference, fix or delete it.

- [ ] **Step 7: Commit**

```powershell
git add -A
git commit -m "chore(litho): delete formation-level use cases + routes + tests"
```

---

## Task 15: Update `ClearLithoModel` to delete contact-level edges

**Files:**
- Modify: `src/groundmodel/application/clear_litho_model.py`

- [ ] **Step 1: Inspect the existing flow**

```powershell
code src/groundmodel/application/clear_litho_model.py
```
Find the bulk-delete of `LithoCorrelationEdgeOrm`.

- [ ] **Step 2: Switch to contact-level edges**

Replace:
```python
from groundmodel.infrastructure.db.models.litho_correlation_edge_orm import (
    LithoCorrelationEdgeOrm,
)
...
await self._session.execute(
    delete(LithoCorrelationEdgeOrm).where(LithoCorrelationEdgeOrm.model_id == model_id)
)
```

with:

```python
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
...
await self._session.execute(
    delete(LithoContactCorrelationEdgeOrm).where(
        LithoContactCorrelationEdgeOrm.model_id == model_id
    )
)
```

- [ ] **Step 3: Update its tests**

Find the test file for `ClearLithoModel` (e.g. `tests/integration/application/test_clear_litho_model.py`). Update fixture seeds + assertions to use contact-level edges.

- [ ] **Step 4: Run + commit**

```powershell
.\scripts\run-integration-tests.ps1 tests/integration/application/test_clear_litho_model.py -v
git add src/groundmodel/application/clear_litho_model.py tests/integration/application/test_clear_litho_model.py
git commit -m "refactor(litho): ClearLithoModel deletes contact-level edges"
```

---

## Task 16: Update the .gmproj bundle to carry contact-level edges (BE)

**Files:**
- Modify: `src/groundmodel/api/schemas/project/project_bundle.py`
- Modify: `src/groundmodel/infrastructure/db/repositories/project_bundle.py`

- [ ] **Step 1: Add the new field to `ProjectBundleRequest` + `ProjectBundleResponse`**

In `project_bundle.py`, add to both classes:

```python
    # Contact-level correlation edges (#133 Phase 2+3).  Additive — absent
    # in bundles saved before this field shipped.
    litho_contact_correlation_edges: list[dict[str, Any]] = Field(
        default_factory=list,
        max_length=_MAX_LITHO_CORRELATION_EDGES_PER_BUNDLE,
    )
```

Keep `litho_correlation_edges` as is for now (will be dropped in Task 21 alongside the table drop).

- [ ] **Step 2: Bundle save — serialise contact edges**

In `infrastructure/db/repositories/project_bundle.py`, find the section that loads + serialises `litho_correlation_edges` (around the line `383: ` from the earlier audit). Add a parallel block that loads + serialises `LithoContactCorrelationEdgeOrm` rows for the project's models.

```python
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)

# ... in the bundle-save flow:
contact_edges_stmt = select(LithoContactCorrelationEdgeOrm).join(
    GeologicalModelOrm,
    GeologicalModelOrm.id == LithoContactCorrelationEdgeOrm.model_id,
).where(GeologicalModelOrm.app_project_id == project_id)
contact_edges = (await session.execute(contact_edges_stmt)).scalars().all()
bundle["litho_contact_correlation_edges"] = [
    _column_to_json(e, _SKIP_COLUMNS) for e in contact_edges
]
```

- [ ] **Step 3: Bundle restore — insert contact edges**

In the bundle-restore flow (look for `litho_correlation_edges_payload` around line 565), add the analogue:

```python
async def _restore_litho_contact_correlation_edges(
    session: AsyncSession,
    project_id: UUID,
    contact_edges_payload: list[dict[str, Any]],
) -> int:
    """Insert contact-level edges from the bundle."""
    if not contact_edges_payload:
        return 0
    for e in contact_edges_payload:
        # Insert with explicit id (preserves cross-machine references).
        session.add(LithoContactCorrelationEdgeOrm(**e))
    await session.flush()
    return len(contact_edges_payload)
```

Call this from the main restore function after geological models + contacts are restored (so the FK targets exist).

- [ ] **Step 4: Tests**

Add to the existing bundle round-trip test (e.g. `tests/integration/api/test_project_bundle.py`):

```python
@pytest.mark.asyncio
async def test_bundle_roundtrip_includes_contact_correlation_edges(
    session: AsyncSession,
) -> None:
    """Save → wipe DB → restore preserves litho_contact_correlation_edges."""
    pass
```

- [ ] **Step 5: Commit**

```powershell
.\scripts\run-integration-tests.ps1 tests/integration/api/test_project_bundle.py -v
uv run ruff format src/groundmodel/api/schemas/project/project_bundle.py src/groundmodel/infrastructure/db/repositories/project_bundle.py
git add src/groundmodel/api/schemas/project/project_bundle.py src/groundmodel/infrastructure/db/repositories/project_bundle.py tests/integration/api/test_project_bundle.py
git commit -m "feat(bundle): carry litho_contact_correlation_edges in .gmproj v3"
```

---

## Task 17: Update the FE bundle schema mirror

**Files:**
- Modify: `desktop/src/renderer/src/utils/projectFile.ts`

- [ ] **Step 1: Add the new field to `ProjectFileV3`**

Open `desktop/src/renderer/src/utils/projectFile.ts`. Find the `ProjectFileV3` interface:

```typescript
litho_correlation_edges: Record<string, unknown>[]
```

Add immediately after:

```typescript
  // Contact-level correlation edges (#133 Phase 2+3).
  litho_contact_correlation_edges: Record<string, unknown>[]
```

- [ ] **Step 2: Update `buildProjectFile` to serialise the new field**

Find `buildProjectFile`. Add:

```typescript
  litho_contact_correlation_edges: bundle.litho_contact_correlation_edges ?? [],
```

- [ ] **Step 3: Update `parseProjectFile` to read with default**

Find `parseProjectFile`. Add:

```typescript
  if (candidate.litho_contact_correlation_edges === undefined) {
    candidate.litho_contact_correlation_edges = []
  }
```

- [ ] **Step 4: Run vitest + tsc**

```powershell
Push-Location desktop; npx tsc --noEmit -p tsconfig.web.json; npx vitest run src/renderer/src/utils/; Pop-Location
```
Expected: 0 type errors; existing tests pass.

- [ ] **Step 5: Commit**

```powershell
git add desktop/src/renderer/src/utils/projectFile.ts
git commit -m "feat(bundle-fe): add litho_contact_correlation_edges to ProjectFileV3"
```

---

## Task 18: API client — new + extended + removed methods

**Files:**
- Modify: `desktop/src/renderer/src/api/client.ts`

- [ ] **Step 1: Add `LithoContactCorrelationEdge` to include `user_approved`**

Find the existing `LithoContactCorrelationEdge` interface and add:

```typescript
export interface LithoContactCorrelationEdge {
  id: string
  contact_a_id: string
  contact_b_id: string
  model_id: string
  source: string
  user_approved: boolean  // NEW
  created_at: string
}
```

- [ ] **Step 2: Extend `createContactCorrelation` + `deleteContactCorrelation` with `requestSectionId`**

```typescript
    createContactCorrelation: (
      projectId: string,
      modelId: string,
      contactAId: string,
      contactBId: string,
      requestSectionId?: string | null,
    ): Promise<{ edge_id: string; was_created: boolean }> =>
      post(`/projects/${projectId}/geology/models/${modelId}/contact-correlations`, {
        contact_a_id: contactAId,
        contact_b_id: contactBId,
        source: 'manual',
        request_section_id: requestSectionId ?? null,
      }),

    deleteContactCorrelation: async (
      projectId: string,
      modelId: string,
      contactAId: string,
      contactBId: string,
      requestSectionId?: string | null,
    ): Promise<void> => {
      const path = `/projects/${projectId}/geology/models/${modelId}/contact-correlations`
      const res = await fetch(`${_base}${path}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_a_id: contactAId,
          contact_b_id: contactBId,
          request_section_id: requestSectionId ?? null,
        }),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail ?? `DELETE ${path} → ${res.status}`)
      }
    },
```

- [ ] **Step 3: Add new methods**

```typescript
    autoCorrelateContacts: (
      projectId: string,
      modelId: string,
    ): Promise<{ edges_created: number; edges_skipped_existing: number }> =>
      post(`/projects/${projectId}/geology/models/${modelId}/contact-correlations/auto`, {}),

    acceptContactCorrelations: (
      projectId: string,
      modelId: string,
      sectionId?: string | null,
    ): Promise<{
      edges_accepted: number
      lenses_created: number
      lenses_removed: number
      ordinals_changed: number
    }> =>
      post(`/projects/${projectId}/geology/models/${modelId}/contact-correlations/accept`, {
        section_id: sectionId ?? null,
      }),

    materialiseLensCompanions: (
      projectId: string,
      modelId: string,
    ): Promise<{
      companion_sections_created: number
      skipped_no_primary: number
      skipped_unfinished_section: number
      errored: number
    }> =>
      post(`/projects/${projectId}/geology/models/${modelId}/lens-companions/materialise`, {}),
```

- [ ] **Step 4: Remove formation-level methods**

Delete:
- `correlate`
- `uncorrelate`
- `listCorrelations`
- `autoCorrelate` (rename → `autoCorrelateContacts` above)
- `resolveLithoInstances` (if exists — search before removing)

Also update `propagateCorrelatedLithoAdmixtures`'s URL: from `/correlations/admixtures` to `/contact-correlations/admixtures`.

- [ ] **Step 5: Tsc + vitest**

```powershell
Push-Location desktop; npx tsc --noEmit -p tsconfig.web.json; Pop-Location
```
Expected: 0 errors (any existing callers of removed methods get caught here — fix them or defer to Task 19's larger sweep).

- [ ] **Step 6: Commit**

```powershell
git add desktop/src/renderer/src/api/client.ts
git commit -m "feat(api-client): contact-correlation auto/accept/materialise + drop formation-level"
```

---

## Task 19: FE — Accept correlations toolbar button + edge styling for user_approved

**Files:**
- Modify: `desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx`
- Modify: `desktop/src/renderer/src/shell/stages/sections/SectionsCanvas.tsx`
- Modify: `desktop/src/renderer/src/shell/stages/sections/SectionsToolbar.tsx`
- Modify: `desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.test.tsx`

- [ ] **Step 1: Style approved vs unapproved edges in the overlay**

In `CorrelationEdgesOverlay.tsx`, the contact-edge rendering loop currently draws one solid line per edge. Differentiate by `user_approved`:

```typescript
{contactEdges && contactEdges.length > 0 && (
  <g data-testid="contact-edges-overlay" pointerEvents="none">
    {contactEdges.map(ce => {
      const ptA = contactScreenMap.get(ce.contact_a_id)
      const ptB = contactScreenMap.get(ce.contact_b_id)
      if (!ptA || !ptB) return null
      const approved = ce.user_approved
      return (
        <line
          key={`contact-edge-${ce.id}`}
          data-testid={`contact-edge-${ce.id}`}
          data-approved={approved ? 'true' : 'false'}
          x1={ptA.x}
          y1={ptA.topY}
          x2={ptB.x}
          y2={ptB.topY}
          stroke={approved ? CONTACT_EDGE_COLOR : UNAPPROVED_EDGE_COLOR}
          strokeWidth={CONTACT_EDGE_WIDTH}
          strokeDasharray={approved ? CONTACT_EDGE_DASH : UNAPPROVED_EDGE_DASH}
          opacity={CONTACT_EDGE_OPACITY}
          pointerEvents="none"
        />
      )
    })}
  </g>
)}
```

Add at the top of the file (near the existing `CONTACT_EDGE_*` constants):

```typescript
const UNAPPROVED_EDGE_COLOR = 'var(--amber-500, #f59e0b)'
const UNAPPROVED_EDGE_DASH = '4 4'
```

- [ ] **Step 2: Add the Accept button to the toolbar**

Locate the Sections toolbar (run `grep -rn "Auto-correlate\|autoCorrelate" desktop/src/renderer/src --include="*.tsx" -l`).

Add an `Accept correlations` button next to the Auto-correlate button:

```tsx
<button
  type="button"
  className="btn-secondary"
  disabled={!hasUnapprovedEdgesInActiveSection}
  onClick={handleAcceptCorrelations}
>
  Accept correlations
</button>
```

In the handler:

```typescript
const handleAcceptCorrelations = useCallback(async () => {
  if (!activeLithoModel || !selectedSectionId) return
  try {
    const result = await api.geology.acceptContactCorrelations(
      project.id,
      activeLithoModel.id,
      selectedSectionId,
    )
    toast('success', `Accepted ${result.edges_accepted} correlations. ${result.lenses_created} new lenses.`)
    void refetchContactEdges()
    void refetchLithoLenses()
    void refetchLithoFormations()
  } catch (err) {
    toast('error', 'Accept failed — try again.')
  }
}, [activeLithoModel, project.id, selectedSectionId, refetchContactEdges, refetchLithoLenses, refetchLithoFormations, toast])
```

`hasUnapprovedEdgesInActiveSection` derives from `contactEdges` + the section's `seeded_formation_contact_ids`. Add it as a `useMemo`.

- [ ] **Step 3: Pass `requestSectionId` from SectionsCanvas**

In `SectionsCanvas.tsx`, find the existing `handleCreateContactCorrelation` and `handleDeleteContactCorrelation`. Add `selectedSectionId` as a 5th argument to each:

```typescript
await api.geology.createContactCorrelation(
  project.id,
  activeLithoModel.id,
  contactAId,
  contactBId,
  selectedSectionId,  // NEW
)
```

Same for delete.

- [ ] **Step 4: Add Vitest tests for the new edge styling**

Add to `CorrelationEdgesOverlay.test.tsx`:

```typescript
it('CC8: approved edge renders solid emerald', () => {
  const fA = makeFormation('f-a', 'Zand', 1)
  const contacts = [
    makeContact('ca', 'f-a', 'inv-A', 'cpt', 2.0),
    makeContact('cb', 'f-a', 'inv-B', 'cpt', 2.0),
  ]
  const edge = {
    id: 'e1',
    contact_a_id: 'ca',
    contact_b_id: 'cb',
    model_id: 'm1',
    source: 'manual',
    user_approved: true,
    created_at: '2026-01-01T00:00:00Z',
  }
  renderOverlay({
    edges: [],
    contacts,
    formations: [fA],
    placedColumns: [makeColumn('inv-A', 100, 10, 5), makeColumn('inv-B', 200, 10, 20)],
    levelToScreen: makeLevelToScreen(),
    plotTop: 20,
    plotBottom: 200,
    contactEdges: [edge],
  })
  const line = screen.getByTestId('contact-edge-e1')
  expect(line.getAttribute('data-approved')).toBe('true')
})

it('CC9: unapproved edge renders dashed amber', () => {
  // mirror CC8 but user_approved: false; assert data-approved="false"
})
```

- [ ] **Step 5: Run + commit**

```powershell
Push-Location desktop; npx vitest run src/renderer/src/components/sections/CorrelationEdgesOverlay.test.tsx; Pop-Location
git add desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.test.tsx desktop/src/renderer/src/shell/stages/sections/SectionsCanvas.tsx <toolbar file>
git commit -m "feat(sections): Accept correlations button + edge styling for user_approved"
```

---

## Task 20: FE — Materialise lens companions toolbar button

**Files:**
- Modify: `desktop/src/renderer/src/shell/stages/sections/SectionsToolbar.tsx`
- Modify: `desktop/src/renderer/src/shell/stages/sections/SectionsCanvas.tsx` (for the refetch hooks)

- [ ] **Step 1: Add the button**

In the toolbar:

```tsx
<button
  type="button"
  className="btn-secondary"
  disabled={!hasLensesWithoutCompanion}
  onClick={handleMaterialiseLensCompanions}
>
  Materialise lens companions
</button>
```

Handler:

```typescript
const handleMaterialiseLensCompanions = useCallback(async () => {
  if (!activeLithoModel) return
  try {
    const result = await api.geology.materialiseLensCompanions(project.id, activeLithoModel.id)
    toast('success',
      `Lens companions: ${result.companion_sections_created} created, ` +
      `${result.skipped_unfinished_section} skipped (sections not fully correlated).`,
    )
    void refetchCrossSections()
    void refetchLithoLenses()
  } catch (err) {
    toast('error', 'Materialise lens companions failed — try again.')
  }
}, [activeLithoModel, project.id, refetchCrossSections, refetchLithoLenses, toast])
```

`hasLensesWithoutCompanion` derives from `lithoLenses` + `crossSections` (a lens is companioned iff some section has `companion_lens_id === lens.id`).

- [ ] **Step 2: Run + commit**

```powershell
Push-Location desktop; npx vitest run; Pop-Location
git add <toolbar file>
git commit -m "feat(sections): Materialise lens companions toolbar button"
```

---

## Task 21: Remove the formation-level body-click gesture + ribbon rendering + Resolve button

**Files:**
- Modify: `desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx`
- Modify: `desktop/src/renderer/src/components/SectionPanel.tsx`
- Modify: `desktop/src/renderer/src/shell/stages/sections/SectionsCanvas.tsx`
- Modify: `desktop/src/renderer/src/shell/stages/sections/SectionsToolbar.tsx` (remove the Resolve button)
- Modify: `desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.test.tsx` (delete tests for removed behaviour)

- [ ] **Step 1: Remove `CorrelateGestureState` interface + all plumbing**

In `CorrelationEdgesOverlay.tsx`:
- Delete the `CorrelateGestureState` export interface.
- Delete the `correlateGestureState` prop from `Props`.
- Delete the destructuring of `correlateGestureState` + its safe-default branch.
- Delete the body-band click hit-target rendering loop (the formation-level gesture).
- Delete the formation-level ribbon rendering paths (the `ribbon-N` group from #121).
- KEEP: the contact-edge rendering loop, the `contactGestureState` plumbing (Phase 1 + #135), the lens-body chips that read `instance_ordinal` (they don't depend on formation edges directly).

In `SectionPanel.tsx`: remove the `correlateGestureState` prop and its pass-through to the overlay.

In `SectionsCanvas.tsx`: remove the `correlateGestureState` construction + pass-through. The contact-level gesture state stays.

- [ ] **Step 2: Remove the Resolve button from the toolbar**

Delete the `Resolve` button and its handler. If `api.geology.resolveLithoInstances` was already removed in Task 18, the handler can't compile — confirm and remove.

- [ ] **Step 3: Delete the now-stale Vitest cases**

In `CorrelationEdgesOverlay.test.tsx`, delete every test that exercised the formation-level gesture or the ribbon (CE2, CE6, CE7, CE8 — verify by name; CC1–CC9 stay).

- [ ] **Step 4: Tsc + vitest**

```powershell
Push-Location desktop; npx tsc --noEmit -p tsconfig.web.json; npx vitest run; Pop-Location
```
Expected: 0 type errors; all surviving tests pass.

- [ ] **Step 5: Commit**

```powershell
git add desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx desktop/src/renderer/src/components/SectionPanel.tsx desktop/src/renderer/src/shell/stages/sections/SectionsCanvas.tsx <toolbar file> desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.test.tsx
git commit -m "refactor(sections): remove formation-level body-click gesture + ribbon + Resolve button"
```

---

## Task 22: Playwright e2e — auto-correlate + Accept + Materialise

**Files:**
- Create: `desktop/tests/e2e/auto-correlate-and-lenses.spec.ts`

- [ ] **Step 1: Write the e2e**

```typescript
import { test, expect } from '@playwright/test'

test.describe('#133 Phase 2+3 — auto-correlate + accept + lens companions', () => {
  test('seed → auto-correlate → accept → materialise', async ({ page }) => {
    // 1. Seed project (use the existing helpers in desktop/tests/e2e/helpers/).
    // 2. Open the litho axis on a section that includes 3 investigations.
    // 3. Click Auto-correlate. Expect dashed amber edges to appear.
    // 4. Verify the lens inspector is empty (no lenses yet).
    // 5. Click Accept correlations. Expect edges to turn solid emerald.
    // 6. Verify the lens inspector now lists ≥1 lens.
    // 7. Click Materialise lens companions. Expect a new companion section
    //    to appear in the section list with the lens-companion badge.
  })
})
```

Adapt the test body to the helpers in `desktop/tests/e2e/helpers/`. The skeleton above is the contract — fill in the actual UI selectors using existing patterns from `desktop/tests/e2e/_results/` snapshots.

- [ ] **Step 2: Run**

```powershell
Push-Location desktop; npx playwright test auto-correlate-and-lenses.spec.ts; Pop-Location
```

- [ ] **Step 3: Commit**

```powershell
git add desktop/tests/e2e/auto-correlate-and-lenses.spec.ts
git commit -m "test(e2e): auto-correlate + accept + materialise lens companions"
```

---

## Task 23: Drop `litho_correlation_edge` table

**Files:**
- Create: `src/groundmodel/infrastructure/db/migrations/versions/<rev2>_drop_litho_correlation_edge_table.py`
- Delete: `src/groundmodel/infrastructure/db/models/litho_correlation_edge_orm.py`

- [ ] **Step 1: Generate the migration**

```powershell
uv run alembic revision -m "drop litho_correlation_edge table"
```

- [ ] **Step 2: Fill in the migration**

```python
"""drop litho_correlation_edge table

Revision ID: <auto>
Revises: <Task 1 revision>
Create Date: 2026-05-26 ...
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "<auto>"
down_revision = "<Task 1 revision>"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Drop the formation-level correlation edges table.

    Pre-ship cleanup: backwards-compat suspended per project_backwards_compat_suspended.md.
    Consumers (resolver + admixture propagation) have already been rewritten to
    derive the formation graph from contact-level edges.
    """
    op.drop_table("litho_correlation_edge")


def downgrade() -> None:
    """Restore the table shape (for emergency rollback).  Empty — data is lost."""
    op.create_table(
        "litho_correlation_edge",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("model_id", sa.UUID(), nullable=False),
        sa.Column("formation_a_id", sa.UUID(), nullable=False),
        sa.Column("formation_b_id", sa.UUID(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
```

- [ ] **Step 3: Delete the ORM model**

```powershell
git rm src/groundmodel/infrastructure/db/models/litho_correlation_edge_orm.py
```

Also delete its entry from `src/groundmodel/infrastructure/db/models/__init__.py` if present.

- [ ] **Step 4: Drop the formation-level edges field from the bundle**

In `src/groundmodel/api/schemas/project/project_bundle.py`, remove `litho_correlation_edges: list[dict[str, Any]] = ...` from both Request and Response.

In `src/groundmodel/infrastructure/db/repositories/project_bundle.py`, remove the formation-edges serialise + restore blocks. (Older bundles that carry the field are silently ignored by Pydantic `extra='ignore'` — verify the model_config.)

In `desktop/src/renderer/src/utils/projectFile.ts`, remove `litho_correlation_edges` from `ProjectFileV3`, `buildProjectFile`, and `parseProjectFile`.

- [ ] **Step 5: Run migration + tests**

```powershell
uv run alembic upgrade head
.\scripts\run-integration-tests.ps1 -q
```

- [ ] **Step 6: Commit**

```powershell
git add src/groundmodel/infrastructure/db/migrations/versions/ src/groundmodel/api/schemas/project/project_bundle.py src/groundmodel/infrastructure/db/repositories/project_bundle.py desktop/src/renderer/src/utils/projectFile.ts
git commit -m "chore(schema): drop litho_correlation_edge table + bundle field"
```

---

## Task 24: Update CLAUDE.md Tier G + debt.md

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/debt.md`

- [ ] **Step 1: Move #133 to "recently resolved" in CLAUDE.md**

In the Tier G section, move #133 Phase 2/3 from the "currently open" list to the "recently resolved" list:

```markdown
*Recently resolved (do NOT re-add):* #133 Phase 2+3 (contact-level auto-correlate + lens detection + lens companions + formation-level removal — shipped 2026-05-26; user_approved column + AcceptContactCorrelations + DetectLithoLenses + MaterialiseLensCompanions; resolver + admixture propagation rewritten to consume contact edges; litho_correlation_edge table dropped; formation-level body-click gesture + ribbon + Resolve button removed), #135 (lens-pinch-out gesture — shipped 2026-05-26, ...) ... <existing list>
```

Update the "Tier G open" sentence to drop #133 Phase 2/3.

- [ ] **Step 2: Update docs/debt.md**

In `docs/debt.md`, find the #133 entry. Replace its body with a "RESOLVED" block (mirror the format used for #135 yesterday):

```markdown
## 133. Boundary-to-boundary correlation — RESOLVED 2026-05-26

**Shipped.** Phase 2+3 combined in a single PR. Contact-level
auto-correlate with boundary-signature filter (no Theil-Sen) +
user_approved column + AcceptContactCorrelations use case +
DetectLithoLenses (consumes #135 topology, user_approved=True only) +
MaterialiseLensCompanions (section-scoped gate: every contact on
primary section has an approved outbound edge).
ResolveLithoInstances + PropagateCorrelatedLithoAdmixtures rewritten
to derive the formation graph from contact edges.
litho_correlation_edge table dropped; formation-level use cases,
endpoints, body-click gesture, ribbon rendering, and Resolve button
all removed in the same PR. NAD-based scoring deferred (Phase 5 —
circular dependency at litho stage).

(Original filing kept below for design rationale + history.)

---

## 133 (filing). Boundary-to-boundary correlation (...)

<existing entry>
```

- [ ] **Step 3: Commit**

```powershell
git add CLAUDE.md docs/debt.md
git commit -m "docs(debt): mark #133 Phase 2+3 shipped"
```

---

## Task 25: Verify + surface contact deletion gesture

**Files (likely to touch):**
- Modify: `desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx` (right-click on a contact-hit-rect to show "Delete contact")
- Modify: `desktop/src/renderer/src/shell/stages/sections/SectionsCanvas.tsx` (delete handler that re-fetches contactEdges + lithoLenses + lithoFormations after the cascade)

The backend `DELETE /formation-contacts/{id}` already exists. What's missing on the section axis is the gesture surface — the user needs a discoverable way to delete a contact from the section view itself. After deletion:
- Cascade: any `litho_contact_correlation_edge` row referencing this contact is removed via FK.
- Triggers: lens detection + resolver must re-run on the model since the approved edge set changed.

- [ ] **Step 1: Audit the existing delete path**

```powershell
grep -rn "deleteFormationContact\|delete_formation_contact" src/groundmodel/api/routers/ desktop/src/renderer/src/api/ --include="*.py" --include="*.ts"
```
Note the existing endpoint + client wrapper.

- [ ] **Step 2: Ensure cascade triggers re-run resolver + lens detection**

Open the existing `DeleteFormationContact` use case (find via grep). After the delete, before commit, add (mirroring Task 8's wiring):

```python
from groundmodel.application.detect_litho_lenses import DetectLithoLenses
from groundmodel.application.resolve_litho_instances_use_case import (
    ResolveLithoInstances,
)

# After the contact's row is deleted (FK cascade removes its edges):
await ResolveLithoInstances(self._session).execute(
    project_id=project_id, model_id=model_id
)
await DetectLithoLenses(self._session).execute(
    project_id=project_id, model_id=model_id, prefer_section_id=None,
)
```

- [ ] **Step 3: Add the right-click "Delete contact" menu on contact-hit-rects**

In `CorrelationEdgesOverlay.tsx`, find the existing `contact-gesture-rects` group (the hit-targets for the #135 gesture). Add an `onContextMenu` handler:

```tsx
onContextMenu={(e) => {
  e.preventDefault()
  onRequestDeleteContact?.(c.id)
}}
```

Add `onRequestDeleteContact?: (contactId: string) => void` to `ContactGestureState`.

- [ ] **Step 4: Wire the delete handler in `SectionsCanvas.tsx`**

```typescript
const handleDeleteContact = useCallback(
  async (contactId: string) => {
    if (!activeLithoModel) return
    const ok = await confirm({
      title: 'Delete contact?',
      body: 'This removes the boundary and any correlations touching it.',
      destructive: true,
    })
    if (!ok) return
    try {
      await api.geology.deleteFormationContact(project.id, contactId)
      void refetchLithoContacts()
      void refetchContactEdges()
      void refetchLithoLenses()
      void refetchLithoFormations()
      toast('success', 'Contact deleted.')
    } catch (err) {
      toast('error', 'Could not delete the contact — try again.')
    }
  },
  [activeLithoModel, project.id, refetchLithoContacts, refetchContactEdges, refetchLithoLenses, refetchLithoFormations, toast, confirm],
)
```

Pass `onRequestDeleteContact: handleDeleteContact` into the `contactGestureState`.

- [ ] **Step 5: Vitest — confirm + delete + cascade**

Add to `CorrelationEdgesOverlay.test.tsx`:

```typescript
it('CC10: right-click on contact hit-rect fires onRequestDeleteContact', () => {
  // mock the gesture state with vi.fn(); fireEvent.contextMenu on contact-hit-{id};
  // expect onRequestDeleteContact to have been called with the contact id.
})
```

- [ ] **Step 6: Run + commit**

```powershell
Push-Location desktop; npx vitest run src/renderer/src/components/sections/CorrelationEdgesOverlay.test.tsx; Pop-Location
.\scripts\run-integration-tests.ps1 tests/integration/application/ -k "delete_formation_contact or delete_contact" -v
git add desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.test.tsx desktop/src/renderer/src/shell/stages/sections/SectionsCanvas.tsx src/groundmodel/application/delete_formation_contact.py
git commit -m "feat(sections): right-click delete contact + cascade resolver + lens detection"
```

---

## Task 26: Drag-and-drop an unapproved edge endpoint to re-target

**Files:**
- Modify: `desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx`
- Modify: `desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.test.tsx`

No backend change — the swap is implemented as "delete old edge + create new edge" via the existing endpoints. Both edges remain `user_approved=False` (auto suggestions retain their unapproved state until the user explicitly Accepts on the section).

UX shape:
1. Unapproved edges render small grab handles (5×5 squares) at each endpoint.
2. User mousedown on a handle → start drag. The opposite endpoint stays anchored.
3. During drag, render a ghost line from the anchor to the cursor (re-uses the existing `correlate-drag-preview` pattern from #133's drag-arm work).
4. Drop target: any contact-hit-rect (one of the `data-contact-id` rects) whose contact id is different from both the anchor and the original dragged contact, AND whose investigation is NOT the same as the anchor's investigation (same-investigation edges fail server-side validation).
5. On drop: call `deleteContactCorrelation(old)` followed by `createContactCorrelation(new)` with `requestSectionId=selectedSectionId`. Refetch.

- [ ] **Step 1: Add drag-handle rendering to unapproved edges**

In the unapproved-edge branch of the contactEdges loop (added in Task 19), wrap each line in a group and add two handle rects:

```tsx
{!approved && (
  <>
    <rect
      data-testid={`unapproved-handle-a-${ce.id}`}
      data-edge-id={ce.id}
      data-handle="a"
      x={ptA.x - 4}
      y={ptA.topY - 4}
      width={8}
      height={8}
      fill={UNAPPROVED_EDGE_COLOR}
      style={{ cursor: 'grab', pointerEvents: 'all' }}
      onMouseDown={(e) => onUnapprovedDragStart?.(e, ce, 'a')}
    />
    <rect
      data-testid={`unapproved-handle-b-${ce.id}`}
      data-edge-id={ce.id}
      data-handle="b"
      x={ptB.x - 4}
      y={ptB.topY - 4}
      width={8}
      height={8}
      fill={UNAPPROVED_EDGE_COLOR}
      style={{ cursor: 'grab', pointerEvents: 'all' }}
      onMouseDown={(e) => onUnapprovedDragStart?.(e, ce, 'b')}
    />
  </>
)}
```

Add `onUnapprovedDragStart?: (e: React.MouseEvent, edge: LithoContactCorrelationEdge, handle: 'a' | 'b') => void` to the overlay props.

- [ ] **Step 2: Implement drag state in `SectionsCanvas.tsx`**

```typescript
const [edgeDrag, setEdgeDrag] = useState<{
  edge: LithoContactCorrelationEdge
  draggedHandle: 'a' | 'b'
  anchorContactId: string
  cursorSvgX: number
  cursorSvgY: number
} | null>(null)

const handleUnapprovedDragStart = useCallback(
  (e: React.MouseEvent, edge: LithoContactCorrelationEdge, handle: 'a' | 'b') => {
    const anchorContactId = handle === 'a' ? edge.contact_b_id : edge.contact_a_id
    setEdgeDrag({
      edge,
      draggedHandle: handle,
      anchorContactId,
      cursorSvgX: e.clientX,
      cursorSvgY: e.clientY,
    })
  },
  [],
)

// Window mousemove + mouseup to drive the drag.
useEffect(() => {
  if (!edgeDrag) return
  const onMove = (e: MouseEvent) => {
    setEdgeDrag((cur) =>
      cur === null
        ? null
        : { ...cur, cursorSvgX: e.clientX, cursorSvgY: e.clientY },
    )
  }
  const onUp = async (e: MouseEvent) => {
    // Hit-test the drop target.
    const target = document.elementFromPoint(e.clientX, e.clientY)
    const dropContactId = target?.closest('[data-contact-id]')?.getAttribute('data-contact-id') ?? null
    setEdgeDrag(null)
    if (!dropContactId || !edgeDrag) return
    if (dropContactId === edgeDrag.anchorContactId) return
    const originalDraggedId = edgeDrag.draggedHandle === 'a' ? edgeDrag.edge.contact_a_id : edgeDrag.edge.contact_b_id
    if (dropContactId === originalDraggedId) return  // dropped back where it started
    // Same-investigation check: anchor + new contact must be on different investigations.
    const anchor = lithoContacts.find((c) => c.id === edgeDrag.anchorContactId)
    const newContact = lithoContacts.find((c) => c.id === dropContactId)
    if (!anchor || !newContact) return
    const anchorInv = anchor.cpt_id ?? anchor.borehole_id
    const newInv = newContact.cpt_id ?? newContact.borehole_id
    if (anchorInv === newInv) {
      toast('error', 'Cannot retarget within the same investigation.')
      return
    }
    // Swap: delete old, create new.
    try {
      await api.geology.deleteContactCorrelation(
        project.id,
        activeLithoModel!.id,
        edgeDrag.edge.contact_a_id,
        edgeDrag.edge.contact_b_id,
        selectedSectionId,
      )
      await api.geology.createContactCorrelation(
        project.id,
        activeLithoModel!.id,
        edgeDrag.anchorContactId,
        dropContactId,
        selectedSectionId,
      )
      void refetchContactEdges()
      void refetchLithoLenses()
      void refetchLithoFormations()
      toast('success', 'Suggestion re-targeted.')
    } catch (err) {
      toast('error', 'Re-target failed.')
      void refetchContactEdges()
    }
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp, { once: true })
  return () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
}, [edgeDrag, lithoContacts, project.id, activeLithoModel, selectedSectionId, refetchContactEdges, refetchLithoLenses, refetchLithoFormations, toast])
```

- [ ] **Step 3: Render the drag ghost line**

In `CorrelationEdgesOverlay.tsx`, add (near the existing `drag` ghost rendering for the formation-level gesture, which is being removed in Task 21):

```tsx
{edgeDrag && (() => {
  const anchorPt = contactScreenMap.get(edgeDrag.anchorContactId)
  if (!anchorPt) return null
  return (
    <line
      data-testid="unapproved-edge-drag-preview"
      x1={anchorPt.x}
      y1={anchorPt.topY}
      x2={edgeDrag.cursorSvgX}
      y2={edgeDrag.cursorSvgY}
      stroke={UNAPPROVED_EDGE_COLOR}
      strokeWidth={CONTACT_EDGE_WIDTH}
      strokeDasharray={UNAPPROVED_EDGE_DASH}
      opacity={0.6}
      pointerEvents="none"
    />
  )
})()}
```

Pass `edgeDrag` from `SectionsCanvas` into the overlay via a new prop `unapprovedEdgeDrag?: { anchorContactId: string; cursorSvgX: number; cursorSvgY: number }`.

- [ ] **Step 4: Vitest — handle exists on unapproved edge, drag start fires callback**

```typescript
it('CC11: unapproved edge renders grab handles at both endpoints', () => {
  // assert getByTestId('unapproved-handle-a-e1') and 'unapproved-handle-b-e1' present.
})

it('CC12: mousedown on a handle calls onUnapprovedDragStart with handle id', () => {
  const onDragStart = vi.fn()
  // ... fireEvent.mouseDown on the 'a' handle ...
  expect(onDragStart).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ id: 'e1' }), 'a')
})
```

- [ ] **Step 5: Run + commit**

```powershell
Push-Location desktop; npx vitest run src/renderer/src/components/sections/CorrelationEdgesOverlay.test.tsx; Pop-Location
git add desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.test.tsx desktop/src/renderer/src/shell/stages/sections/SectionsCanvas.tsx
git commit -m "feat(sections): drag-and-drop unapproved edge to re-target a contact"
```

---

## Task 27: Final integration sweep + smoke

- [ ] **Step 1: Full backend suite**

```powershell
uv run pytest tests/unit -q
.\scripts\run-integration-tests.ps1 -q
uv run pytest tests/e2e -q
```
Expected: all green.

- [ ] **Step 2: Full desktop suite**

```powershell
Push-Location desktop; npx tsc --noEmit -p tsconfig.web.json; npx vitest run; npx playwright test; Pop-Location
```
Expected: 0 type errors; all Vitest pass; new Playwright spec passes.

- [ ] **Step 3: Smoke**

```powershell
.\scripts\run-integration-tests.ps1 --collect-only  # ensures migrations are at head
Push-Location desktop; npm run dev; Pop-Location
```
In another shell, open the app, run through the user-flow:
- Open an existing project with litho contacts.
- Verify the formation-level ribbon is gone, the body-click gesture is inert, the Resolve button is gone.
- Click Auto-correlate. See dashed amber edges.
- Click Accept correlations. See edges turn solid; lens inspector populates.
- Click Materialise lens companions. See a new section appear in the list with the lens-companion badge.
- Save the project (.gmproj). Re-open. Verify everything restores.

- [ ] **Step 4: Final commit if anything was tweaked during smoke**

```powershell
# Only if changes were made during smoke.
git add -A
git commit -m "fix: smoke-test follow-ups"
```

---

## Self-review checklist

After implementation, run this checklist before declaring complete:

- [ ] Every spec section is covered by at least one task above.
- [ ] No `TBD` / `TODO` / `FIXME` left in the implementation.
- [ ] All new public functions / classes / modules have numpy-style docstrings (per DoD in CLAUDE.md).
- [ ] All entries in CLAUDE.md "Tier G open" list have been re-checked for accuracy after the doc update.
- [ ] `.gmproj` save → re-open round-trip preserves contact-level edges, lens metadata, and companion sections.
- [ ] No reference to `LithoCorrelationEdgeOrm`, `CorrelateLithoUnits`, `UncorrelateLithoUnits`, `AutoCorrelateLithoBodies`, or the `/correlations` (formation-level) endpoints survives anywhere in the repo. Grep:
  ```powershell
  grep -rn "LithoCorrelationEdgeOrm\|CorrelateLithoUnits\|UncorrelateLithoUnits\|AutoCorrelateLithoBodies\|api.geology.correlate\b\|api.geology.autoCorrelate\b" src/ tests/ desktop/src/
  ```
  Expected: zero hits.
- [ ] `litho_correlation_edge` table no longer exists in the dev DB:
  ```powershell
  docker exec strix-db-1 psql -U groundmodel -d groundmodel -c "\dt litho_correlation_edge"
  ```
  Expected: `Did not find any relation named "litho_correlation_edge".`
- [ ] All 27 tasks above show ✅ in the checkbox.

---

## Notes for the implementer

- **Pre-existing API client gaps from Phase 1.** The `api.geology.listContactCorrelations` / `createContactCorrelation` / `deleteContactCorrelation` were silently broken before commit `1cbb4a47` (2026-05-26) wired them up. The fix is in `desktop/src/renderer/src/api/client.ts` lines 295-329. Do not re-introduce the bug by deleting the type or methods during Task 18's "remove formation-level methods" sweep.
- **Subagent-driven execution recommended.** This plan has 27 tasks. Use `superpowers:subagent-driven-development` to dispatch each task to a fresh subagent + review between tasks. The pre-commit hook (`.githooks/pre-commit`) auto-runs the relevant test scopes; trust it.
- **Do NOT push.** Per `feedback_git_workflow`, commit per-file but do not run `git push` unless the user explicitly says so. GitHub Actions quota reset is 2026-06-01.
- **Format every file before commit.** The `PostToolUse` hook auto-runs `ruff format` + `ruff check --fix` after every Write, so this should be automatic — verify with `git diff --cached` before each commit.
- **The pre-commit hook runs tests on `*.py` and `desktop/*.{ts,tsx}` changes.** Doc-only commits skip it. If a commit fails the hook, fix and create a NEW commit (never `--amend`).

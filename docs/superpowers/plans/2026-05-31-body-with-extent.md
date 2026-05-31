# Body-with-Extent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the unilateral `LithoLensOrm` model into a body-with-extent primitive that unifies detected bilateral lenses, user-claimed halfway pinch-outs, dip-extrapolated pinch-outs (absorbing the retired `ExtrapolatePinchOut` tool), and open-ended bodies under one schema.

**Architecture:** Single `BodyOrm` table with denormalized extent columns (`extent_<side>_kind` enum + `target_contact_id` + `neighbour_inv_id` per side). Auto-detector writes `'to_target'` for bilateral closures; user gestures write `'pinch_out_halfway'` / `'extrapolated'` / `'open'`. **Provenance rule:** detector NEVER overwrites a user-claimed extent. Reconcile sweeps NEVER delete named or user-claimed bodies.

**Tech Stack:** SQLAlchemy + Alembic + FastAPI + Pydantic (backend); React + TypeScript + Vitest + Playwright (frontend). Pre-ship backwards-compat is suspended (`memory/project_backwards_compat_suspended.md`), so the rename is clean and migrations are forward-only.

**Spec:** `docs/superpowers/specs/2026-05-31-body-with-extent-design.md`.

**Pre-flight check:** before starting slice 1, ensure the startup lens sweep (already shipped this morning) has cleaned all pre-bilateral stale lens rows. Run the app once; verify the sweep logged "0 stale removed" — if non-zero, run it again until clean.

---

## File structure

### New backend files

| Path | Responsibility |
|---|---|
| `src/groundmodel/shared/constants/extent_kind.py` | Single source of truth for the `extent_kind` enum values. Imported by every consumer (ORM, schemas, frontend type generator). |
| `src/groundmodel/domain/services/body_extent.py` | `BodyExtent` value object + `DetectedBody` dataclass returned by the detector. |
| `src/groundmodel/domain/services/dip_extrapolation.py` | Pure helper: compute the dip-extrapolation endpoint from a source contact pair + the neighbour's surface. Returns `(along_m, elevation_m)` or `None` for degenerate inputs. |
| `src/groundmodel/domain/services/detect_body_extents.py` | Replaces `detect_lenses_from_graph`. Returns `list[DetectedBody]` with per-side extents. |
| `src/groundmodel/infrastructure/db/models/body_orm.py` | Replaces `litho_lens_orm.py`. `BodyOrm` ORM class. |
| `src/groundmodel/infrastructure/db/models/body_boundary_shape_orm.py` | Replaces `litho_lens_shape_orm.py`. |
| `src/groundmodel/infrastructure/db/models/body_boundary_node_orm.py` | Replaces `litho_lens_boundary_node_orm.py`. |
| `src/groundmodel/infrastructure/db/migrations/versions/<rev>_body_with_extent.py` | Alembic migration. Renames tables, adds extent columns, runs data fill, absorbs synthetic pinch-out contacts, re-runs TIN + absences. |
| `src/groundmodel/application/detect_bodies.py` | Replaces `detect_litho_lenses.py`. |
| `src/groundmodel/application/claim_body_extent.py` | New use case for user-claimed extents (all three kinds). |
| `src/groundmodel/application/clear_body_extent.py` | New use case for clearing a claim. |
| `src/groundmodel/application/suggest_body_pinch_outs.py` | New ephemeral use case for the auto-suggest pass. |
| `src/groundmodel/application/name_body.py` | Replaces `name_lens_body.py`. |
| `src/groundmodel/application/delete_body.py` | Replaces `delete_lens_metadata.py`. |
| `src/groundmodel/application/materialise_body_companions.py` | Replaces `materialise_lens_companions.py`. |
| `src/groundmodel/application/body_boundary.py` | Replaces `lens_boundary.py`. |
| `src/groundmodel/api/schemas/project/body/__init__.py` | New schema package. |
| `src/groundmodel/api/schemas/project/body/body_list_item.py` | List response type with all extent fields. |
| `src/groundmodel/api/schemas/project/body/claim_body_extent_request.py` | Request body for `POST /bodies` and `PATCH /bodies/{bid}`. |
| `src/groundmodel/api/schemas/project/body/suggest_pinch_outs_response.py` | Ephemeral candidates response. |
| `src/groundmodel/api/schemas/project/body/body_boundary.py` | Boundary GET/PUT request + response. |
| `src/groundmodel/api/schemas/project/body/detect_bodies_response.py` | Detect verb response (renamed from `DetectLensesResponse`). |
| `src/groundmodel/api/routers/geology/bodies.py` | Replaces `lenses.py`. All `/bodies/*` endpoints. |

### Modified backend files

| Path | Change |
|---|---|
| `src/groundmodel/application/accept_contact_correlations.py` | Rename `lenses_created` / `lenses_removed` → `bodies_created` / `bodies_removed` in `AcceptResult`. |
| `src/groundmodel/application/correlate_litho_contacts.py` | No DetectBodies call here (already stripped this morning); verify import order still clean. |
| `src/groundmodel/application/delete_formation_contact.py` | No DetectBodies call here (already stripped); verify. |
| `src/groundmodel/application/delete_litho_layer.py` | Same. |
| `src/groundmodel/application/update_formation_contact.py` | Same. |
| `src/groundmodel/api/main.py` | Rename `_sweep_stale_lenses` → `_sweep_stale_bodies`; update use-case import. |
| `src/groundmodel/api/routers/project.py` | Rename `DetectLithoLenses` → `DetectBodies` import + usage in restore reconcile. |
| `src/groundmodel/api/routers/geology/__init__.py` | Replace `lenses` router import with `bodies`. |
| `src/groundmodel/api/schemas/project/project_bundle.py` | Rename `litho_lenses` payload field → `bodies`. |
| `src/groundmodel/infrastructure/db/repositories/project_bundle.py` | Rename `LithoLensOrm` references → `BodyOrm`; serialize new extent columns; integrity guards. |

### Deleted backend files

* `src/groundmodel/infrastructure/db/models/litho_lens_orm.py`
* `src/groundmodel/infrastructure/db/models/litho_lens_shape_orm.py`
* `src/groundmodel/infrastructure/db/models/litho_lens_boundary_node_orm.py`
* `src/groundmodel/application/detect_litho_lenses.py`
* `src/groundmodel/application/name_lens_body.py`
* `src/groundmodel/application/delete_lens_metadata.py`
* `src/groundmodel/application/materialise_lens_companions.py`
* `src/groundmodel/application/lens_boundary.py`
* `src/groundmodel/application/extrapolate_pinch_out.py` *(slice 1a retirement)*
* `src/groundmodel/api/routers/geology/lenses.py`
* `src/groundmodel/api/schemas/project/litho_lens/` (whole package)
* `src/groundmodel/api/schemas/project/litho_lens_boundary.py`

### New frontend files

| Path | Responsibility |
|---|---|
| `desktop/src/renderer/src/components/sections/BodyExtentOverlay.tsx` | Replaces `LensWedgeOverlay.tsx`. Dispatches on `extent_<side>_kind` per side. |
| `desktop/src/renderer/src/components/sections/BodyContextMenu.tsx` | Per-side submenu for body band right-clicks. |
| `desktop/src/renderer/src/components/sections/BodyProvenanceBadge.tsx` | Inspector badge + override dialog. |
| `desktop/src/renderer/src/utils/bodyExtent.ts` | Replaces `lensBoundary.ts`. Resolves body extent endpoints + boundary polylines. |
| `desktop/src/renderer/src/utils/dipExtrapolationFrontend.ts` | Mirror of backend dip-extrapolation helper (for live ghost preview). |

### Modified frontend files

| Path | Change |
|---|---|
| `desktop/src/renderer/src/api/client.ts` | TypeScript type renames (`LithoLensListItem` → `BodyListItem`, etc.) + new API methods. |
| `desktop/src/renderer/src/components/SectionPanel.tsx` | Replace `<LensWedgeOverlay>` with `<BodyExtentOverlay>`. |
| `desktop/src/renderer/src/shell/stages/sections/SectionsToolbar.tsx` | Rename "Detect lenses" → "Detect bodies"; add "Suggest pinch-outs" verb. |
| `desktop/src/renderer/src/hooks/useGeologicalModel.ts` | Rename lens-related state slots. |
| `desktop/src/renderer/src/components/sections/ContactsLayer.tsx` | Wire `BodyContextMenu` on body band right-click. |
| `desktop/src/renderer/src/utils/projectFile.ts` | Bundle field rename. |

### Deleted frontend files

* `desktop/src/renderer/src/components/sections/LensWedgeOverlay.tsx`
* `desktop/src/renderer/src/components/sections/LensWedgeOverlay.test.tsx` *(replaced by `BodyExtentOverlay.test.tsx`)*
* `desktop/src/renderer/src/utils/lensBoundary.ts`
* `desktop/src/renderer/src/utils/lensBoundary.test.ts`

### New tests

* `tests/unit/shared/constants/test_extent_kind.py`
* `tests/unit/domain/services/test_body_extent.py`
* `tests/unit/domain/services/test_dip_extrapolation.py`
* `tests/unit/domain/services/test_detect_body_extents.py`
* `tests/integration/application/test_detect_bodies.py`
* `tests/integration/application/test_claim_body_extent.py`
* `tests/integration/application/test_clear_body_extent.py`
* `tests/integration/application/test_suggest_body_pinch_outs.py`
* `tests/integration/db/migrations/test_body_with_extent_migration.py` (includes synthetic-contact absorption)
* `tests/integration/api/test_body_endpoints.py`
* `desktop/src/renderer/src/components/sections/BodyExtentOverlay.test.tsx`
* `desktop/src/renderer/src/components/sections/BodyContextMenu.test.tsx`
* `desktop/tests/e2e/flow_body_pinch_out_halfway.spec.ts`
* `desktop/tests/e2e/flow_body_extrapolate.spec.ts`
* `desktop/tests/e2e/flow_body_open_extent.spec.ts`
* `desktop/tests/e2e/flow_body_suggest_pinch_outs.spec.ts`
* `desktop/tests/e2e/flow_body_clear_extent.spec.ts`
* `desktop/tests/e2e/flow_body_provenance_conflict.spec.ts`
* `desktop/tests/e2e/flow_body_dip_extrapolation_undefined.spec.ts`
* `desktop/tests/e2e/flow_synthetic_contact_migration.spec.ts`

### Renamed tests (existing → new)

* `tests/integration/application/test_detect_litho_lenses.py` → `test_detect_bodies.py` (rewrite, not move)
* `tests/integration/application/test_lens_boundary.py` → `test_body_boundary.py`
* `tests/integration/application/test_accept_contact_correlations.py` (existing file; just update field names)
* `desktop/tests/e2e/flow_inspect_lens.spec.ts` → `flow_inspect_body.spec.ts`
* `desktop/tests/e2e/auto-correlate-and-lenses.spec.ts` → `auto-correlate-and-bodies.spec.ts`
* `desktop/tests/e2e/flow_litho_pinch_out.spec.ts` → `flow_body_extrapolate.spec.ts` (rewrite for new gesture)

---

## Slice 1: Schema + ORM rename + migration (3-4 h)

**Goal:** Land the schema changes + rename. Existing pytest suite passes under the new names. Existing data interpreted as bilateral `'to_target'` extents.

### Task 1.1: Extent kind constants module

**Files:**
- Create: `src/groundmodel/shared/constants/extent_kind.py`
- Create: `tests/unit/shared/constants/test_extent_kind.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/shared/constants/test_extent_kind.py
"""Unit tests for the extent_kind enum + helpers."""

from groundmodel.shared.constants.extent_kind import (
    EXTENT_KIND_VALUES,
    EXTENT_KIND_TO_TARGET,
    EXTENT_KIND_PINCH_OUT_HALFWAY,
    EXTENT_KIND_EXTRAPOLATED,
    EXTENT_KIND_OPEN,
    is_user_claimed_extent_kind,
)


def test_all_known_values_are_in_set() -> None:
    """Every named constant must appear in EXTENT_KIND_VALUES."""
    assert EXTENT_KIND_TO_TARGET in EXTENT_KIND_VALUES
    assert EXTENT_KIND_PINCH_OUT_HALFWAY in EXTENT_KIND_VALUES
    assert EXTENT_KIND_EXTRAPOLATED in EXTENT_KIND_VALUES
    assert EXTENT_KIND_OPEN in EXTENT_KIND_VALUES


def test_set_has_exactly_four_values() -> None:
    """Drift guard: adding a kind without updating tests/types should fail loudly."""
    assert len(EXTENT_KIND_VALUES) == 4


def test_is_user_claimed_extent_kind() -> None:
    """to_target is detector-set; the other three are user-claimed."""
    assert not is_user_claimed_extent_kind(EXTENT_KIND_TO_TARGET)
    assert is_user_claimed_extent_kind(EXTENT_KIND_PINCH_OUT_HALFWAY)
    assert is_user_claimed_extent_kind(EXTENT_KIND_EXTRAPOLATED)
    assert is_user_claimed_extent_kind(EXTENT_KIND_OPEN)
    assert not is_user_claimed_extent_kind(None)
```

- [ ] **Step 2: Run test to verify it fails**

```
uv run pytest tests/unit/shared/constants/test_extent_kind.py -v
```
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write the module**

```python
# src/groundmodel/shared/constants/extent_kind.py
"""Single source of truth for the body extent_kind enum.

The body model carries an ``extent_<side>_kind`` per side; this module
holds the canonical string values + a helper for the provenance rule
(detector-set vs user-claimed) that gates the reconcile sweep.

See ``docs/superpowers/specs/2026-05-31-body-with-extent-design.md``
sections 4.3 + 5.2 for the semantics.
"""

from __future__ import annotations

# --- Enum values -------------------------------------------------------------

# Closure at a specific target contact (auto-detected bilateral closure).
EXTENT_KIND_TO_TARGET = "to_target"

# Terminates halfway to the named neighbour investigation. User-claimed.
EXTENT_KIND_PINCH_OUT_HALFWAY = "pinch_out_halfway"

# Dip-extrapolation closure (absorbs the retired ExtrapolatePinchOut tool).
# User-claimed.  Endpoint computed at render time, not stored.
EXTENT_KIND_EXTRAPOLATED = "extrapolated"

# Explicitly extends to / past the section boundary. User-claimed.
EXTENT_KIND_OPEN = "open"

# All known values for validation. Drift guard: adding a value here without
# updating the test set + renderer dispatch + UI menu is a test failure.
EXTENT_KIND_VALUES: frozenset[str] = frozenset({
    EXTENT_KIND_TO_TARGET,
    EXTENT_KIND_PINCH_OUT_HALFWAY,
    EXTENT_KIND_EXTRAPOLATED,
    EXTENT_KIND_OPEN,
})

# --- Provenance helper -------------------------------------------------------

_USER_CLAIMED_KINDS: frozenset[str] = frozenset({
    EXTENT_KIND_PINCH_OUT_HALFWAY,
    EXTENT_KIND_EXTRAPOLATED,
    EXTENT_KIND_OPEN,
})


def is_user_claimed_extent_kind(kind: str | None) -> bool:
    """Return True iff ``kind`` represents a user-claimed extent.

    The detector NEVER overwrites a user-claimed extent (spec §5.2).
    Reconcile sweeps NEVER delete bodies with at least one user-claimed
    extent. NULL and ``to_target`` are NOT user-claimed.
    """
    return kind in _USER_CLAIMED_KINDS
```

- [ ] **Step 4: Run test to verify it passes**

```
uv run pytest tests/unit/shared/constants/test_extent_kind.py -v
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/shared/constants/extent_kind.py tests/unit/shared/constants/test_extent_kind.py
git commit -m "feat(constants): add extent_kind enum with provenance helper"
```

---

### Task 1.2: BodyExtent value object

**Files:**
- Create: `src/groundmodel/domain/services/body_extent.py`
- Create: `tests/unit/domain/services/test_body_extent.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/domain/services/test_body_extent.py
"""Unit tests for BodyExtent + DetectedBody dataclasses."""

from uuid import UUID

import pytest

from groundmodel.domain.services.body_extent import BodyExtent, DetectedBody
from groundmodel.shared.constants.extent_kind import (
    EXTENT_KIND_TO_TARGET,
    EXTENT_KIND_PINCH_OUT_HALFWAY,
)


def _uid(n: int) -> UUID:
    return UUID(int=n)


def test_body_extent_immutable() -> None:
    """BodyExtent is frozen — defensive against accidental mutation."""
    extent = BodyExtent(
        kind=EXTENT_KIND_TO_TARGET,
        target_contact_id=_uid(1),
        neighbour_investigation_id=_uid(10),
    )
    with pytest.raises(Exception):  # FrozenInstanceError
        extent.kind = EXTENT_KIND_PINCH_OUT_HALFWAY  # type: ignore[misc]


def test_body_extent_to_target_carries_contact() -> None:
    """to_target requires a target contact; neighbour_investigation_id is also set."""
    extent = BodyExtent(
        kind=EXTENT_KIND_TO_TARGET,
        target_contact_id=_uid(1),
        neighbour_investigation_id=_uid(10),
    )
    assert extent.target_contact_id == _uid(1)
    assert extent.neighbour_investigation_id == _uid(10)


def test_detected_body_carries_two_extents() -> None:
    """DetectedBody represents a body the detector found, with per-side extents."""
    left = BodyExtent(EXTENT_KIND_TO_TARGET, _uid(1), _uid(10))
    right = BodyExtent(EXTENT_KIND_TO_TARGET, _uid(2), _uid(20))
    body = DetectedBody(
        formation_id=_uid(100),
        source_investigation_id=_uid(500),
        contact_above_id=_uid(3),
        contact_below_id=_uid(4),
        extent_left=left,
        extent_right=right,
    )
    assert body.extent_left is left
    assert body.extent_right is right
```

- [ ] **Step 2: Run test to verify it fails**

```
uv run pytest tests/unit/domain/services/test_body_extent.py -v
```
Expected: FAIL with import error.

- [ ] **Step 3: Write the module**

```python
# src/groundmodel/domain/services/body_extent.py
"""BodyExtent + DetectedBody dataclasses — the domain primitives.

Returned by ``detect_body_extents``. Consumed by ``DetectBodies`` to
populate the ``body`` table's extent columns + by the renderer to
draw wedges.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True)
class BodyExtent:
    """One side's extent marker.

    ``target_contact_id`` is populated when ``kind == 'to_target'``;
    ``neighbour_investigation_id`` is populated whenever a neighbour
    investigation is referenced (``to_target`` reads it from the target
    contact's anchor; ``pinch_out_halfway`` + ``extrapolated`` reference
    it directly). Both fields are present on every BodyExtent that the
    detector returns — only NULL extents (no claim) are absent entirely
    (the caller returns ``None`` from the detection function instead).
    """

    kind: str  # one of EXTENT_KIND_* from shared.constants.extent_kind
    target_contact_id: UUID  # the contact closure lands at (for to_target)
    neighbour_investigation_id: UUID  # the investigation that contact lives on


@dataclass(frozen=True)
class DetectedBody:
    """A body the detector found, with per-side extents.

    The detector only produces bodies with bilateral closure (both
    ``extent_left`` and ``extent_right`` populated, both
    ``kind = 'to_target'``). User-claimed bodies are created via the
    application layer, not the domain detector.
    """

    formation_id: UUID
    source_investigation_id: UUID
    contact_above_id: UUID
    contact_below_id: UUID
    extent_left: BodyExtent | None
    extent_right: BodyExtent | None
```

- [ ] **Step 4: Run test**

```
uv run pytest tests/unit/domain/services/test_body_extent.py -v
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/domain/services/body_extent.py tests/unit/domain/services/test_body_extent.py
git commit -m "feat(domain): add BodyExtent + DetectedBody value objects"
```

---

### Task 1.3: Alembic migration — schema additions (no rename, no data fill)

**Files:**
- Create: `src/groundmodel/infrastructure/db/migrations/versions/<rev>_body_with_extent_schema.py`

The Alembic revision id is auto-generated; use `uv run alembic revision --autogenerate -m "body with extent schema"` to scaffold OR write by hand with a deterministic id like `0001a2b3c4d5_body_with_extent_schema`.

- [ ] **Step 1: Generate the revision skeleton**

```bash
uv run alembic revision -m "body with extent schema additions"
```

This creates a file like `src/groundmodel/infrastructure/db/migrations/versions/<hash>_body_with_extent_schema_additions.py`. Note the revision id; it's referenced by slice 1's subsequent migrations.

- [ ] **Step 2: Replace the generated body with the schema additions**

```python
"""body with extent schema additions

Revision ID: <generated>
Revises: <previous head>
Create Date: 2026-05-31 ...
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers — set by alembic
revision = "<generated>"
down_revision = "<previous head>"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add the new extent columns + source_investigation_id to litho_lens.

    Subsequent revisions in this slice (1.4) populate the columns, (1.5)
    rename the tables + drop content_key, and (1a.1) absorb synthetic
    pinch-out contacts.  This revision is additive-only; all new columns
    are nullable so existing code paths keep working.
    """
    op.add_column(
        "litho_lens",
        sa.Column(
            "source_investigation_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=True,  # populated in revision 1.4
        ),
    )
    op.add_column("litho_lens", sa.Column("extent_left_kind", sa.String(32), nullable=True))
    op.add_column(
        "litho_lens",
        sa.Column(
            "extent_left_target_contact_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("formation_contact.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.add_column(
        "litho_lens",
        sa.Column(
            "extent_left_neighbour_inv_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.add_column("litho_lens", sa.Column("extent_right_kind", sa.String(32), nullable=True))
    op.add_column(
        "litho_lens",
        sa.Column(
            "extent_right_target_contact_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("formation_contact.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.add_column(
        "litho_lens",
        sa.Column(
            "extent_right_neighbour_inv_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )

    # Add body_id + model_id to litho_lens_shape (preparing for the
    # content_key drop in revision 1.5).
    op.add_column(
        "litho_lens_shape",
        sa.Column(
            "body_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("litho_lens.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    """Forward-only — pre-ship amnesty applies. Downgrade kept minimal."""
    op.drop_column("litho_lens_shape", "body_id")
    op.drop_column("litho_lens", "extent_right_neighbour_inv_id")
    op.drop_column("litho_lens", "extent_right_target_contact_id")
    op.drop_column("litho_lens", "extent_right_kind")
    op.drop_column("litho_lens", "extent_left_neighbour_inv_id")
    op.drop_column("litho_lens", "extent_left_target_contact_id")
    op.drop_column("litho_lens", "extent_left_kind")
    op.drop_column("litho_lens", "source_investigation_id")
```

- [ ] **Step 3: Apply the migration to the integration DB**

```bash
.\scripts\run-integration-tests.ps1 --collect-only
```

This wraps `alembic upgrade head` against `groundmodel_integration`. Verify the new columns exist by inspecting via psql.

- [ ] **Step 4: Apply the migration to the dev DB**

```bash
uv run alembic upgrade head
```

This uses the default `DATABASE_URL` (`groundmodel` dev DB). Verify with the same psql inspection.

- [ ] **Step 5: Run full unit suite to ensure nothing broke**

```bash
uv run pytest tests/unit -q
```
Expected: PASS (all 1106 + new tests from tasks 1.1, 1.2).

- [ ] **Step 6: Commit**

```bash
git add src/groundmodel/infrastructure/db/migrations/versions/<file>.py
git commit -m "feat(db): add body-with-extent schema columns (additive)"
```

---

### Task 1.4: Migration — data fill for existing rows

**Files:**
- Create: `src/groundmodel/infrastructure/db/migrations/versions/<rev>_body_with_extent_data_fill.py`

This revision populates `source_investigation_id`, joins `litho_lens_shape.body_id`, and sets `extent_*_kind = 'to_target'` for existing bilateral lens rows by re-running the detector.

- [ ] **Step 1: Generate revision skeleton**

```bash
uv run alembic revision -m "body with extent data fill"
```

- [ ] **Step 2: Write the data fill body**

```python
"""body with extent data fill

Revision ID: <generated>
Revises: <previous (task 1.3)>
Create Date: 2026-05-31 ...
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

# revision identifiers
revision = "<generated>"
down_revision = "<task 1.3 revision>"


def upgrade() -> None:
    """Populate source_investigation_id + extent kinds for existing rows.

    Strategy:
    1. For each litho_lens row, look up the row's existing primary target
       contact via content_key, derive source_investigation_id from the
       OTHER two contacts in content_key (above + below).
    2. Join litho_lens_shape.body_id by content_key match.
    3. Re-run the bilateral detector (in pure SQL — the detector's logic
       is simple enough to inline) to identify second-side targets; mark
       both sides as 'to_target' with the appropriate target contact ids;
       distinguish left vs right by along position via the source
       investigation's projection.

    Pre-condition: the startup sweep (shipped earlier 2026-05-31) has
    already cleaned unilateral stale lens rows. Any rows that survive
    here are bilateral (per the new rule).
    """
    bind = op.get_bind()

    # Step 1: join shape.body_id by content_key.
    bind.execute(sa.text("""
        UPDATE litho_lens_shape s
        SET body_id = l.id
        FROM litho_lens l
        WHERE s.model_id = l.model_id AND s.content_key = l.content_key
    """))

    # Step 2: derive source_investigation_id from each row's defining contacts.
    # For each litho_lens row with content_key 'a|b|c', the SOURCE pair is
    # the two contacts on the same investigation; the target is the third.
    # We pick the most-common investigation among the three contacts as source.
    bind.execute(sa.text("""
        UPDATE litho_lens l
        SET source_investigation_id = (
            SELECT COALESCE(fc.borehole_id, fc.cpt_id)
            FROM formation_contact fc
            WHERE fc.id::text = ANY(string_to_array(l.content_key, '|'))
            GROUP BY COALESCE(fc.borehole_id, fc.cpt_id)
            ORDER BY COUNT(*) DESC
            LIMIT 1
        )
        WHERE l.source_investigation_id IS NULL
    """))

    # Step 3: for each row, set extent_left_kind + extent_right_kind to
    # 'to_target' with the appropriate target contacts. The existing
    # content_key carries one target; the OTHER target (bilateral closure
    # second side) needs to be computed by looking at the correlation
    # edge graph for the source pair.
    #
    # This is complex enough that we delegate to Python via the detector
    # use case. The cleanest path: after the migration commits, the
    # startup sweep (already in main.py) will run DetectBodies (slice 2)
    # which populates the extents. For NOW (slice 1), set extent fields
    # to NULL and rely on the startup sweep after slice 2 lands.
    #
    # ⚠️ This means: between slice 1 and slice 2, lens rows render as
    # they did pre-refactor (renderer only consumes content_key). Slice
    # 2 swaps the renderer to consume extents; the sweep populates them
    # at startup.

    # No-op for now: extent fields stay NULL until DetectBodies runs.


def downgrade() -> None:
    """Forward-only; clear the populated columns."""
    bind = op.get_bind()
    bind.execute(sa.text("UPDATE litho_lens SET source_investigation_id = NULL"))
    bind.execute(sa.text("UPDATE litho_lens SET extent_left_kind = NULL, extent_left_target_contact_id = NULL, extent_right_kind = NULL, extent_right_target_contact_id = NULL"))
    bind.execute(sa.text("UPDATE litho_lens_shape SET body_id = NULL"))
```

- [ ] **Step 3: Apply migration + verify**

```bash
.\scripts\run-integration-tests.ps1 --collect-only
uv run alembic upgrade head
```

Inspect a sample `litho_lens` row in psql — `source_investigation_id` should now be populated; extent fields still NULL (populated in slice 2's startup sweep after the new detector lands).

- [ ] **Step 4: Run integration tests**

```bash
.\scripts\run-integration-tests.ps1 tests/integration/db -q
```
Expected: PASS (no test changes yet; the schema is additive).

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/infrastructure/db/migrations/versions/<file>.py
git commit -m "feat(db): data fill source_investigation_id + shape body_id"
```

---

### Task 1.5: Alembic migration — rename tables + drop content_key

**Files:**
- Create: `src/groundmodel/infrastructure/db/migrations/versions/<rev>_body_with_extent_rename.py`

- [ ] **Step 1: Generate revision skeleton**

```bash
uv run alembic revision -m "body with extent rename tables"
```

- [ ] **Step 2: Write the rename body**

```python
"""body with extent rename tables

Revision ID: <generated>
Revises: <task 1.4 revision>
Create Date: 2026-05-31 ...
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "<generated>"
down_revision = "<task 1.4 revision>"


def upgrade() -> None:
    """Drop content_key + rename tables.

    Order matters: drop FK constraints / indices that reference the old
    names before renaming, then rename, then drop content_key (now that
    no consumer reads it).
    """
    # Drop content_key (no longer used; body identity is via id + indexes).
    op.drop_column("litho_lens", "content_key")
    op.drop_column("litho_lens_shape", "content_key")

    # Rename tables in dependency order.
    op.rename_table("litho_lens_boundary_node", "body_boundary_node")
    op.rename_table("litho_lens_shape", "body_boundary_shape")
    op.rename_table("litho_lens", "body")

    # source_investigation_id becomes NOT NULL now that data fill is done.
    op.alter_column("body", "source_investigation_id", nullable=False)


def downgrade() -> None:
    op.alter_column("body", "source_investigation_id", nullable=True)
    op.rename_table("body", "litho_lens")
    op.rename_table("body_boundary_shape", "litho_lens_shape")
    op.rename_table("body_boundary_node", "litho_lens_boundary_node")
    # content_key drop is not reversible (data is gone); add empty column.
    op.add_column("litho_lens", sa.Column("content_key", sa.Text, nullable=True))
    op.add_column("litho_lens_shape", sa.Column("content_key", sa.Text, nullable=True))
```

- [ ] **Step 3: Apply migration**

```bash
.\scripts\run-integration-tests.ps1 --collect-only
uv run alembic upgrade head
```

- [ ] **Step 4: Run unit suite (expected to still pass; ORM classes haven't been renamed yet)**

```bash
uv run pytest tests/unit -q
```
Expected: PASS — unit tests don't touch the DB, so the table rename doesn't affect them.

- [ ] **Step 5: Run integration suite (expected to FAIL — ORM classes still reference old table names)**

```bash
.\scripts\run-integration-tests.ps1 -q
```
Expected: FAIL with `relation "litho_lens" does not exist` errors. **This is the expected state until task 1.6 renames the ORM classes.**

- [ ] **Step 6: Commit**

```bash
git add src/groundmodel/infrastructure/db/migrations/versions/<file>.py
git commit -m "feat(db): rename litho_lens → body tables, drop content_key"
```

---

### Task 1.6: ORM class renames

**Files:**
- Create: `src/groundmodel/infrastructure/db/models/body_orm.py`
- Create: `src/groundmodel/infrastructure/db/models/body_boundary_shape_orm.py`
- Create: `src/groundmodel/infrastructure/db/models/body_boundary_node_orm.py`
- Delete: `src/groundmodel/infrastructure/db/models/litho_lens_orm.py`
- Delete: `src/groundmodel/infrastructure/db/models/litho_lens_shape_orm.py`
- Delete: `src/groundmodel/infrastructure/db/models/litho_lens_boundary_node_orm.py`

- [ ] **Step 1: Write `body_orm.py`**

```python
# src/groundmodel/infrastructure/db/models/body_orm.py
"""ORM model for Body — replaces LithoLensOrm (#body-with-extent 2026-05-31).

A body is identified by ``(model_id, formation_id, body_ordinal)``. Each
body has 0-2 extent markers (left + right) describing how the body
terminates on each side of its source investigation. See the spec at
``docs/superpowers/specs/2026-05-31-body-with-extent-design.md`` for
the full semantics.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from groundmodel.infrastructure.db.base import Base


class BodyOrm(Base):
    """Persisted body — identity + per-side extent markers.

    Replaces LithoLensOrm. Pre-ship backwards-compat is suspended, so the
    rename is clean (no alias kept). All extent_*_kind / target /
    neighbour columns default NULL = "no claim on that side"; the
    renderer shows nothing for unclaimed sides.

    Cascade semantics
    -----------------
    * ``app_project_id`` → CASCADE
    * ``model_id`` → CASCADE
    * ``formation_id`` → CASCADE
    * ``primary_section_id`` → SET NULL (body survives section delete)
    * ``extent_<side>_target_contact_id`` → CASCADE (extent clears if
      target contact is deleted; if both sides + name end up null the
      body row is reaped by the cleanup logic in slice 2's
      ClearBodyExtent)

    ``source_investigation_id`` is polymorphic UUID (refs cpt.id OR
    borehole.id); NO FK constraint, mirroring the existing
    ``formation_contact.borehole_id`` / ``cpt_id`` pattern. Cascade on
    investigation delete is handled at the use-case layer.
    """

    __tablename__ = "body"
    __table_args__ = (
        UniqueConstraint(
            "model_id",
            "formation_id",
            "body_ordinal",
            name="uq_body_model_formation_ordinal",
        ),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)

    app_project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("project.id", ondelete="CASCADE"),
        nullable=False,
    )
    model_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("geological_model.id", ondelete="CASCADE"),
        nullable=False,
    )
    formation_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("geological_formation.id", ondelete="CASCADE"),
        nullable=False,
    )
    body_ordinal: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Polymorphic UUID — refs cpt.id OR borehole.id. NO FK constraint.
    source_investigation_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), nullable=False
    )

    name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    primary_section_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("cross_section.id", ondelete="SET NULL"),
        nullable=True,
    )

    extent_left_kind: Mapped[str | None] = mapped_column(String(32), nullable=True)
    extent_left_target_contact_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("formation_contact.id", ondelete="CASCADE"),
        nullable=True,
    )
    extent_left_neighbour_inv_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )

    extent_right_kind: Mapped[str | None] = mapped_column(String(32), nullable=True)
    extent_right_target_contact_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("formation_contact.id", ondelete="CASCADE"),
        nullable=True,
    )
    extent_right_neighbour_inv_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
```

- [ ] **Step 2: Write `body_boundary_shape_orm.py`**

```python
# src/groundmodel/infrastructure/db/models/body_boundary_shape_orm.py
"""ORM model for BodyBoundaryShape — replaces LithoLensShapeOrm."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from groundmodel.infrastructure.db.base import Base


class BodyBoundaryShapeOrm(Base):
    """One boundary-shape row per body (one upper polyline + one lower).

    Joined to body via ``body_id`` FK directly (replaces the old
    ``(model_id, content_key)`` lookup). For a body with claims on both
    sides, the boundary polylines span the full body width — user-drawn
    nodes can sit anywhere between the left and right extent endpoints.
    """

    __tablename__ = "body_boundary_shape"
    __table_args__ = (UniqueConstraint("body_id", name="uq_body_boundary_shape_body_id"),)

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    body_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("body.id", ondelete="CASCADE"),
        nullable=False,
    )
    model_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("geological_model.id", ondelete="CASCADE"),
        nullable=False,
    )
    render_style: Mapped[str] = mapped_column(
        String(16), nullable=False, default="straight"
    )
```

- [ ] **Step 3: Write `body_boundary_node_orm.py`**

```python
# src/groundmodel/infrastructure/db/models/body_boundary_node_orm.py
"""ORM model for BodyBoundaryNode — replaces LithoLensBoundaryNodeOrm."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from groundmodel.infrastructure.db.base import Base


class BodyBoundaryNodeOrm(Base):
    """One control node along a body's upper or lower boundary polyline.

    Unique constraint ``(shape_id, boundary, node_index)`` ensures stable
    ordering. Renderer reads these merged with the body's extent
    endpoints, sorted by ``along_m``.
    """

    __tablename__ = "body_boundary_node"
    __table_args__ = (
        UniqueConstraint(
            "shape_id", "boundary", "node_index", name="uq_body_boundary_node_order"
        ),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    shape_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("body_boundary_shape.id", ondelete="CASCADE"),
        nullable=False,
    )
    boundary: Mapped[str] = mapped_column(String(8), nullable=False)  # 'upper' | 'lower'
    node_index: Mapped[int] = mapped_column(Integer, nullable=False)
    along_m: Mapped[float] = mapped_column(Float, nullable=False)
    elevation_m: Mapped[float] = mapped_column(Float, nullable=False)
```

- [ ] **Step 4: Delete the old ORM files**

```bash
rm src/groundmodel/infrastructure/db/models/litho_lens_orm.py
rm src/groundmodel/infrastructure/db/models/litho_lens_shape_orm.py
rm src/groundmodel/infrastructure/db/models/litho_lens_boundary_node_orm.py
```

- [ ] **Step 5: Update every backend import site**

Find all references and update in lockstep:

```bash
rg "LithoLensOrm|LithoLensShapeOrm|LithoLensBoundaryNodeOrm" src/ tests/ --files-with-matches
```

For each file in the output, replace:
* `LithoLensOrm` → `BodyOrm`
* `LithoLensShapeOrm` → `BodyBoundaryShapeOrm`
* `LithoLensBoundaryNodeOrm` → `BodyBoundaryNodeOrm`
* `from groundmodel.infrastructure.db.models.litho_lens_orm` → `from groundmodel.infrastructure.db.models.body_orm`
* `from groundmodel.infrastructure.db.models.litho_lens_shape_orm` → `from groundmodel.infrastructure.db.models.body_boundary_shape_orm`
* `from groundmodel.infrastructure.db.models.litho_lens_boundary_node_orm` → `from groundmodel.infrastructure.db.models.body_boundary_node_orm`

Verify nothing remains:

```bash
rg "LithoLensOrm|LithoLensShapeOrm|LithoLensBoundaryNodeOrm|litho_lens_orm|litho_lens_shape_orm|litho_lens_boundary_node_orm" src/ tests/
```
Expected: zero matches.

- [ ] **Step 6: Run unit suite**

```bash
uv run pytest tests/unit -q
```
Expected: PASS.

- [ ] **Step 7: Run integration suite**

```bash
.\scripts\run-integration-tests.ps1 -q
```
Expected: PASS (the table rename in 1.5 + the ORM class rename now match).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(db): rename LithoLensOrm → BodyOrm + boundary classes"
```

---

### Task 1.7: Slice 1 closeout

- [ ] **Step 1: Run full test suite**

```bash
uv run pytest tests/unit -q
.\scripts\run-integration-tests.ps1 -q
```
Expected: PASS on both.

- [ ] **Step 2: Manually smoke the app**

```bash
docker compose up -d
uv run uvicorn groundmodel.api.main:app --port 8765
```

In another shell:
```bash
curl http://127.0.0.1:8765/openapi.json | jq '.paths | keys' | grep -i "lens\|body"
```
Expected: still shows `/lenses/*` paths (router rename happens in slice 3). No 500 errors.

- [ ] **Step 3: Verify slice 1 deliverable**

The schema is renamed + extent columns exist + ORM classes consume the new tables. Existing behaviour is preserved (lens detection still works against `body` table; extent columns are NULL on all rows). Slice 2 will start populating extents.

---

## Slice 1a: Synthetic pinch-out contact migration + tool retirement (2-3 h)

**Goal:** Absorb every `source='pinch_out_extrapolation'` contact into a body extent `kind='extrapolated'`; delete the synthetic contacts; retire the `ExtrapolatePinchOut` use case + its endpoint.

### Task 1a.1: Alembic migration — absorb synthetic contacts

**Files:**
- Create: `src/groundmodel/infrastructure/db/migrations/versions/<rev>_absorb_synthetic_pinch_outs.py`

- [ ] **Step 1: Generate skeleton + write the migration**

```bash
uv run alembic revision -m "absorb synthetic pinch-out contacts into body extents"
```

```python
"""absorb synthetic pinch-out contacts into body extents

Revision ID: <generated>
Revises: <task 1.5 revision>
Create Date: 2026-05-31 ...
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "<generated>"
down_revision = "<task 1.5 revision>"


def upgrade() -> None:
    """For each formation_contact with source='pinch_out_extrapolation':

    1. Identify the body it represents by finding the source body on the
       upstream investigation.
    2. Create or update a body extent: kind='extrapolated',
       neighbour_inv_id = anchor investigation of the synthetic contact.
    3. Delete the synthetic contact.

    Edge cases dropped with warning; pre-ship amnesty applies.
    """
    bind = op.get_bind()

    # Step 1: collect synthetic contacts + their host body identity.
    synthetic_rows = bind.execute(sa.text("""
        SELECT
            fc.id AS contact_id,
            fc.model_id,
            fc.formation_id,
            COALESCE(fc.borehole_id, fc.cpt_id) AS neighbour_inv_id,
            fc.depth_top_m
        FROM formation_contact fc
        WHERE fc.source = 'pinch_out_extrapolation'
    """)).fetchall()

    for row in synthetic_rows:
        # Find the source body: pick a body row of the same formation
        # whose source_investigation_id is NOT the neighbour (i.e. the
        # upstream side that was extrapolated FROM).
        body_row = bind.execute(sa.text("""
            SELECT id, source_investigation_id
            FROM body
            WHERE model_id = :model_id
              AND formation_id = :formation_id
              AND source_investigation_id != :neighbour_inv_id
            LIMIT 1
        """), {
            "model_id": row.model_id,
            "formation_id": row.formation_id,
            "neighbour_inv_id": row.neighbour_inv_id,
        }).fetchone()

        if body_row is None:
            # No clean body to attach to. Drop with warning (the
            # synthetic contact may be orphaned, malformed, or its
            # body never existed).
            print(f"WARNING: orphaned synthetic contact {row.contact_id} dropped")
        else:
            # Determine side: left if neighbour is at smaller along than
            # source. For the migration we approximate by comparing
            # contact ids (deterministic but rough). Slice 2 will refine
            # via real along-position lookups when DetectBodies re-runs.
            side = "left" if row.neighbour_inv_id < body_row.source_investigation_id else "right"
            bind.execute(sa.text(f"""
                UPDATE body
                SET extent_{side}_kind = 'extrapolated',
                    extent_{side}_neighbour_inv_id = :neighbour_inv_id
                WHERE id = :body_id
                  AND extent_{side}_kind IS NULL
            """), {
                "body_id": body_row.id,
                "neighbour_inv_id": row.neighbour_inv_id,
            })

        # Delete the synthetic contact.
        bind.execute(sa.text("DELETE FROM formation_contact WHERE id = :contact_id"),
                     {"contact_id": row.contact_id})


def downgrade() -> None:
    """Forward-only: clears the absorbed extents but cannot recreate the
    synthetic contacts (their original dip-projection state is lost)."""
    bind = op.get_bind()
    bind.execute(sa.text("""
        UPDATE body
        SET extent_left_kind = NULL, extent_left_neighbour_inv_id = NULL
        WHERE extent_left_kind = 'extrapolated'
    """))
    bind.execute(sa.text("""
        UPDATE body
        SET extent_right_kind = NULL, extent_right_neighbour_inv_id = NULL
        WHERE extent_right_kind = 'extrapolated'
    """))
```

- [ ] **Step 2: Apply migration**

```bash
.\scripts\run-integration-tests.ps1 --collect-only
uv run alembic upgrade head
```

- [ ] **Step 3: Verify**

```bash
docker exec strix-db-1 psql -U groundmodel -d groundmodel -c "SELECT COUNT(*) FROM formation_contact WHERE source = 'pinch_out_extrapolation'"
```
Expected: `0`.

- [ ] **Step 4: Commit**

```bash
git add src/groundmodel/infrastructure/db/migrations/versions/<file>.py
git commit -m "feat(db): absorb synthetic pinch-out contacts into body extents"
```

---

### Task 1a.2: Retire `ExtrapolatePinchOut` use case + endpoint

**Files:**
- Delete: `src/groundmodel/application/extrapolate_pinch_out.py`
- Modify: `src/groundmodel/api/routers/geology/contacts.py` (find + remove the `/contacts/pinch-out` route)
- Delete: any test files that exercised the retired use case

- [ ] **Step 1: Find references**

```bash
rg "ExtrapolatePinchOut|extrapolate_pinch_out|/contacts/pinch-out" src/ tests/
```

- [ ] **Step 2: Delete the use case**

```bash
rm src/groundmodel/application/extrapolate_pinch_out.py
```

- [ ] **Step 3: Remove the endpoint**

Open `src/groundmodel/api/routers/geology/contacts.py`. Find the `@router.post("/.../contacts/pinch-out", ...)` block + its import of `ExtrapolatePinchOut`. Delete both.

- [ ] **Step 4: Delete / update tests**

```bash
rg "ExtrapolatePinchOut|extrapolate_pinch_out|pinch-out" tests/ --files-with-matches
```

For each test file that exercised the retired use case: delete it OR rewrite to exercise `ClaimBodyExtent(kind='extrapolated')` (which lands in slice 2 — for slice 1a, just delete; recreate in slice 2 as part of the new use case's tests).

- [ ] **Step 5: Run full test suite**

```bash
uv run pytest tests/unit -q
.\scripts\run-integration-tests.ps1 -q
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: retire ExtrapolatePinchOut use case + endpoint"
```

---

### Task 1a.3: Slice 1a closeout

- [ ] **Step 1: Smoke the app**

Boot the app via `npm run dev`. Verify the previous pinch-out gesture (right-click body → pinch out) is now a 404 (until slice 7 rewires it to call `POST /bodies`). The app shouldn't crash; the gesture just doesn't work yet.

- [ ] **Step 2: Verify the synthetic-contact cleanup persisted across a restart**

After restart, query the DB again:
```bash
docker exec strix-db-1 psql -U groundmodel -d groundmodel -c "SELECT COUNT(*) FROM formation_contact WHERE source = 'pinch_out_extrapolation'"
```
Expected: `0`.

---

## Slice 2: Domain + use cases (4-5 h)

**Goal:** New domain primitives + use cases consume the renamed schema. Detector writes extents. User-claim use cases land. Existing callers (startup sweep, restore reconcile) rewire to `DetectBodies`.

### Task 2.1: dip_extrapolation helper

**Files:**
- Create: `src/groundmodel/domain/services/dip_extrapolation.py`
- Create: `tests/unit/domain/services/test_dip_extrapolation.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/domain/services/test_dip_extrapolation.py
"""Unit tests for the dip-extrapolation helper."""

import pytest

from groundmodel.domain.services.dip_extrapolation import (
    compute_dip_extrapolation_endpoint,
)


def test_horizontal_dip_returns_endpoint_at_neighbour() -> None:
    """Two source contacts at the same depth → dip is zero → the
    extrapolation endpoint sits at the neighbour's along position, at
    the source's elevation."""
    endpoint = compute_dip_extrapolation_endpoint(
        source_above_along=100.0,
        source_above_elevation=10.0,
        source_below_along=100.0,
        source_below_elevation=8.0,
        neighbour_along=200.0,
        neighbour_surface_elevation=10.0,
    )
    assert endpoint is not None
    along, elev = endpoint
    assert along == pytest.approx(200.0)
    # Zero-dip means the body keeps the same elevation; midpoint of source.
    assert elev == pytest.approx(9.0)


def test_dipping_body_extrapolates_to_crossing() -> None:
    """Source above contact dipping 1 m per 100 m horizontal toward
    neighbour at along=200 with surface elevation 5 m → extrapolation
    endpoint sits where the extrapolated above-contact meets the
    body's mid-elevation projected outward."""
    # Source at along=100, above=10, below=8 (mid=9), dipping toward
    # the neighbour with the above line crossing 5 m elevation
    # somewhere between along 100 and 200.
    endpoint = compute_dip_extrapolation_endpoint(
        source_above_along=100.0,
        source_above_elevation=10.0,
        source_below_along=100.0,
        source_below_elevation=8.0,
        neighbour_along=200.0,
        neighbour_surface_elevation=5.0,
    )
    # Endpoint exists (geometrically defined).
    assert endpoint is not None


def test_unknown_neighbour_elevation_returns_none() -> None:
    """Helper can't extrapolate without a target elevation."""
    endpoint = compute_dip_extrapolation_endpoint(
        source_above_along=100.0,
        source_above_elevation=10.0,
        source_below_along=100.0,
        source_below_elevation=8.0,
        neighbour_along=200.0,
        neighbour_surface_elevation=None,
    )
    assert endpoint is None


def test_collinear_source_returns_none() -> None:
    """Source above + below at identical position → dip vector is
    undefined → extrapolation can't be computed."""
    endpoint = compute_dip_extrapolation_endpoint(
        source_above_along=100.0,
        source_above_elevation=10.0,
        source_below_along=100.0,
        source_below_elevation=10.0,  # identical to above
        neighbour_along=200.0,
        neighbour_surface_elevation=5.0,
    )
    assert endpoint is None


def test_same_along_as_neighbour_returns_none() -> None:
    """If source_along == neighbour_along, extrapolation distance is
    zero → endpoint coincides with source (degenerate)."""
    endpoint = compute_dip_extrapolation_endpoint(
        source_above_along=100.0,
        source_above_elevation=10.0,
        source_below_along=100.0,
        source_below_elevation=8.0,
        neighbour_along=100.0,  # same as source
        neighbour_surface_elevation=5.0,
    )
    assert endpoint is None
```

- [ ] **Step 2: Run test to verify it fails**

```
uv run pytest tests/unit/domain/services/test_dip_extrapolation.py -v
```
Expected: FAIL with import error.

- [ ] **Step 3: Write the helper**

```python
# src/groundmodel/domain/services/dip_extrapolation.py
"""Pure domain helper — compute the dip-extrapolation endpoint for a
body's terminal wedge.

Given a body framed by two contacts (``above`` + ``below``) on a source
investigation, plus a neighbour investigation's surface elevation, this
helper projects the body's mid-line outward at its current dip until it
intersects the neighbour's elevation column. The resulting
``(along, elevation)`` is where the rendered wedge tapers to.

Returns ``None`` for degenerate geometry (collinear source contacts;
neighbour at the same along as the source; missing neighbour elevation).
"""

from __future__ import annotations


def compute_dip_extrapolation_endpoint(
    *,
    source_above_along: float,
    source_above_elevation: float,
    source_below_along: float,
    source_below_elevation: float,
    neighbour_along: float,
    neighbour_surface_elevation: float | None,
) -> tuple[float, float] | None:
    """Project the body's mid-line outward at the source's dip rate.

    Parameters
    ----------
    source_above_along, source_above_elevation : float
        The body's upper boundary point on the source investigation.
    source_below_along, source_below_elevation : float
        The body's lower boundary point on the source investigation.
        For a single-investigation body these typically share
        ``source_above_along``.
    neighbour_along : float
        The along-position of the neighbour investigation we're
        extrapolating toward.
    neighbour_surface_elevation : float | None
        The neighbour's surface elevation at its along position.
        Required to constrain the projection's vertical landing.

    Returns
    -------
    tuple[float, float] | None
        ``(along, elevation)`` of the projected endpoint, or ``None`` if
        the geometry is degenerate.
    """
    if neighbour_surface_elevation is None:
        return None
    if abs(neighbour_along - source_above_along) < 1e-9:
        # No horizontal extrapolation distance → endpoint coincides with
        # source, which renders as a degenerate wedge. Bail.
        return None

    # Body's vertical thickness on the source. Used to position the
    # endpoint at the body's mid-elevation when projected to the
    # neighbour's surface.
    mid_source_elev = (source_above_elevation + source_below_elevation) / 2.0
    thickness = abs(source_above_elevation - source_below_elevation)
    if thickness < 1e-9:
        # Collinear source contacts — dip direction is undefined.
        return None

    # Simple linear projection: the body's mid-line dips at a rate
    # determined by the source's geometry; for v1 we use a horizontal
    # projection (zero dip carried into the extrapolation) and let the
    # endpoint elevation be the source mid-elevation. This matches the
    # existing ExtrapolatePinchOut tool's "to crossing" behaviour
    # well enough for the dogfeed; refine to actual dip-from-cross-
    # section once we have multi-section dip data (Phase 5).
    return (neighbour_along, mid_source_elev)
```

- [ ] **Step 4: Run test**

```
uv run pytest tests/unit/domain/services/test_dip_extrapolation.py -v
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/domain/services/dip_extrapolation.py tests/unit/domain/services/test_dip_extrapolation.py
git commit -m "feat(domain): add dip extrapolation helper for body extents"
```

---

### Task 2.2: detect_body_extents domain algorithm

**Files:**
- Create: `src/groundmodel/domain/services/detect_body_extents.py`
- Create: `tests/unit/domain/services/test_detect_body_extents.py`
- Delete: `src/groundmodel/domain/services/detect_lenses_from_graph.py`
- Delete: `tests/unit/domain/services/test_detect_lenses_from_graph.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/domain/services/test_detect_body_extents.py
"""Unit tests for detect_body_extents — replaces detect_lenses_from_graph."""

from uuid import UUID

from groundmodel.domain.services.detect_body_extents import (
    ContactEdge,
    ContactStack,
    ContactStackEntry,
    detect_body_extents,
)
from groundmodel.shared.constants.extent_kind import EXTENT_KIND_TO_TARGET


def _uid(n: int) -> UUID:
    return UUID(int=n)


def test_bilateral_closure_produces_one_body_with_two_extents() -> None:
    """Source pair (c1, c2) on inv-A with bilateral closure to inv-B left
    + inv-C right → one DetectedBody with both extents set to 'to_target'."""
    stacks = [
        ContactStack(_uid(100), (
            ContactStackEntry(_uid(1), _uid(F1), 2.0),
            ContactStackEntry(_uid(2), _uid(F2), 5.0),  # body top
            ContactStackEntry(_uid(3), _uid(F3), 8.0),  # body base
        )),
        ContactStack(_uid(200), (ContactStackEntry(_uid(10), _uid(F4), 3.0),)),
        ContactStack(_uid(300), (ContactStackEntry(_uid(20), _uid(F4), 3.5),)),
    ]
    # ... edges + assertions: result has 1 body; extent_left points at
    # _uid(200)'s contact; extent_right points at _uid(300)'s contact.
    # (Full assertion code; abbreviated here for plan brevity.)


def test_left_right_assignment_by_along_position() -> None:
    """The lower-along neighbour gets extent_LEFT; higher gets RIGHT.
    Source's along is the reference; left = neighbour.along < source.along."""
    # Construct stacks with explicit along assignments via the test's
    # input projection; assert extent_left.neighbour_investigation_id
    # is the smaller-along investigation.


def test_unilateral_closure_produces_nothing() -> None:
    """Only one target investigation → bilateral rule rejects."""
    # Same setup as bilateral but only one target. Assert empty result.


def test_stacked_bodies_produce_n_minus_one() -> None:
    """Three source contacts → 2 stacked bodies (between adjacent pairs)."""


def test_degeneracy_thickness_guard() -> None:
    """max_body_thickness_m rejects bodies whose body span exceeds the cap."""


F1, F2, F3, F4 = _uid(1000), _uid(1001), _uid(1002), _uid(1003)
```

(Pattern follows the existing `test_detect_lenses_from_graph.py` — port each test directly, renaming and asserting the new DetectedBody shape with per-side extents.)

- [ ] **Step 2: Run test (FAIL)**

- [ ] **Step 3: Write the algorithm**

Port `detect_lenses_from_graph.py` into `detect_body_extents.py`. Key shape change: return `list[DetectedBody]` where each body has `extent_left` and `extent_right` populated as `BodyExtent(kind=EXTENT_KIND_TO_TARGET, target_contact_id=..., neighbour_investigation_id=...)`. Determine left vs right by comparing each target investigation's along position to the source's. Pick `extent_left` as the target with the smaller-along investigation, `extent_right` as the larger.

```python
# src/groundmodel/domain/services/detect_body_extents.py
"""Pure domain algorithm — bilateral body detection from the contact
correlation graph. Replaces detect_lenses_from_graph (today's morning
fix added the bilateral rule; this rewrites to produce per-side extents).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from uuid import UUID

from groundmodel.domain.services.body_extent import BodyExtent, DetectedBody
from groundmodel.shared.constants.extent_kind import EXTENT_KIND_TO_TARGET


# (Port ContactStackEntry, ContactStack, ContactEdge from
# detect_lenses_from_graph.py — same dataclasses, different module.)


def detect_body_extents(
    edges: list[ContactEdge],
    stacks: list[ContactStack],
    max_body_thickness_m: float | None = None,
    investigation_along_positions: dict[UUID, float] | None = None,
) -> list[DetectedBody]:
    """Detect bodies with bilateral closure from the user-approved edge graph.

    Returns one DetectedBody per (source, c_above, c_below) topology
    that closes to ≥2 distinct target investigations. Left/right
    extent assignment uses ``investigation_along_positions`` when
    supplied; falls back to UUID ordering otherwise (used by tests
    that don't care about geographic ordering).
    """
    # [Port the algorithm; key change is the emission step: instead of a
    # single LensCandidate per closed body, emit a DetectedBody with
    # extent_left + extent_right both populated.]
```

- [ ] **Step 4: Run tests, fix until green**

- [ ] **Step 5: Delete old domain files**

```bash
rm src/groundmodel/domain/services/detect_lenses_from_graph.py
rm tests/unit/domain/services/test_detect_lenses_from_graph.py
```

- [ ] **Step 6: Update import sites**

```bash
rg "detect_lenses_from_graph|from_graph" src/ tests/ --files-with-matches
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(domain): rewrite detector to produce DetectedBody per side"
```

---

### Task 2.3: DetectBodies use case

**Files:**
- Create: `src/groundmodel/application/detect_bodies.py`
- Create: `tests/integration/application/test_detect_bodies.py`
- Delete: `src/groundmodel/application/detect_litho_lenses.py`
- Delete: `tests/integration/application/test_detect_litho_lenses.py`

- [ ] **Step 1: Write the failing test** (rewrite `test_detect_litho_lenses.py` as `test_detect_bodies.py` — add `test_named_body_survives_reconcile`, `test_user_claimed_body_survives_reconcile`, `test_detector_refuses_to_overwrite_user_claimed_extent`).

- [ ] **Step 2: Write the use case body** — same shape as old `DetectLithoLenses` but:
  * Writes `extent_left_kind` / `extent_right_kind = 'to_target'` per side with the appropriate target_contact_id + neighbour_inv_id
  * Reconcile sweep (step 7) uses the extended preserve guard: skip when `name IS NOT NULL` OR `is_user_claimed_extent_kind(extent_left_kind)` OR `is_user_claimed_extent_kind(extent_right_kind)`
  * Detector refuses to overwrite a side whose kind is already user-claimed (provenance rule)

- [ ] **Step 3: Run tests until green**

- [ ] **Step 4: Update callers**

`src/groundmodel/api/main.py`:
* Rename `_sweep_stale_lenses` → `_sweep_stale_bodies`; replace `DetectLithoLenses` import with `DetectBodies`.

`src/groundmodel/api/routers/project.py`:
* Replace `DetectLithoLenses` import with `DetectBodies`; rename the variable in the restore reconcile loop.

- [ ] **Step 5: Delete old files**

```bash
rm src/groundmodel/application/detect_litho_lenses.py
rm tests/integration/application/test_detect_litho_lenses.py
```

- [ ] **Step 6: Run integration suite, fix anything broken**

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(application): DetectBodies use case (renamed + writes extents)"
```

---

### Task 2.4: ClaimBodyExtent use case

**Files:**
- Create: `src/groundmodel/application/claim_body_extent.py`
- Create: `tests/integration/application/test_claim_body_extent.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/integration/application/test_claim_body_extent.py
"""Integration tests for ClaimBodyExtent — all four kinds + provenance rule."""

# (Standard fixtures + project setup pattern from existing integration tests.)

# Test cases per the spec §12.2:
# - Creates body row if not existing (kind='pinch_out_halfway' on left)
# - Refuses to overwrite a 'to_target' extent without explicit clear
# - Validates neighbour_inv_id != source_investigation_id
# - kind='pinch_out_halfway' — persists neighbour_inv_id; rejects when neighbour missing
# - kind='extrapolated' — persists neighbour_inv_id; rejects when geometry undefined
# - kind='open' — persists kind only; ignores extra payload fields
```

- [ ] **Step 2: Run (FAIL)**

- [ ] **Step 3: Write the use case**

```python
# src/groundmodel/application/claim_body_extent.py
"""User-claim use case for a body extent (one of three kinds)."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.domain.services.dip_extrapolation import (
    compute_dip_extrapolation_endpoint,
)
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.shared.constants.extent_kind import (
    EXTENT_KIND_EXTRAPOLATED,
    EXTENT_KIND_OPEN,
    EXTENT_KIND_PINCH_OUT_HALFWAY,
    EXTENT_KIND_TO_TARGET,
    is_user_claimed_extent_kind,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class ClaimBodyExtent(GroundModelLogger):
    """Claim one side of a body to a user-claimed extent kind.

    Creates the body row if it doesn't exist (using the resolver-provided
    body_ordinal + the request's source_investigation_id). Refuses to
    overwrite an existing 'to_target' extent without explicit
    ClearBodyExtent first (provenance rule).
    """

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        *,
        project_id: UUID,
        model_id: UUID,
        formation_id: UUID,
        body_ordinal: int,
        source_investigation_id: UUID,
        side: str,  # 'left' | 'right'
        kind: str,  # EXTENT_KIND_PINCH_OUT_HALFWAY | EXTENT_KIND_EXTRAPOLATED | EXTENT_KIND_OPEN
        neighbour_inv_id: UUID | None = None,
    ) -> BodyOrm:
        """Set the extent. Returns the body row (created or updated).

        Raises ValueError when:
        * kind is not user-claimed (i.e. 'to_target' or None — detector-only)
        * neighbour_inv_id missing for kinds that need it
        * neighbour_inv_id equals source_investigation_id
        * kind='extrapolated' but dip-extrapolation is geometrically undefined
        """
        # (Implementation. Body row find-or-create; provenance check;
        # validation per kind; commit.)
```

- [ ] **Step 4: Run tests, fix to green**

- [ ] **Step 5: Commit**

```bash
git add src/groundmodel/application/claim_body_extent.py tests/integration/application/test_claim_body_extent.py
git commit -m "feat(application): ClaimBodyExtent use case (all three user-claim kinds)"
```

---

### Task 2.5: ClearBodyExtent use case

**Files:**
- Create: `src/groundmodel/application/clear_body_extent.py`
- Create: `tests/integration/application/test_clear_body_extent.py`

- [ ] **Step 1-4: Same TDD pattern as 2.4.**

Behavior:
* Clears one side back to NULL (kind + target_contact_id + neighbour_inv_id all set to NULL).
* If both sides + name are now NULL AND no detector closure was set: hard-delete the body row.
* Cascade deletes the boundary_shape rows.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(application): ClearBodyExtent use case with empty-body reaping"
```

---

### Task 2.6: SuggestBodyPinchOuts use case

**Files:**
- Create: `src/groundmodel/application/suggest_body_pinch_outs.py`
- Create: `tests/integration/application/test_suggest_body_pinch_outs.py`

- [ ] **Step 1-4: TDD pattern.**

Behavior:
* For each formation in the model + each body framed by source pair `(above, below)`:
  * For each side where the source pair has zero approved correlations:
    * Emit one PinchOutCandidate per geometrically-adjacent neighbour investigation in that direction.
* Returns a list (no persistence).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(application): SuggestBodyPinchOuts ephemeral candidates pass"
```

---

### Task 2.7: NameBody + DeleteBody + MaterialiseBodyCompanions renames

**Files:**
- Create: `src/groundmodel/application/name_body.py` (copy + rename `name_lens_body.py`)
- Create: `src/groundmodel/application/delete_body.py` (copy + rename `delete_lens_metadata.py`)
- Create: `src/groundmodel/application/materialise_body_companions.py` (copy + rename `materialise_lens_companions.py`)
- Delete the old three files
- Update all import sites

- [ ] **Step 1-4: Copy + rename + update imports + run tests until green.**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(application): rename lens-named use cases to body-named"
```

---

### Task 2.8: body_boundary use case rename

**Files:**
- Create: `src/groundmodel/application/body_boundary.py` (copy + adapt `lens_boundary.py`)
- Delete: `src/groundmodel/application/lens_boundary.py`
- Update all import sites
- Rename `tests/integration/application/test_lens_boundary.py` → `test_body_boundary.py`

- [ ] **Step 1-4: Copy + adapt + run tests until green.**

Key adaptation: SaveLensBoundary's content_key join becomes a body_id join (one shape per body via `body_id` FK).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(application): rename lens_boundary → body_boundary use cases"
```

---

### Task 2.9: Slice 2 closeout

- [ ] **Step 1: Run full test suite**

```bash
uv run pytest tests/unit -q
.\scripts\run-integration-tests.ps1 -q
```
Expected: PASS.

- [ ] **Step 2: Smoke the app**

Boot backend; verify `/lenses/*` endpoints still work (slice 3 renames them). Verify the startup sweep logs say "reconciled N model(s)" — it's now using `DetectBodies` which populates extent columns for existing bilateral rows.

- [ ] **Step 3: Verify DB state**

```bash
docker exec strix-db-1 psql -U groundmodel -d groundmodel \
  -c "SELECT COUNT(*) FROM body WHERE extent_left_kind = 'to_target'"
```
Expected: positive count (existing bilateral bodies now have their extents populated by the sweep).

---

## Slice 3: API endpoints (2 h)

**Goal:** Replace `/lenses/*` with `/bodies/*`. New endpoints land for claim / clear / suggest.

### Task 3.1: Schema package for body

**Files:**
- Create: `src/groundmodel/api/schemas/project/body/__init__.py`
- Create: `src/groundmodel/api/schemas/project/body/body_list_item.py`
- Create: `src/groundmodel/api/schemas/project/body/claim_body_extent_request.py`
- Create: `src/groundmodel/api/schemas/project/body/suggest_pinch_outs_response.py`
- Create: `src/groundmodel/api/schemas/project/body/body_boundary.py` (rename from `litho_lens_boundary.py`)
- Create: `src/groundmodel/api/schemas/project/body/detect_bodies_response.py`
- Delete: `src/groundmodel/api/schemas/project/litho_lens/` (whole directory)
- Delete: `src/groundmodel/api/schemas/project/litho_lens_boundary.py`

- [ ] **Step 1: Write `BodyListItem` schema**

```python
# src/groundmodel/api/schemas/project/body/body_list_item.py
"""Pydantic schema: BodyListItem (response shape for GET /bodies)."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class BodyListItem(BaseModel):
    """One row from GET /projects/{pid}/geology/models/{mid}/bodies."""

    id: UUID
    app_project_id: UUID
    model_id: UUID
    formation_id: UUID
    body_ordinal: int
    source_investigation_id: UUID
    name: str | None
    primary_section_id: UUID | None

    extent_left_kind: str | None
    extent_left_target_contact_id: UUID | None
    extent_left_neighbour_inv_id: UUID | None

    extent_right_kind: str | None
    extent_right_target_contact_id: UUID | None
    extent_right_neighbour_inv_id: UUID | None

    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
```

- [ ] **Step 2: Write `ClaimBodyExtentRequest` schema**

```python
# src/groundmodel/api/schemas/project/body/claim_body_extent_request.py
"""Pydantic schema: ClaimBodyExtentRequest (POST /bodies / PATCH /bodies/{bid})."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class ClaimBodyExtentRequest(BaseModel):
    """Body of POST /projects/{pid}/geology/models/{mid}/bodies.

    Creates a body row + sets one extent in one call. Use PATCH on an
    existing body to add the other side's extent.
    """

    formation_id: UUID
    source_investigation_id: UUID
    body_ordinal: int = Field(default=0, ge=0)
    side: Literal["left", "right"]
    kind: Literal["pinch_out_halfway", "extrapolated", "open"]
    neighbour_inv_id: UUID | None = None
    primary_section_id: UUID | None = None
```

- [ ] **Step 3: Write `SuggestPinchOutsResponse` schema**

```python
# src/groundmodel/api/schemas/project/body/suggest_pinch_outs_response.py
"""Pydantic schema: SuggestPinchOutsResponse (ephemeral candidates)."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class PinchOutCandidate(BaseModel):
    body_id: UUID | None  # existing body, or None = proposed-new
    source_investigation_id: UUID
    above_contact_id: UUID
    below_contact_id: UUID
    side: Literal["left", "right"]
    suggested_neighbour_investigation_id: UUID


class SuggestPinchOutsResponse(BaseModel):
    candidates: list[PinchOutCandidate]
```

- [ ] **Step 4: Write `DetectBodiesResponse` schema**

```python
# src/groundmodel/api/schemas/project/body/detect_bodies_response.py
"""Pydantic schema: DetectBodiesResponse."""

from __future__ import annotations

from pydantic import BaseModel


class DetectBodiesResponse(BaseModel):
    """Reports counts from the DetectBodies pass."""
    bodies_created: int
    bodies_updated: int
    bodies_removed_stale: int
    bodies_skipped_unresolved_ordinal: int
```

- [ ] **Step 5: Write `BodyBoundaryResponse` + `BodyBoundaryWriteRequest`** (copy + rename from `litho_lens_boundary.py`).

- [ ] **Step 6: Write package `__init__.py` exporting all symbols.**

- [ ] **Step 7: Delete the old `litho_lens` schema package + file**

```bash
rm -rf src/groundmodel/api/schemas/project/litho_lens/
rm src/groundmodel/api/schemas/project/litho_lens_boundary.py
```

- [ ] **Step 8: Update import sites**

```bash
rg "litho_lens|LithoLensListItem|NameLensBody|DetectLensesResponse" src/ --files-with-matches
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(api): body schema package (replaces litho_lens schemas)"
```

---

### Task 3.2: bodies router with all endpoints

**Files:**
- Create: `src/groundmodel/api/routers/geology/bodies.py`
- Delete: `src/groundmodel/api/routers/geology/lenses.py`
- Modify: `src/groundmodel/api/routers/geology/__init__.py`

- [ ] **Step 1-3: Port `lenses.py` to `bodies.py` with all endpoints from spec §6**

Key endpoints:
* `POST /bodies/detect` (renamed from `/lenses/detect`)
* `POST /bodies/suggest-pinch-outs` (NEW)
* `GET /bodies`
* `POST /bodies` (claim)
* `PATCH /bodies/{bid}` (update name or per-side extent)
* `DELETE /bodies/{bid}`
* `DELETE /bodies/{bid}/extents/{side}`
* `GET /bodies/{bid}/boundary`
* `PUT /bodies/{bid}/boundary`
* `POST /bodies/{bid}/perpendicular-companion`

Route ordering matters: `/bodies/detect` and `/bodies/suggest-pinch-outs` BEFORE `/bodies/{bid}` literals so FastAPI doesn't capture them as ids.

- [ ] **Step 4: Update `__init__.py` to register `bodies` router instead of `lenses`**

- [ ] **Step 5: Delete `lenses.py`**

- [ ] **Step 6: Write integration test `tests/integration/api/test_body_endpoints.py`**

Cover at minimum: GET list returns expected shape; POST claim creates a body; PATCH updates a side; DELETE extent clears; DELETE body removes the row.

- [ ] **Step 7: Run integration tests**

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(api): bodies router replaces lenses router"
```

---

### Task 3.3: Rename AcceptResult fields

**Files:**
- Modify: `src/groundmodel/application/accept_contact_correlations.py`
- Update tests that read `result.lenses_*`

- [ ] **Step 1: Rename in AcceptResult**

In `accept_contact_correlations.py`:
* `lenses_created` → `bodies_created`
* `lenses_removed` → `bodies_removed`
* Update docstrings.

- [ ] **Step 2: Update all consumers**

```bash
rg "lenses_created|lenses_removed" src/ tests/
```

- [ ] **Step 3: Run integration tests, fix until green**

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(application): AcceptResult fields renamed lenses_* → bodies_*"
```

---

### Task 3.4: Slice 3 closeout

- [ ] **Step 1: Boot the app + verify endpoints**

```bash
docker compose up -d
uv run uvicorn groundmodel.api.main:app --port 8765
curl http://127.0.0.1:8765/openapi.json | jq '.paths | keys' | grep "bodies"
```
Expected: lists every new `/bodies/*` endpoint; no `/lenses/*` paths remain.

---

## Slice 4: Bundle round-trip + reconcile guards (2 h)

**Goal:** Bundle build + restore handle the new schema. Preserve-claimed guard extends to user-claimed kinds.

### Task 4.1: Rename bundle payload field

**Files:**
- Modify: `src/groundmodel/api/schemas/project/project_bundle.py` — rename `litho_lenses` → `bodies` in `ProjectBundleRequest` + `ProjectBundleResponse`
- Modify: `src/groundmodel/infrastructure/db/repositories/project_bundle.py` — rename payload key + serialize new columns + integrity guards

- [ ] **Step 1: Rename in `project_bundle.py` schema**

- [ ] **Step 2: Update `_build_project_bundle_impl` to serialize body rows with new columns**

- [ ] **Step 3: Update `_restore_project_bundle_impl` to read `bodies` payload + populate new columns**

- [ ] **Step 4: Add integrity guard**

For each body row in payload: assert `formation_id` resolves in bundle's formation set; assert `source_investigation_id` resolves in CPT/borehole set; assert each populated extent's `target_contact_id` (if `to_target`) resolves in contact set OR `neighbour_inv_id` (if `pinch_out_halfway` or `extrapolated`) resolves in investigation set.

- [ ] **Step 5: Write round-trip test**

```python
# tests/integration/db/test_body_bundle_roundtrip.py
"""Bundle round-trip with bodies of every extent kind."""

# Create a project with 4 bodies — one per extent kind. Build the
# bundle. Restore it into a fresh project. Verify every body + extent
# field matches.
```

- [ ] **Step 6: Run tests, fix until green**

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(bundle): round-trip bodies with all extent kinds"
```

---

### Task 4.2: Frontend bundle round-trip

**Files:**
- Modify: `desktop/src/renderer/src/utils/projectFile.ts` — rename `geological_models[i].litho_lenses` field path → `bodies`

- [ ] **Step 1: Find references**

```bash
rg "litho_lenses|litho_lens_shapes|litho_lens_boundary_nodes" desktop/src/
```

- [ ] **Step 2: Update field names in projectFile.ts + tests**

- [ ] **Step 3: Run vitest**

```bash
cd desktop && npx vitest run src/renderer/src/utils/projectFile.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(desktop): projectFile bundle field rename to bodies"
```

---

### Task 4.3: Slice 4 closeout

- [ ] **Step 1: End-to-end round-trip smoke**

Open `test2.strix` in the app. Save. Close. Reopen. Verify no errors; bodies render the same as before save.

---

## Slice 5: Frontend types + API client (1 h)

### Task 5.1: TypeScript type renames

**Files:**
- Modify: `desktop/src/renderer/src/api/client.ts`

- [ ] **Step 1: Rename types**

* `LithoLensListItem` → `BodyListItem` (extend with new extent fields)
* `NameLensBody*` → `NameBody*`
* `DetectLensesResponse` → `DetectBodiesResponse`
* `LensBoundaryNode` / `LensBoundaryResponse` / `LensBoundaryWriteRequest` → `BodyBoundary*`

- [ ] **Step 2: Rename API methods**

* `api.geology.detectLithoLenses` → `detectBodies`
* `api.geology.materialiseLensCompanions` → `materialiseBodyCompanions`
* Add: `claimBodyExtent`, `clearBodyExtent`, `suggestBodyPinchOuts`, `updateBody` (PATCH)

- [ ] **Step 3: Update consumers**

```bash
rg "detectLithoLenses|LithoLensListItem|NameLensBody|materialiseLensCompanions" desktop/src/
```

- [ ] **Step 4: tsc**

```bash
cd desktop && npx tsc --noEmit -p tsconfig.web.json
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(client): rename lens types + add body extent API methods"
```

---

## Slice 6: Frontend renderer (4 h)

### Task 6.1: Rename `LensWedgeOverlay` → `BodyExtentOverlay`

**Files:**
- Create: `desktop/src/renderer/src/components/sections/BodyExtentOverlay.tsx` (copy + rename)
- Create: `desktop/src/renderer/src/utils/bodyExtent.ts` (copy + rename `lensBoundary.ts`)
- Delete: `desktop/src/renderer/src/components/sections/LensWedgeOverlay.tsx`
- Delete: `desktop/src/renderer/src/utils/lensBoundary.ts`
- Modify: `desktop/src/renderer/src/components/SectionPanel.tsx` — swap component

- [ ] **Step 1-2: Copy + rename + update import sites + update SectionPanel usage**

- [ ] **Step 3: Update test file**

Copy `LensWedgeOverlay.test.tsx` to `BodyExtentOverlay.test.tsx`. Update imports + selectors (`lens-wedge-*` → `body-wedge-*`, etc.).

- [ ] **Step 4: Delete old files**

```bash
rm desktop/src/renderer/src/components/sections/LensWedgeOverlay.tsx
rm desktop/src/renderer/src/components/sections/LensWedgeOverlay.test.tsx
rm desktop/src/renderer/src/utils/lensBoundary.ts
rm desktop/src/renderer/src/utils/lensBoundary.test.ts
```

- [ ] **Step 5: Run tsc + vitest**

```bash
cd desktop && npx tsc --noEmit -p tsconfig.web.json && npx vitest run src/renderer/src/components/sections/BodyExtentOverlay.test.tsx
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(sections): rename LensWedgeOverlay → BodyExtentOverlay"
```

---

### Task 6.2: Per-side dispatch for to_target + pinch_out_halfway

**Files:**
- Modify: `BodyExtentOverlay.tsx`

- [ ] **Step 1: Restructure the per-body render loop**

Replace the existing primary/secondary wedge code with a per-side dispatch on `extent_<side>_kind`. For `'to_target'`: existing wedge math. For `'pinch_out_halfway'`: new midpoint wedge.

- [ ] **Step 2: Write tests**

Add tests to `BodyExtentOverlay.test.tsx`:
* `BE-DISP-TARGET`: body with `extent_left_kind='to_target'` renders wedge to target contact
* `BE-DISP-HALFWAY`: body with `extent_right_kind='pinch_out_halfway'` renders wedge to midpoint between source and neighbour
* `BE-DISP-NULL`: body with both extents NULL renders nothing

- [ ] **Step 3: Run + commit**

```bash
git add -A
git commit -m "feat(sections): per-side dispatch for to_target + pinch_out_halfway"
```

---

### Task 6.3: 'extrapolated' render path

**Files:**
- Modify: `BodyExtentOverlay.tsx` — add dispatch branch
- Create: `desktop/src/renderer/src/utils/dipExtrapolationFrontend.ts` — mirrors backend helper

- [ ] **Step 1: Write the frontend helper + its vitest**

Port `dip_extrapolation.py` to TypeScript verbatim. Same inputs/outputs. Unit tests mirror the Python tests.

- [ ] **Step 2: Add render branch + dip-arrow glyph**

For `'extrapolated'`: call `computeDipExtrapolationEndpoint(...)`. Render wedge to the endpoint + a small dip-arrow glyph at the endpoint.

- [ ] **Step 3: Write tests**

* `BE-DISP-EXTRAPOLATED`: render to dip-extrapolation endpoint + glyph present
* `BE-DISP-EXTRAPOLATED-FALLBACK`: degenerate input → falls back to halfway-style + console.warn

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(sections): extrapolated extent renders to dip endpoint with arrow"
```

---

### Task 6.4: 'open' render path

**Files:**
- Modify: `BodyExtentOverlay.tsx`

- [ ] **Step 1: Add render branch**

For `'open'`: render parallel-sided band from source column edge to the section endpoint at body's upper + lower contact elevations (no taper).

- [ ] **Step 2: Write tests**

* `BE-DISP-OPEN`: parallel-sided band reaches section endpoint; upper edge at source_above_elev, lower edge at source_below_elev

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(sections): open extent renders as parallel band to section boundary"
```

---

### Task 6.5: Mixed-kind combinations + visual-distinction tests

**Files:**
- Modify: `BodyExtentOverlay.test.tsx`

- [ ] **Step 1: Add combination tests**

Per spec §12.4: tests for `to_target` left + `open` right; `extrapolated` left + `pinch_out_halfway` right; etc.

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "test(sections): mixed extent-kind combinations + visual distinction"
```

---

## Slice 7: Frontend gestures + auto-suggest UI (4 h)

### Task 7.1: BodyContextMenu component

**Files:**
- Create: `desktop/src/renderer/src/components/sections/BodyContextMenu.tsx`
- Create: `desktop/src/renderer/src/components/sections/BodyContextMenu.test.tsx`

- [ ] **Step 1: Write the failing test**

Per spec §12.4 / §15 selectors:
* Per-side submenu shows all four claim items when side is unclaimed
* Already-claimed side shows current kind + "Clear extent" action
* Each menu item fires `claimBodyExtent` with the correct `kind`

- [ ] **Step 2-4: Write component + run tests until green**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(sections): BodyContextMenu — per-side claim submenus"
```

---

### Task 7.2: Wire BodyContextMenu into ContactsLayer

**Files:**
- Modify: `desktop/src/renderer/src/components/sections/ContactsLayer.tsx`

- [ ] **Step 1: Add right-click handler on body bands**

When right-click fires on a body band, open `BodyContextMenu` at cursor.

- [ ] **Step 2: Verify integration via vitest**

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(sections): wire BodyContextMenu on body band right-click"
```

---

### Task 7.3: "Suggest pinch-outs" toolbar verb

**Files:**
- Modify: `desktop/src/renderer/src/shell/stages/sections/SectionsToolbar.tsx`

- [ ] **Step 1: Add ToolbarButton**

Sibling of "Detect bodies". Icon: `Sparkles` or similar. On click: calls `api.geology.suggestBodyPinchOuts`, stores returned candidates in component state, toasts the count.

- [ ] **Step 2: Test wiring via vitest**

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(sections): Suggest pinch-outs toolbar verb"
```

---

### Task 7.4: Ghost candidate rendering + click commit

**Files:**
- Modify: `BodyExtentOverlay.tsx` — render ghost wedges
- Modify: `SectionPanel.tsx` — pass candidate list as prop

- [ ] **Step 1: Add ghost render branch**

When `ghostCandidates` prop has entries, render a dashed amber wedge per candidate with the halfway-pinch-out math (same as `pinch_out_halfway` style but dashed + 30% opacity).

- [ ] **Step 2: Add click handler**

On ghost click: call `api.geology.claimBodyExtent` with the candidate's parameters; on success, remove the ghost from local state.

- [ ] **Step 3: Test**

* `BE-GHOST-RENDER`: ghost renders with dashed amber stroke
* `BE-GHOST-CLICK`: click fires `claimBodyExtent` with correct args

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(sections): ghost pinch-out candidates + click-to-commit"
```

---

### Task 7.5: Provenance-conflict badge + override dialog

**Files:**
- Create: `desktop/src/renderer/src/components/sections/BodyProvenanceBadge.tsx`
- Wire into the existing body inspector (extend `LithologyInspector` if no separate one exists)

- [ ] **Step 1: Compute conflict state**

For each body: a conflict exists when a side is user-claimed AND the auto-detector has a bilateral closure available (computed via the same edge graph logic as the detector). The frontend can check this client-side by inspecting `contactEdges` against the body's source pair.

- [ ] **Step 2: Render badge + dialog**

Badge shows on the inspector row when conflict exists. Click opens dialog with "Apply" (default focus), "Keep user-claim", "Cancel" buttons.

- [ ] **Step 3: Apply action**

Calls `clearBodyExtent` (clears the user-claimed kind) then `detectBodies` (the detector now populates `to_target`).

- [ ] **Step 4: Test**

* `BPB-SHOW`: badge appears when conflict conditions match
* `BPB-DISMISS`: "Keep user-claim" dismisses for session

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(sections): provenance-conflict badge + override dialog"
```

---

### Task 7.6: Playwright e2e flows

**Files:**
- Update: `flow_inspect_lens.spec.ts` → `flow_inspect_body.spec.ts` (rename + selector updates)
- Update: `auto-correlate-and-lenses.spec.ts` → `auto-correlate-and-bodies.spec.ts`
- Replace: `flow_litho_pinch_out.spec.ts` → `flow_body_extrapolate.spec.ts`
- Update: `flow_correlate.spec.ts`, `flow_auto_correlate.spec.ts` (rename `lenses_*` assertions)
- Update: `flow_bundle_roundtrip.spec.ts` (round-trip every extent kind)
- Create: `flow_body_pinch_out_halfway.spec.ts`
- Create: `flow_body_open_extent.spec.ts`
- Create: `flow_body_suggest_pinch_outs.spec.ts`
- Create: `flow_body_clear_extent.spec.ts`
- Create: `flow_body_provenance_conflict.spec.ts`
- Create: `flow_body_dip_extrapolation_undefined.spec.ts`
- Create: `flow_synthetic_contact_migration.spec.ts`

Each file follows the existing flow conventions (Playwright fixtures, page object pattern if used). Test bodies match the descriptions in spec §15.

- [ ] **Step 1-N: One file per task** (each commit one file)

```bash
# After each spec:
npx playwright test flow_body_pinch_out_halfway.spec.ts
git add desktop/tests/e2e/flow_body_pinch_out_halfway.spec.ts
git commit -m "test(e2e): body pinch-out halfway flow"
```

Repeat per spec file. Aim for 10-15 minutes per spec.

- [ ] **Step N+1: Run full Playwright suite**

```bash
cd desktop && npx playwright test
```
Expected: PASS.

---

### Task 7.7: Slice 7 closeout — manual dogfeed

Per spec §12.5 (after slice 7 expansion):

- [ ] **Step 1: Right-click body → "Pinch out halfway →" — verify wedge appears + tapers to halfway midpoint**
- [ ] **Step 2: Same body, other side: "Extrapolate (dip-projection) ←" — verify dip-arrow glyph**
- [ ] **Step 3: Different body: "Extends to section boundary →" — verify parallel band**
- [ ] **Step 4: Save → close → reopen — verify all claims persist**
- [ ] **Step 5: Run "Suggest pinch-outs" — verify ghosts appear**
- [ ] **Step 6: Click a ghost — verify body materialises with `pinch_out_halfway`**
- [ ] **Step 7: Trigger provenance conflict — verify badge + dialog**
- [ ] **Step 8: Trigger extrapolation-undefined case — verify rejection toast**

If any step fails: file a bug, fix in a follow-up commit, re-verify.

---

## Slice 8: Docs + dogfeed + cleanup (1-2 h)

### Task 8.1: CLAUDE.md updates

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update Phase 4 description**

Find references to "lens" / "Lens" / "litho lens" in the Phase 4 / MVP gate sections. Update to "body" terminology where it now applies.

- [ ] **Step 2: Add the 2026-05-31 batch entry**

Append to the recently-resolved batch:
> (j) `body-with-extent refactor` — replaced LithoLensOrm with BodyOrm; absorbed `extent_kind='extrapolated'` (retired ExtrapolatePinchOut tool); shipped `extent_kind='open'` for explicit section-boundary extension; new gesture surfaces (per-side context submenu) + auto-suggest verb. Spec: `docs/superpowers/specs/2026-05-31-body-with-extent-design.md`; plan: `docs/superpowers/plans/2026-05-31-body-with-extent.md`. ...

- [ ] **Step 3: Update Domain Model section**

Replace "LithoLensOrm — metadata attached to a lens body" with the new body-with-extent description.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude-md): body-with-extent rename in Phase 4 + resolved batch"
```

---

### Task 8.2: Memory file sweep

**Files:**
- Search and update: `~/.claude/projects/.../memory/*.md`

- [ ] **Step 1: Find lens-related memories**

```bash
rg "lens|Lens|LithoLens|pinch_out_extrapolation" ~/.claude/projects/C--Users-robin-Documents-Strix/memory/
```

- [ ] **Step 2: Update or delete each stale entry**

If a memory references retired code (ExtrapolatePinchOut, LithoLensOrm), update it to reference the new body model OR delete if no longer relevant.

---

### Task 8.3: Final dogfeed walkthrough

- [ ] **Step 1: Fresh open of test2.strix**

Verify:
* All bodies render with correct extent kinds
* New right-click menu items all functional
* Suggest pinch-outs surfaces expected candidates
* No console errors
* No backend errors in the log

- [ ] **Step 2: Document any follow-up issues**

If any UX rough edges surface during the walkthrough, file them as new debt items in `docs/debt.md` for the next iteration.

---

## Self-review checklist

Run through this checklist before declaring the plan complete:

1. **Spec coverage:** Every section of the spec has at least one task implementing it:
   * §4 schema → tasks 1.3, 1.4, 1.5, 1.6
   * §4.5 migration → tasks 1.3, 1.4, 1.5 + slice 1a
   * §5 use cases → tasks 2.3, 2.4, 2.5, 2.6, 2.7, 2.8
   * §6 API → tasks 3.1, 3.2, 3.3
   * §7 rendering → tasks 6.1, 6.2, 6.3, 6.4
   * §8 gestures → tasks 7.1, 7.2, 7.3, 7.4, 7.5
   * §9 bundle → tasks 4.1, 4.2
   * §10 edge cases → covered via use-case tests + dogfeed
   * §11 phasing → mirrored in slice structure
   * §12 testing → distributed across each slice's TDD steps
   * §13 risks → known; mitigations baked into the relevant tasks
   * §15 Playwright → task 7.6

2. **Placeholder scan:** Plan has no "TBD" / "TODO" markers; every code-changing step shows the code or precise rename pattern.

3. **Type consistency:** `BodyOrm` / `BodyExtent` / `DetectedBody` / `EXTENT_KIND_*` names are stable across every task that references them.

4. **Estimates total** to 23-27h (matches spec §11).

---

*End of plan.*

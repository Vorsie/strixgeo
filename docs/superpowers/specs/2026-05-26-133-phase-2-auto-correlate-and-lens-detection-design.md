# #133 Phase 2 — Auto-correlate at contact level + lens detection + lens companions

**Status:** Design approved 2026-05-26. Awaiting user spec review before implementation plan.
**Owner:** RobinVorsselmans
**Tier:** G (litho stage — before Geotech-subdivision gate)
**Depends on:** #133 Phase 1 (shipped 2026-05-26), #135 (shipped 2026-05-26)
**Related debt:** #131 (lens-aware ribbon — blocked; not in this slice)

## Goal

The user has dogfed the manual #135 lens gesture and wants the system to:
1. Propose contact-level correlation edges automatically (analogue of #127 at the formation level).
2. Detect lens bodies from the resulting contact-edge graph using the #135 topology signature.
3. Materialise perpendicular companion sections for the detected lenses, gated so this only happens when the user has actively finished correlating a section.

The product outcome at the v1.0 commercial MVP gate (per `CLAUDE.md`) treats lenses as 3D bodies. A single section can only constrain a lens in one direction; the perpendicular companion gives the second direction. Today the topology exists but the 3D follow-on is manual per lens.

## Non-goals

- Migrating existing formation-level edges to contact-level edges (Phase 3).
- Removing the legacy body-click correlate gesture (Phase 3).
- Lens-aware ribbon styling (#131 — blocked on `lens_id` FK).
- Per-contact "intentionally orphaned" marker that would soften the strict gate (filed as Tier G follow-up).
- Design-ready per-lens parameters (Phase 5).

## Architecture overview

Three layers, mirroring the #127 pattern.

```
Domain (pure)        Application                    API
─────────────        ───────────                    ───
auto_correlate_      AutoCorrelateContactEdges   →  POST .../contact-correlations/auto
  contact_edges.py    └─ calls DetectLithoLenses
                                                   POST .../contact-correlations
detect_lenses_       CorrelateLithoContacts       (existing, now extended)
  from_graph.py       └─ calls DetectLithoLenses
                                                   DELETE .../contact-correlations
                     UncorrelateLithoContacts      (existing, now extended)
                      └─ calls DetectLithoLenses

                     DetectLithoLenses           ←  shared by all three above
                                                    materialises LithoLensOrm only

                     MaterialiseLensCompanions   →  POST .../lens-companions/materialise
                      └─ loops + CreatePerpendicularCompanion (existing)
```

No schema changes. `LithoContactCorrelationEdgeOrm` already exists (Phase 1). `LithoLensOrm` already exists (Position 4 / #101). `cross_section.is_lens_companion` + `companion_lens_id` already exist. `source` widens at the Pydantic Literal level from `Literal["manual"]` to `Literal["manual", "auto"]` (the column itself is already a free string).

## Lens detection signal (definitive)

**A lens body is detected iff: two distinct source contacts on the same investigation A both have a correlation edge to the same target contact on another investigation B.**

That topology (the #135 pinch-out gesture) is the sole signal Phase 2 consumes. The layer between the two source contacts on A is the lens body. Other speculative signals (isolated-body, thickness-pinch heuristic) are explicitly out of scope — every materialised `LithoLensOrm` row traces back to an edge graph the user can verify.

## Auto-correlate algorithm (boundary-signature aware)

Pure-domain `auto_correlate_contact_edges(contacts, locations, params)` in `groundmodel/domain/services/`.

**Grouping key (boundary signature):** `(parent_formation_id, litho_main_soil_code, litho_below_code)`.

The third element is what distinguishes Phase 2's algorithm from #127's mechanical port: a "sand-above / clay-below" boundary on column A only matches a "sand-above / clay-below" boundary on column B. Two contacts at the top of sand layers don't get correlated if one has clay below and the other has silt below — they're not the same stratigraphic horizon.

`litho_below_code` is derived per contact by walking its investigation's contact stack (sort by `depth_top_m`, look up the lithology of the formation immediately deeper). **When the contact is the deepest on its column**, `litho_below_code` is `None`; null is a valid grouping value matched only against other nulls (two "top-of-the-deepest-layer" contacts can still be correlated if their above-lithology and parent formation agree).

**Sweep:**
1. Sort naming groups by median contact depth (deepest first).
2. For each column-pair within `max_column_distance_m`, pair contacts within the active group by depth residual against a Theil-Sen dip-transferred prediction.
3. Mutual-nearest-neighbour (MNN) disambiguation.
4. Output canonical-ordered `(contact_a_id, contact_b_id)` candidate pairs.

**Reused helpers:** `robust_slope_fit` (Theil-Sen) and the MNN helper from `auto_correlate.py`. The two algorithms share enough that the helpers move to `auto_correlate_helpers.py` and are imported by both — the duplication-on-second-copy rule kicks in here.

**Constants** reused from the existing `auto_correlate_constants.py` (no new constants module unless a default has to diverge for contact-level work):
- `MAX_COLUMN_DISTANCE_M = 200.0`
- `BASE_DEPTH_THRESHOLD_M = 0.5`
- `DISTANCE_FACTOR = 0.002` (per-metre column distance contribution to threshold)
- `MIN_EDGES_FOR_DIP_TRANSFER = 2`
- `AUTO_SOURCE = "auto"`

## Lens detector (pure graph query)

`detect_lenses_from_graph(edges, stacks)` in `groundmodel/domain/services/detect_lenses_from_graph.py`.

```python
@dataclass(frozen=True)
class LensCandidate:
    formation_id: UUID          # the body's formation (on investigation A)
    contact_above_id: UUID      # upper source contact on A
    contact_below_id: UUID      # lower source contact on A
    target_investigation_id: UUID
    target_contact_id: UUID     # shared convergence point on B
```

**Algorithm:**
1. Build adjacency: for each edge `(a, b)`, add both directions.
2. For each contact `t` (potential target):
   - Group `t`'s neighbours by `investigation_id`.
   - Any group with ≥2 distinct contacts is the topology — call those contacts `s_top`, `s_bot` (depth-sorted).
3. For each `(s_top, s_bot)`: find the formation living between them in their shared investigation's contact stack. That formation is the lens body's `formation_id`.
4. Emit a `LensCandidate` per detection.

**N-way generalisation:** if a target contact has 3 source contacts on the same investigation, emit one candidate per adjacent pair (between contact 1-2, between 2-3 — stacked lenses). The frontend's #135 gesture already supports this via the stacked-click pattern (test CC7).

## Application layer

### `AutoCorrelateContactEdges`

Path: `groundmodel/application/auto_correlate_contact_edges.py`.

`execute(project_id, model_id, params=None) → AutoCorrelateContactResult`:
1. Scope-guard model belongs to project.
2. Load all contacts for the model with their formation's `parent_formation_id` + `litho_main_soil_code`. Load `BoreholeOrm` / `CptOrm` for locations.
3. Build per-investigation contact stacks; derive `litho_below_code` per contact.
4. Call `auto_correlate_contact_edges(...)` → candidates.
5. Dedupe candidates against existing edges (any source — manual takes precedence, never overwritten).
6. Bulk insert net-new edges with `source='auto'`. Use Postgres `INSERT ... ON CONFLICT (model_id, contact_a_id, contact_b_id) DO NOTHING` to absorb concurrent-write races.
7. Call `DetectLithoLenses.execute(prefer_section_id=None)`.
8. Single commit. Return:
   ```python
   @dataclass
   class AutoCorrelateContactResult:
       edges_created: int
       edges_skipped_existing: int
       lenses_created: int
       lenses_removed: int
   ```

### `DetectLithoLenses`

Path: `groundmodel/application/detect_litho_lenses.py`.

`execute(project_id, model_id, prefer_section_id: UUID | None = None) → DetectLensesResult`:
1. Load all contact edges + per-investigation contact stacks for the model.
2. Call `detect_lenses_from_graph(...)` → candidates.
3. For each candidate, resolve `body_ordinal` from `geological_formation.instance_ordinal` for the lens body's formation. **If null, skip with WARNING log** — the resolver hasn't run yet for this body. Re-running auto-correlate (which fires the resolver) picks it up next pass.
4. Resolve `primary_section_id`:
   - If `prefer_section_id` is supplied AND it contains both `target_investigation_id` and the source investigation → use it.
   - Else: query `cross_section` rows whose investigation list contains both. If multiple, pick the lowest id deterministically. If none, leave null.
5. Upsert `LithoLensOrm(model_id, formation_id, body_ordinal, primary_section_id)`.
6. Reconcile against existing rows: build the set of `(formation_id, body_ordinal)` tuples produced by step 2. Any `LithoLensOrm` row for this model whose `(formation_id, body_ordinal)` is **not** in that set is stale → delete. Companion sections survive with `companion_lens_id` nulled and `is_lens_companion=True` (the FK is `ON DELETE SET NULL` per the existing schema) — the user can delete them manually if no longer wanted.
7. Single commit. Return:
   ```python
   @dataclass
   class DetectLensesResult:
       lenses_created: int
       lenses_removed: int
       lenses_skipped_unresolved_ordinal: int
   ```

**Wired into existing manual paths:**
- `CorrelateLithoContacts.execute` calls `DetectLithoLenses.execute(prefer_section_id=request_section_id)` after its insert.
- `UncorrelateLithoContacts.execute` calls it after its delete.
- Both gain an optional `request_section_id` parameter that defaults to None (Phase 1 test stability preserved).

### `MaterialiseLensCompanions`

Path: `groundmodel/application/materialise_lens_companions.py`.

`execute(project_id, model_id) → MaterialiseLensCompanionsResult`:
1. Load all `LithoLensOrm` rows for the model that lack a companion section (`SELECT ... WHERE NOT EXISTS (SELECT 1 FROM cross_section WHERE companion_lens_id = lens.id)`).
2. For each lens:
   - If `primary_section_id` is null → increment `skipped_no_primary`, continue.
   - Load the primary section's `seeded_formation_contact_ids`.
   - **Gate:** every contact id in that set must have at least one row in `litho_contact_correlation_edge` where it appears as `contact_a_id` or `contact_b_id`. If any contact has zero edges → increment `skipped_unfinished_section`, continue.
   - Call `CreatePerpendicularCompanion(lens_id)`. Wrap in try/except so a per-lens error doesn't abort the loop; on exception increment `errored` and continue.
3. Return:
   ```python
   @dataclass
   class MaterialiseLensCompanionsResult:
       companion_sections_created: int
       skipped_no_primary: int
       skipped_unfinished_section: int
       errored: int
   ```

`CreatePerpendicularCompanion` commits internally per the existing implementation, so the loop accumulates partial progress. Idempotency is preserved by its own existence guard.

## API

### `POST /projects/{pid}/geology/models/{mid}/contact-correlations/auto` (new)

Body: empty (or `{ dry_run?: bool }` for a future preview-only mode — out of scope for this slice but reserved in the schema). Response:
```json
{
  "edges_created": 47,
  "edges_skipped_existing": 12,
  "lenses_created": 3,
  "lenses_removed": 0
}
```
**Errors:** 404 if model not in project. 200 on empty results.

### `POST /projects/{pid}/geology/models/{mid}/lens-companions/materialise` (new)

Body: empty. Response:
```json
{
  "companion_sections_created": 4,
  "skipped_no_primary": 1,
  "skipped_unfinished_section": 2,
  "errored": 0
}
```
**Errors:** 404 if model not in project. 200 on empty results.

### `POST .../contact-correlations` (existing, extended)

Body gains optional `request_section_id: UUID | None = None`. Passed through to `DetectLithoLenses.execute(prefer_section_id=...)`. Backwards-compat: omitting the field preserves Phase 1 behaviour.

### `DELETE .../contact-correlations` (existing, extended)

Same extension. Field passed through to `UncorrelateLithoContacts`.

## Frontend

### Auto-correlate toolbar button (extended)

`SectionsToolbar` already has an Auto-correlate button calling #127's formation-level endpoint. Extend its handler to also call the new `autoCorrelateContactEdges`. Run both in parallel via `Promise.allSettled` so one failing doesn't block the other.

Toast merges both results:
> "Auto-correlate: 12 formation edges, 47 contact edges, 3 lenses detected."

If one path errors:
> "Auto-correlate: 12 formation edges. Contact-level run failed — try again."

### New toolbar button "Materialise lens companions"

Positioned in the Sections toolbar next to (but not inside) the Build button. Single click → calls `POST .../lens-companions/materialise`. Toast:
> "Lens companions: 4 created, 2 skipped (sections not fully correlated), 1 skipped (no primary section)."

Disabled state: when the active litho model has zero `LithoLensOrm` rows. Tooltip on hover: "Detect lenses first — run Auto-correlate or use the #135 gesture."

### Contact-correlation API client (extended)

`api.geology.createContactCorrelation(projectId, modelId, contactAId, contactBId, requestSectionId?)` — new optional arg.
`api.geology.deleteContactCorrelation(projectId, modelId, contactAId, contactBId, requestSectionId?)` — same.
`api.geology.autoCorrelateContactEdges(projectId, modelId)` — new.
`api.geology.materialiseLensCompanions(projectId, modelId)` — new.

### `SectionsCanvas` passes `requestSectionId`

`handleCreateContactCorrelation` and `handleDeleteContactCorrelation` pull `selectedSectionId` from context and pass it as `requestSectionId`. Maintains the existing call signatures by making the new arg optional.

### Refetch shape

After each call:
- Auto-correlate: refetch `contactEdges` + `lithoLenses` + `lithoModel.formations` (instance_ordinal may have changed).
- Materialise companions: refetch `cross_section` list + `lithoLenses`.
- Manual #135 commit / uncommit: existing refetch of `contactEdges` + new refetch of `lithoLenses`.

## Data flow scenarios

**1. Manual #135 commits an edge** — `CorrelateLithoContacts` → insert edge → `DetectLithoLenses` with `prefer_section_id=request_section_id` → upsert `LithoLensOrm` rows. No companion section is auto-created.

**2. Auto-correlate click** — both formation-level (`#127`) and contact-level run in parallel. Contact-level: bulk insert edges with `source='auto'` → `DetectLithoLenses` → lens metadata. Merged toast.

**3. Materialise companions click** — load eligible `LithoLensOrm` rows → per-lens gate evaluation → `CreatePerpendicularCompanion` for qualifying lenses. Idempotent.

**4. Contact edge deletion** — `UncorrelateLithoContacts` → delete edge → `DetectLithoLenses` → lens rows whose body is no longer lens-shaped are deleted. Companion sections survive with `companion_lens_id` nulled (per `ON DELETE SET NULL`); they remain visible in the section list as plain user sections, deletable manually.

**5. Build click** — unchanged. `POST /surfaces/rebuild` does TIN refresh only.

**6. Primary section deletion** — `primary_section_id` is `ON DELETE SET NULL` (existing); the LithoLens row survives with null primary, its companion (if any) survives standalone.

## Error handling

| Surface | Failure mode | Behaviour |
|---|---|---|
| Auto-correlate | Concurrent duplicate edge insert | `ON CONFLICT DO NOTHING`, counted as `edges_skipped_existing` |
| Lens detection | Body's `instance_ordinal` is null | Skip with WARNING, `lenses_skipped_unresolved_ordinal++`. Edge insertion not blocked. |
| Lens detection | Multiple candidate primary sections | Pick lowest id deterministically |
| Materialise companions | Primary section deleted mid-loop | `CreatePerpendicularCompanion` raises ValueError → caught, `errored++` |
| Materialise companions | Section has zero contacts | Vacuous gate pass — companion is created (no contacts to be uncorrelated) |
| All endpoints | Model not in project | 404 |

**Transactional posture**
- `CorrelateLithoContacts` + `DetectLithoLenses`: single transaction. Lens-detection raise rolls back the edge insert.
- `AutoCorrelateContactEdges`: single transaction (bulk insert + detection atomic).
- `MaterialiseLensCompanions`: per-lens commit (matching `CreatePerpendicularCompanion`'s existing semantics).

**Logging (per DoD)**
- INFO at use-case entry with key params; SUCCESS at exit with all counts.
- DEBUG per candidate / per lens / per skip-reason.
- WARNING for null primary, missing body_ordinal, per-lens errors.

## Testing

**Unit (no DB, `tests/unit/domain/services/`)**
- `test_auto_correlate_contact_edges.py`:
  - Happy path (3 columns × 2 boundaries, MNN converges).
  - Boundary-signature filter rejects same-litho-above different-litho-below.
  - Theil-Sen dip transfer applied with ≥2 prior anchors.
  - MNN tie-breaking.
  - Distance gate.
- `test_detect_lenses_from_graph.py`:
  - Happy path: 2 source contacts converging on 1 target → 1 lens candidate.
  - N=3 stacked: 3 source contacts converging on 1 target → 2 lens candidates.
  - 1-to-1 edges only → empty.
  - Two independent lens topologies in the same model (one on column A visible from B; another on column C visible from D) → 2 candidates.

**Integration (DB, `tests/integration/application/`)**
- `test_auto_correlate_contact_edges.py`: end-to-end with fixture model. Edges inserted with `source='auto'`. Re-run idempotent.
- `test_detect_litho_lenses.py`: lens row materialised by manual gesture; lens row removed when defining edge is deleted; unresolved-ordinal skip path logged but doesn't error.
- `test_materialise_lens_companions.py`: gate-pass creates companion; gate-fail skips with `skipped_unfinished_section`; idempotent re-run; per-lens error doesn't abort loop.

**E2E (Playwright, `desktop/tests/e2e/`)**
- `auto-correlate-and-lenses.spec.ts`: seed → click Auto-correlate → lens count in inspector, no companions yet → finish correlating a section → click Materialise → companion appears in list with `is_lens_companion` styling.

**No new benchmark.** Per project conventions, `pytest-benchmark` covers CPU-bound per-element work. Typical model size (<1000 contacts, <500 column-pairs) puts both algorithms at low-ms — well under the threshold. Add if dogfeed shows real-project timings warrant it.

## Out-of-scope follow-ups (file as Tier G debt after Phase 2 ships)

- **Per-contact "intentionally orphaned" marker** — softens the strict gate. Schema: new `marked_no_correlate: bool` column on `FormationContactOrm`, small UI toggle on the contact inspector. Gate qualifies a section when every contact has either an edge OR the marker set.
- **Lens-aware ribbon styling** (#131) — needs `lens_id` FK on `LithoContactCorrelationEdgeOrm` so the ribbon renderer can group edges by lens. Tag edges produced inside `DetectLithoLenses`'s lens-body materialisation with the lens id once the FK exists.
- **Phase 3** — migrate formation-level edges to contact-level; remove legacy body-click correlate gesture; deprecate formation-level endpoints.

## Backwards compatibility

Backwards-compat is currently SUSPENDED (per CLAUDE.md, owner directive 2026-05-16) until first external distribution. This slice doesn't break `.gmproj` v3 anyway — no schema changes, only additive request fields with optional defaults. The re-arm trigger handles compat re-instatement when the first paid build ships.

## Open questions resolved during brainstorming

| Question | Resolution |
|---|---|
| Scope: which Phase 2 pieces in this slice? | Both auto-correlate + lens detection. |
| Lens-detection signal? | #135 topology only. |
| Auto-correlate algorithm? | Approach B — boundary-signature aware (above + below lithology must match). |
| Should companion sections auto-create? | Yes, but gated. |
| What gates companion creation? | "Every contact on the primary section has at least one outbound edge." |
| Where does companion creation run? | Separate toolbar button, not folded into Build. |
| If primary section can't be resolved? | Skip the companion silently; lens metadata still created. |
| Orphan-contact marker? | Out of scope; file as Tier G follow-up. |

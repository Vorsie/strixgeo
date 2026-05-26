# #133 Phase 2+3 — Contact-level correlation, lens detection, lens companions, formation-level removal

**Status:** Design re-approved 2026-05-26 after wide-scope expansion. Awaiting user spec review before implementation plan.
**Owner:** RobinVorsselmans
**Tier:** G (litho stage — before Geotech-subdivision gate)
**Depends on:** #133 Phase 1 (shipped 2026-05-26), #135 (shipped 2026-05-26)
**Related debt:** #131 (lens-aware ribbon — blocked on `lens_id` FK; out of scope here)

## Goal

The user has dogfed the manual #135 lens gesture and wants the system to:
1. Propose contact-level correlation edges automatically (analogue of #127 at the formation level).
2. Treat auto-proposed edges as *suggestions* the user reviews and accepts — never as committed truth until accepted.
3. Detect lens bodies from the *user-approved* contact-edge graph using the #135 topology signature.
4. Materialise perpendicular companion sections for the detected lenses, gated so this only happens when the user has actively finished correlating a section.
5. **Clean cut the duplicate correlation system.** Remove the legacy formation-level body-click gesture, formation-level edges table, formation-level auto-correlate, and rewrite the resolver + admixture propagation to consume contact-level edges. One correlation model in the codebase, not two.

The product outcome at the v1.0 commercial MVP gate (per `CLAUDE.md`) treats lenses as 3D bodies. A single section can only constrain a lens in one direction; the perpendicular companion gives the second direction. Today the topology exists but the 3D follow-on is manual per lens, and the system carries two parallel correlation graphs.

## Non-goals

- Lens-aware ribbon styling (#131 — blocked on `lens_id` FK; separate slice).
- Per-contact "intentionally orphaned" marker that would soften the strict companion gate (filed as Tier G follow-up).
- Parameter-aware correlation scoring (Robertson Ic / Dr / NAD-based confidence) — Phase 5 follow-up. **NAD in particular cannot be a litho-stage signal**: it's assigned at the Geotech subdivision stage, downstream of the litho model. Using it here would be a circular dependency.
- Design-ready per-lens parameters (Phase 5).
- A backwards-compat shim for the formation-level edge table — pre-ship per CLAUDE.md, owner directive 2026-05-16. Existing dev/test DBs migrate forward via Alembic; no compat layer needed.

## Architecture overview

```
Domain (pure)              Application                          API (contact-only world)
─────────────              ───────────                          ────────────────────────
auto_correlate_            AutoCorrelateContactEdges            POST .../contact-correlations/auto
  contact_edges.py          (no DetectLithoLenses call —
                             auto edges are unapproved)
detect_lenses_             AcceptContactCorrelations            POST .../contact-correlations/accept
  from_graph.py             ├─ flip user_approved=TRUE in scope
                            ├─ ResolveLithoInstances
auto_correlate_             └─ DetectLithoLenses
  helpers.py
  (shared MNN)             CorrelateLithoContacts               POST .../contact-correlations  (extended)
                            ├─ insert edge (user_approved=TRUE)
                            ├─ ResolveLithoInstances
                            └─ DetectLithoLenses

                           UncorrelateLithoContacts             DELETE .../contact-correlations (extended)
                            ├─ delete edge
                            ├─ ResolveLithoInstances
                            └─ DetectLithoLenses

                           DetectLithoLenses                    GET .../contact-correlations    (response carries user_approved)
                            └─ reads user_approved=TRUE only

                           MaterialiseLensCompanions            POST .../lens-companions/materialise
                            └─ loops + CreatePerpendicularCompanion

                           ResolveLithoInstances  (rewritten)   (internal — no direct endpoint after the rewrite;
                                                                 fires automatically on every approved-edge mutation)

                           PropagateCorrelatedLithoAdmixtures   PATCH .../correlations/admixtures
                            (rewritten to derive graph           (path retained for FE compat; internals consume
                             from contact edges)                 the derived contact-edge graph)
```

**Removed in this slice (formation-level world):**

| Removed | What used it |
|---|---|
| `litho_correlation_edge` table + ORM model + repositories | All formation-level use cases below |
| `CorrelateLithoUnits` use case + `POST /correlations` endpoint | Legacy manual gesture |
| `UncorrelateLithoUnits` use case + `DELETE /correlations` endpoint | Legacy manual gesture |
| `AutoCorrelateLithoBodies` (#127) use case + `POST /correlations/auto` endpoint | Formation-level Auto-correlate button |
| `POST /correlations/resolve` endpoint (the manual Resolve trigger) | Auto-runs now on every approved-edge mutation |
| Formation-level body-click gesture | `CorrelateGestureState` + plumbing in `SectionsCanvas` / `SectionPanel` / `CorrelationEdgesOverlay` |
| Formation-level ribbon rendering | `CorrelationEdgesOverlay` ribbon-from-formation-edges paths |
| `api.geology.correlate` / `uncorrelate` / `listCorrelations` (formation-level) | FE gesture handlers |
| `api.geology.autoCorrelate` (formation-level) → renamed to `autoCorrelateContacts` | FE toolbar |

The Position 4 lens body chips, `instance_ordinal` display, `body_ordinal` derivation, and `LithoLens` metadata all survive — they consume the resolver's output, not the formation-level edge table directly, so the rewrite is invisible to them.

## Schema changes (one Alembic migration)

1. **Add** `litho_contact_correlation_edge.user_approved BOOLEAN NOT NULL DEFAULT TRUE`. Existing Phase 1 edges (all of source='manual') default to TRUE — they're already implicitly accepted.
2. **Drop** `litho_correlation_edge` table (ORM model + repository code go with it).
3. **Drop** any orphan columns on `geological_formation` that only exist for formation-edge consumers (verify in implementation — likely none; `instance_ordinal` stays because it's derived by the resolver, not from edges).

`source` widens on the response side from `Literal["manual"]` to `Literal["manual", "auto"]`. The manual `POST .../contact-correlations` request schema stays `Literal["manual"]` — auto-source edges land via the `/auto` endpoint, never via the manual endpoint. `source` and `user_approved` are orthogonal:
- `source='manual', user_approved=True` — drawn by #135 gesture
- `source='auto', user_approved=False` — proposed by auto-correlate, not yet reviewed
- `source='auto', user_approved=True` — proposed by auto-correlate, accepted by user
- `source='manual', user_approved=False` — does not occur (manual is implicit acceptance)

## Lens detection signal (definitive)

**A lens body is detected iff: two distinct user-approved source contacts on the same investigation A both have a `user_approved=True` correlation edge to the same target contact on another investigation B.**

The #135 pinch-out topology is the sole signal. The layer between the two source contacts on A is the lens body. Auto-proposed edges (`user_approved=False`) are excluded from detection entirely — until accepted, they don't seed lens metadata.

## Auto-correlate algorithm (boundary-signature aware, no dip transfer)

Pure-domain `auto_correlate_contact_edges(contacts, locations, params)` in `groundmodel/domain/services/`.

**Grouping key (boundary signature):** `(parent_formation_id, litho_main_soil_code, litho_below_code)`.

A "sand-above / clay-below" boundary on column A only matches a "sand-above / clay-below" boundary on column B. Contacts whose above-litho matches but below-litho differs are not the same horizon and don't get correlated.

`litho_below_code` is derived per contact by walking its investigation's contact stack (sort by `depth_top_m`, look up the lithology of the formation immediately deeper). **When the contact is the deepest on its column**, `litho_below_code` is `None`; null is a valid grouping value matched only against other nulls.

**Sweep (simplified — no Theil-Sen):**
1. Group contacts by boundary signature; sort groups by median depth (deepest first).
2. For each column-pair within `MAX_COLUMN_DISTANCE_M`: pair contacts within the active group by absolute depth residual `|depth_A - depth_B|`. Window: `BASE_DEPTH_THRESHOLD_M + DISTANCE_FACTOR · column_distance`.
3. Mutual-nearest-neighbour (MNN) disambiguation: `contact_A ↔ contact_B` accepted only if each is the nearest unmatched candidate of the other.
4. Output canonical-ordered `(contact_a_id, contact_b_id)` candidate pairs.

**Honest trade-off of scrapping Theil-Sen:** in dipping strata (BE/NL typical 1–2% dip; max ~5% in steeply dipping zones), a 200m column pair sees ~4m boundary offset at 2% dip — well outside the default window. The simpler algorithm produces more false negatives in dipping zones. The Accept flow is the safety valve: missing pairs are added manually via the #135 gesture. If dogfeed confirms the false-negative rate hurts (e.g. >20% of expected pairs missed in a dipping site), the follow-up is a per-project manual dip override (single float, applied uniformly), not Theil-Sen.

**Reused helpers:** MNN extracted to `auto_correlate_helpers.py`. Theil-Sen helper (`robust_slope_fit`) is removed entirely once `AutoCorrelateLithoBodies` (#127) is dropped — no other consumer.

**Constants** in `auto_correlate_constants.py` (reused from #127's location, narrowed):
- `MAX_COLUMN_DISTANCE_M = 200.0`
- `BASE_DEPTH_THRESHOLD_M = 0.5`
- `DISTANCE_FACTOR = 0.002`
- `AUTO_SOURCE = "auto"`
- (`MIN_EDGES_FOR_DIP_TRANSFER` removed — no Theil-Sen)

## Lens detector (pure graph query)

`detect_lenses_from_graph(approved_edges, stacks)` in `groundmodel/domain/services/detect_lenses_from_graph.py`.

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
1. Build adjacency on the *approved* edges only.
2. For each contact `t` (potential target): group `t`'s neighbours by `investigation_id`. Any group with ≥2 distinct contacts is the #135 topology — call those contacts `s_top`, `s_bot` (depth-sorted).
3. For each `(s_top, s_bot)`: find the formation living between them in their shared investigation's contact stack. That formation is the lens body's `formation_id`.
4. Emit a `LensCandidate` per detection.

**N-way generalisation:** a target contact with 3 source contacts on the same investigation yields 2 lens candidates (between 1-2 and 2-3 — stacked lenses). Matches the #135 stacked-click pattern (CC7 test).

## Resolver rewrite

`ResolveLithoInstances` today walks `litho_correlation_edge.formation_a_id ↔ formation_b_id`, computes connected components per naming group, assigns `instance_ordinal` 0, 1, ... per component.

**New (contact-level):**

1. Load all `user_approved=True` `litho_contact_correlation_edge` rows for the model.
2. Derive formation adjacency: for each edge `(contact_a_id, contact_b_id)`, add `(formation_of(contact_a), formation_of(contact_b))` to the formation graph. (Skip self-loops where both contacts belong to the same formation.)
3. Load all formations for the model. Group by naming group `(parent_formation_id, litho_main_soil_code)`.
4. Per naming group: connected components on the derived graph. Formations with no edges become their own singleton component.
5. Sort components by min-`display_order` (oldest first) so ordinals stay stable across reruns when stratigraphy is unchanged.
6. Assign `instance_ordinal` = component index within the group; respect `instance_ordinal_locked=True` rows (they keep their existing ordinal; the resolver flows others around them).
7. UPDATE every formation whose ordinal changed.

**Idempotent.** Same input → same output. `pinned_order` (a separate flag governing `display_order` during Build's reorder-by-age pass) is unrelated to this resolver and unchanged by it.

**Triggers:** auto-runs at the end of `CorrelateLithoContacts`, `UncorrelateLithoContacts`, and `AcceptContactCorrelations`. No standalone endpoint — the explicit Resolve button is removed.

## Admixture propagation rewrite

`PropagateCorrelatedLithoAdmixtures` today BFS-walks formation-level edges from a seed formation to identify its connected component, then writes admixture changes to every formation in the component.

**New:** derive the formation graph from approved contact edges (same derivation as the resolver), then BFS from the seed formation, write admixtures to every formation in the BFS-reachable set. Same external contract (FE call unchanged); internal graph source changes.

## Application layer

### `AutoCorrelateContactEdges`

Path: `groundmodel/application/auto_correlate_contact_edges.py`.

`execute(project_id, model_id, params=None) → AutoCorrelateContactResult`:
1. Scope-guard model belongs to project.
2. Load all contacts for the model with their formation's `parent_formation_id` + `litho_main_soil_code`. Load `BoreholeOrm` / `CptOrm` for locations.
3. Build per-investigation contact stacks; derive `litho_below_code` per contact.
4. Call `auto_correlate_contact_edges(...)` → candidates.
5. Dedupe candidates against existing edges (any source, any approval state — duplicates skipped).
6. Bulk insert net-new edges with `source='auto', user_approved=False`. Use Postgres `INSERT ... ON CONFLICT (model_id, contact_a_id, contact_b_id) DO NOTHING` to absorb concurrent-write races.
7. **Does NOT call `ResolveLithoInstances` or `DetectLithoLenses`.** Auto edges are not approved → graph topology for resolver / lens detection is unchanged.
8. Single commit. Return:
   ```python
   @dataclass
   class AutoCorrelateContactResult:
       edges_created: int
       edges_skipped_existing: int
   ```

### `AcceptContactCorrelations` (new)

Path: `groundmodel/application/accept_contact_correlations.py`.

`execute(project_id, model_id, section_id: UUID | None = None) → AcceptResult`:
1. Scope-guard model belongs to project (and section to model if supplied).
2. Build the candidate set: `SELECT id FROM litho_contact_correlation_edge WHERE model_id=:mid AND user_approved=FALSE`.
3. If `section_id` is supplied: filter further to edges where *both* `contact_a_id` and `contact_b_id` are in `cross_section.seeded_formation_contact_ids` for `section_id`.
4. `UPDATE` those rows `SET user_approved=TRUE`.
5. Call `ResolveLithoInstances.execute(model_id=model_id)`.
6. Call `DetectLithoLenses.execute(prefer_section_id=section_id)`.
7. Single commit. Return:
   ```python
   @dataclass
   class AcceptResult:
       edges_accepted: int
       lenses_created: int
       lenses_removed: int
       ordinals_changed: int
   ```

### `DetectLithoLenses`

Path: `groundmodel/application/detect_litho_lenses.py`.

`execute(project_id, model_id, prefer_section_id: UUID | None = None) → DetectLensesResult`:
1. Load all `user_approved=True` contact edges + per-investigation contact stacks for the model.
2. Call `detect_lenses_from_graph(...)` → candidates.
3. For each candidate, resolve `body_ordinal` from `geological_formation.instance_ordinal` for the lens body's formation. **If null**, skip with WARNING log — the resolver hasn't produced an ordinal yet (should not happen post-rewrite, but defensive).
4. Resolve `primary_section_id`:
   - If `prefer_section_id` is supplied AND it contains both `target_investigation_id` and the source investigation → use it.
   - Else: query `cross_section` rows whose investigation list contains both. If multiple, pick the lowest id deterministically. If none, leave null.
5. Upsert `LithoLensOrm(model_id, formation_id, body_ordinal, primary_section_id)`.
6. Reconcile: build the set of `(formation_id, body_ordinal)` tuples produced by step 2. Any `LithoLensOrm` row for this model whose `(formation_id, body_ordinal)` is **not** in that set is stale → delete. Companion sections survive with `companion_lens_id` nulled and `is_lens_companion=True` (FK is `ON DELETE SET NULL`).
7. Single commit. Return:
   ```python
   @dataclass
   class DetectLensesResult:
       lenses_created: int
       lenses_removed: int
       lenses_skipped_unresolved_ordinal: int  # diagnostic; should be 0 in normal flow
   ```

### `MaterialiseLensCompanions`

Path: `groundmodel/application/materialise_lens_companions.py`.

Same shape as the previous spec, with the gate hardened to user-approved edges only:

`execute(project_id, model_id) → MaterialiseLensCompanionsResult`:
1. Load all `LithoLensOrm` rows for the model that lack a companion section.
2. For each lens:
   - If `primary_section_id` is null → `skipped_no_primary++`, continue.
   - Load the primary section's `seeded_formation_contact_ids`.
   - **Gate (uses approved edges only):** every contact id in that set must appear in at least one `litho_contact_correlation_edge` row with `user_approved=TRUE`. If any contact has zero approved edges → `skipped_unfinished_section++`, continue.
   - Call `CreatePerpendicularCompanion(lens_id)`. Try/except per-lens; on exception `errored++`.
3. Return counts:
   ```python
   @dataclass
   class MaterialiseLensCompanionsResult:
       companion_sections_created: int
       skipped_no_primary: int
       skipped_unfinished_section: int
       errored: int
   ```

### `CorrelateLithoContacts` / `UncorrelateLithoContacts` (existing, extended)

- Add optional `request_section_id: UUID | None = None` parameter (passes through to detector via `prefer_section_id`).
- After the edge mutation, call `ResolveLithoInstances.execute(model_id=model_id)` then `DetectLithoLenses.execute(prefer_section_id=request_section_id)`.
- New manual edges insert with `user_approved=True` (matching Phase 1 semantics; the gesture itself is implicit acceptance).
- Single transaction across edge mutation + resolver + lens detection. If any phase raises, rolls back the edge.

### Removed use cases

- `CorrelateLithoUnits`, `UncorrelateLithoUnits` — formation-level manual gesture had no contact-level analogue beyond what's already wired.
- `AutoCorrelateLithoBodies` (#127) — auto-correlate is contact-level only after this slice.
- The standalone `ResolveLithoInstances` endpoint trigger — resolver auto-runs on every approved-edge mutation.

## API

### Contact-level (the surviving correlation API)

**`POST /projects/{pid}/geology/models/{mid}/contact-correlations/auto`** (new)
- Body: empty.
- Response: `{ edges_created, edges_skipped_existing }`. No lens counts (detection doesn't fire here).
- Errors: 404 if model not in project.

**`POST /projects/{pid}/geology/models/{mid}/contact-correlations/accept`** (new)
- Body: `{ section_id?: UUID }`. Section-scoped if present, model-scoped otherwise.
- Response: `{ edges_accepted, lenses_created, lenses_removed, ordinals_changed }`.
- Errors: 404 if model not in project; 404 if section_id supplied and section not in model.

**`POST /projects/{pid}/geology/models/{mid}/contact-correlations`** (extended)
- Body: existing `{ contact_a_id, contact_b_id, source: Literal["manual"] }` gains optional `request_section_id: UUID | None`. `source` stays `Literal["manual"]` on this endpoint (auto edges only land via the auto endpoint, never via the manual path).
- Response: existing.

**`DELETE /projects/{pid}/geology/models/{mid}/contact-correlations`** (extended)
- Body: existing `{ contact_a_id, contact_b_id }` gains optional `request_section_id: UUID | None`.
- Response: existing.

**`GET /projects/{pid}/geology/models/{mid}/contact-correlations`** (extended)
- Response: every edge gains a `user_approved: bool` field.

**`POST /projects/{pid}/geology/models/{mid}/lens-companions/materialise`** (new)
- Body: empty.
- Response: `{ companion_sections_created, skipped_no_primary, skipped_unfinished_section, errored }`.

**`PATCH /projects/{pid}/geology/models/{mid}/contact-correlations/admixtures`** (renamed from `.../correlations/admixtures`, internals rewritten)
- Body / response unchanged. Backend now derives the propagation graph from contact edges. FE call signature in `api.geology.propagateCorrelatedLithoAdmixtures` stays the same; only the URL it hits changes.

### Removed endpoints

- `POST /projects/{pid}/geology/models/{mid}/correlations` (formation-level create)
- `DELETE /projects/{pid}/geology/models/{mid}/correlations` (formation-level delete)
- `POST /projects/{pid}/geology/models/{mid}/correlations/auto` (formation-level auto-correlate)
- `POST /projects/{pid}/geology/models/{mid}/correlations/resolve` (manual Resolve trigger — auto-runs now)
- `GET /projects/{pid}/geology/models/{mid}/correlations` (formation-level list)
- `PATCH /projects/{pid}/geology/models/{mid}/correlations/admixtures` → renamed to `PATCH /projects/{pid}/geology/models/{mid}/contact-correlations/admixtures` (same handler shape, contact-derived graph internally; URL renamed for consistency now that everything correlation-related lives under `/contact-correlations`).

Routes simply disappear — pre-ship backwards-compat is suspended, no 410 Gone phase needed. The `.gmproj` v3 save/restore path doesn't call any of these, so file round-trip is unaffected.

## Frontend

### Removed from the renderer

- `CorrelateGestureState` interface + plumbing through `SectionPanel`, `SectionsCanvas`, `CorrelationEdgesOverlay`.
- Formation-level body-band click handlers in `CorrelationEdgesOverlay`.
- Formation-level ribbon rendering paths in `CorrelationEdgesOverlay` (the dashed-line + body chip ribbons derived from formation edges). The Position 4 body chips that read `instance_ordinal` directly remain — they don't depend on formation edges.
- The Resolve trigger button (was the FE counterpart to `POST /correlations/resolve`).

### API client (`desktop/src/renderer/src/api/client.ts`)

**Removed:**
- `api.geology.correlate` (formation-level create)
- `api.geology.uncorrelate` (formation-level delete)
- `api.geology.listCorrelations` (formation-level list)
- `api.geology.autoCorrelate` (formation-level auto — rename below replaces it)
- `api.geology.resolveLithoInstances` (manual resolve trigger)

**Renamed / extended:**
- `api.geology.autoCorrelate` → `api.geology.autoCorrelateContacts`. New signature `(projectId, modelId)` → `{edges_created, edges_skipped_existing}`.
- `api.geology.createContactCorrelation(projectId, modelId, contactAId, contactBId, requestSectionId?)`.
- `api.geology.deleteContactCorrelation(projectId, modelId, contactAId, contactBId, requestSectionId?)`.
- `api.geology.listContactCorrelations` — return shape gains `user_approved`.

**New:**
- `api.geology.acceptContactCorrelations(projectId, modelId, sectionId?)`.
- `api.geology.materialiseLensCompanions(projectId, modelId)`.

### Toolbar buttons (`SectionsToolbar`)

| Button | Behaviour |
|---|---|
| **Auto-correlate** | Calls `autoCorrelateContacts`. Toast: "Auto-correlate proposed N candidate edges. Review and accept on the section." |
| **Accept correlations** (new) | Calls `acceptContactCorrelations(sectionId=activeSection)`. Toast: "Accepted M correlations. K new lenses detected." Disabled when no unapproved edges exist for the active section. |
| **Materialise lens companions** (new) | Calls `materialiseLensCompanions`. Toast: "Lens companions: P created, Q skipped (sections not fully correlated), R skipped (no primary section)." Disabled when zero `LithoLens` rows lack a companion (either no lenses, or every lens already has its companion). |
| ~~Resolve~~ | Removed — resolver auto-runs. |

### Edge rendering (`CorrelationEdgesOverlay`)

- Approved edges (`user_approved=True`): existing solid emerald style.
- Unapproved edges (`user_approved=False`): dashed amber. Reuses the existing `CONTACT_EDGE_DASH` token, swap colour to `--amber-500` (already in the Tailwind palette per the dark-mode strategy in docs/ux.md).
- Right-click on an unapproved edge: "Reject" (deletes the edge) only. Single-edge accept is intentionally deferred — the only V1 acceptance path is the section-scoped bulk button. Filed as out-of-scope follow-up below.
- The #135 gesture state machine (CC1–CC7) is unchanged. Auto edges don't participate in the sticky lens-window — they're not interactable until accepted.

### `SectionsCanvas` data flow

After each successful call, refetch:
- Auto-correlate: `contactEdges`.
- Accept correlations: `contactEdges`, `lithoLenses`, `lithoFormations` (instance_ordinal may have changed via the resolver).
- Materialise companions: `cross_section` list, `lithoLenses`.
- Manual #135 create/delete: existing `contactEdges` refetch + new `lithoLenses` refetch + `lithoFormations` (ordinals).

## Data flow scenarios

**1. Manual #135 gesture commits an edge**
```
SectionsCanvas.handleCreateContactCorrelation
  → POST /contact-correlations { contact_a_id, contact_b_id, request_section_id }
    → CorrelateLithoContacts.execute
      → insert LithoContactCorrelationEdge (user_approved=TRUE)
      → ResolveLithoInstances.execute(model_id)
      → DetectLithoLenses.execute(prefer_section_id=request_section_id)
    → single commit
  → 201/200
FE refetches contactEdges + lithoLenses + lithoFormations
```

**2. Auto-correlate click**
```
SectionsToolbar.onAutoCorrelate
  → POST /contact-correlations/auto
    → AutoCorrelateContactEdges.execute
      → load contacts + locations + lithology snapshot
      → auto_correlate_contact_edges(...) → candidates
      → bulk insert net-new edges (user_approved=FALSE)
    → single commit
  → toast: "Auto-correlate proposed 47 edges. Review and accept on the section."
FE refetches contactEdges  (lithoLenses unchanged — no detection yet)
```

**3. Accept correlations click (section-scoped)**
```
SectionsToolbar.onAcceptCorrelations
  → POST /contact-correlations/accept { section_id }
    → AcceptContactCorrelations.execute
      → UPDATE edges SET user_approved=TRUE WHERE in-scope AND user_approved=FALSE
      → ResolveLithoInstances.execute(model_id)
      → DetectLithoLenses.execute(prefer_section_id=section_id)
    → single commit
  → toast: "Accepted 12 correlations. 1 new lens detected."
FE refetches contactEdges + lithoLenses + lithoFormations
```

**4. Materialise lens companions click**
```
SectionsToolbar.onMaterialiseLensCompanions
  → POST /lens-companions/materialise
    → MaterialiseLensCompanions.execute
      → for each LithoLensOrm without companion:
          gate: every contact on primary section has user_approved=TRUE edge
          if pass → CreatePerpendicularCompanion(lens_id)
      → per-lens commits
  → toast: "Lens companions: 4 created, 2 skipped (sections not fully correlated)."
FE refetches cross_section list
```

**5. Contact edge deletion (manual #135 uncorrelate or right-click Reject)**
```
SectionsCanvas.handleDeleteContactCorrelation
  → DELETE /contact-correlations { contact_a_id, contact_b_id, request_section_id }
    → UncorrelateLithoContacts.execute
      → delete edge (regardless of approval state)
      → ResolveLithoInstances.execute(model_id)
      → DetectLithoLenses.execute(prefer_section_id=request_section_id)
    → single commit
FE refetches contactEdges + lithoLenses + lithoFormations
```

**6. Build click** — `POST /surfaces/rebuild` unchanged; TIN refresh only. Companion creation is the separate Materialise button.

**7. Primary section deletion** — `primary_section_id` is `ON DELETE SET NULL`. The `LithoLens` row survives with null primary; its companion survives standalone with `is_lens_companion=True`.

## Error handling

| Surface | Failure mode | Behaviour |
|---|---|---|
| Auto-correlate | Concurrent duplicate edge insert | `ON CONFLICT DO NOTHING`, counted as `edges_skipped_existing` |
| Accept | No edges to accept | `edges_accepted=0`, downstream resolver + detection still run (idempotent), 200 response |
| Resolver | Cycle in formation graph from contact edges | Connected-component algorithm handles cycles naturally; no special case |
| Lens detection | `instance_ordinal` null on a body | Skip with WARNING; counted in `lenses_skipped_unresolved_ordinal` (should be 0 post-rewrite; defensive) |
| Lens detection | Multiple candidate primary sections | Pick lowest id deterministically |
| Materialise companions | Primary section deleted mid-loop | `CreatePerpendicularCompanion` raises ValueError → caught, `errored++` |
| Materialise companions | Section has zero contacts | Vacuous gate pass — companion created (no contacts to be uncorrelated) |
| All endpoints | Model not in project | 404 |

**Transactional posture**
- `AutoCorrelateContactEdges`: bulk insert in one transaction.
- `AcceptContactCorrelations`: flip + resolver + detection in one transaction.
- `CorrelateLithoContacts` + `UncorrelateLithoContacts`: edge mutation + resolver + detection in one transaction.
- `MaterialiseLensCompanions`: per-lens commits (matching `CreatePerpendicularCompanion`'s existing semantics).
- All resolver + detection runs are idempotent — a re-run with unchanged inputs is a no-op.

**Logging (per DoD)**
- INFO at use-case entry; SUCCESS at exit with all counts.
- DEBUG per candidate / per lens / per skip-reason.
- WARNING for null primary, missing body_ordinal, per-lens errors.

## Testing

**Unit (no DB, `tests/unit/domain/services/`)**
- `test_auto_correlate_contact_edges.py`
  - Happy path: 3 columns × 2 boundaries, MNN converges. (No Theil-Sen variant — simpler suite.)
  - Boundary-signature filter rejects same-litho-above different-litho-below.
  - Boundary-signature filter accepts deepest-contact null-litho-below matching null-litho-below.
  - MNN tie-breaking.
  - Distance gate.
- `test_detect_lenses_from_graph.py`
  - Happy path: 2 source contacts converging on 1 target → 1 lens candidate.
  - N=3 stacked: 2 lens candidates.
  - 1-to-1 edges only → empty.
  - Two independent lens topologies in the same model → 2 candidates.
  - Mixed approved + unapproved edges in the input → only approved drive detection (the application layer pre-filters; the domain helper assumes filtered input).
- `test_resolve_litho_instances_contact_based.py`
  - Empty graph → singleton components.
  - Chain A↔B↔C → one component, three formations get ordinal 0.
  - Naming-group isolation: formations in different naming groups never share a component even when contact edges cross them.
  - `instance_ordinal_locked=True` survives a re-resolve.

**Integration (DB, `tests/integration/application/`)**
- `test_auto_correlate_contact_edges.py` — end-to-end with fixture model. Edges inserted with `source='auto', user_approved=False`. Re-run idempotent. Resolver + detection NOT triggered.
- `test_accept_contact_correlations.py` — section-scoped accept flips only in-scope edges; model-scoped accept flips all. Resolver + detection fire. Idempotent re-run (no-op when nothing unapproved).
- `test_detect_litho_lenses.py` — lens row materialised by approved gesture; lens row removed when defining edge deleted; unapproved edges never seed lenses.
- `test_materialise_lens_companions.py` — gate evaluates approved edges only; gate-pass creates companion; gate-fail skips; idempotent; per-lens error doesn't abort loop.
- `test_resolve_litho_instances_after_rewrite.py` — same behaviour as the legacy resolver test suite, against the new contact-edge consumer.
- `test_propagate_correlated_admixtures_after_rewrite.py` — BFS traverses contact-derived graph; admixtures land on every formation in the component.

**Removed tests**
- Every test exercising `CorrelateLithoUnits`, `UncorrelateLithoUnits`, `AutoCorrelateLithoBodies`, or the formation-level edge ORM. Delete; do not stub.

**E2E (Playwright, `desktop/tests/e2e/`)**
- `auto-correlate-and-lenses.spec.ts` (new):
  1. Seed project with 3 investigations + manually-placed contacts.
  2. Click Auto-correlate → dashed amber edges appear; no lenses in inspector.
  3. Click Accept correlations → edges turn solid emerald; lens appears in inspector.
  4. Click Materialise lens companions → companion section appears in list with `is_lens_companion` styling.

**No new benchmark** — typical model sizes (<1000 contacts, <500 column-pairs) keep both algorithms in the low-ms range. Add if dogfeed shows real-project timings warrant it.

## Implementation order (one PR, suggested commit sequence)

One PR, committed in slices the pre-commit hook can validate independently. Each commit is conventional-format, one logical change. The ordering is load-bearing: consumers must be removed before their data substrate.

1. `feat(schema): add user_approved column to litho_contact_correlation_edge` — Alembic migration (additive).
2. `feat(domain): auto_correlate_contact_edges algorithm (no Theil-Sen)` — pure domain.
3. `feat(domain): detect_lenses_from_graph` — pure domain.
4. `refactor(application): rewrite ResolveLithoInstances to consume contact edges` — switch over the resolver; extensive test sweep. From this commit forward, no production code path needs the formation-level edge table for ordinal computation.
5. `refactor(application): rewrite PropagateCorrelatedLithoAdmixtures to derive graph from contact edges` — second consumer migrated. After this commit, only the deleted-in-step-7 use cases still touch the formation-level table.
6. `feat(application): AutoCorrelateContactEdges + DetectLithoLenses + AcceptContactCorrelations + MaterialiseLensCompanions use cases + wire into CorrelateLithoContacts/Uncorrelate` — new contact-level orchestration. (Single commit if the use cases are small; split if any one grows.)
7. `chore(application): delete AutoCorrelateLithoBodies + CorrelateLithoUnits + UncorrelateLithoUnits + their tests + formation-level endpoints` — last code references to the formation-level edge ORM. After this commit, only the ORM definition + repository file reference the table.
8. `feat(api): contact-correlations/auto + /accept + lens-companions/materialise endpoints; user_approved in GET response; admixtures URL rename`.
9. `feat(api-client): wire new endpoints + remove formation-level methods + update admixtures URL`.
10. `feat(sections): Accept correlations + Materialise lens companions toolbar buttons + edge styling for user_approved`.
11. `refactor(sections): remove CorrelateGestureState + formation-level ribbon rendering + Resolve button`.
12. `chore(schema): drop litho_correlation_edge table + ORM model + repository` — runs once all references are gone (steps 4, 5, 7).
13. `docs(debt): mark #133 Phase 2+3 shipped`.

The critical sequence is **4 → 5 → 7 → 12**: resolver migrates first, admixture propagation migrates second, formation-level use cases delete third, table drops last. Reversing any pair breaks the build.

## Out-of-scope follow-ups (file as Tier G debt after this PR ships)

- **Per-contact "intentionally orphaned" marker** — softens the strict companion-creation gate. New `marked_no_correlate: bool` column on `FormationContactOrm`; small UI to toggle; gate qualifies when every contact has an edge OR the marker. Pick up if dogfeed surfaces the friction.
- **Lens-aware ribbon styling** (#131) — needs `lens_id` FK on `LithoContactCorrelationEdgeOrm`; tag edges produced inside `DetectLithoLenses` so the renderer can group by lens.
- **Per-project dip override** — single float (% dip), applied uniformly when computing the depth window in auto-correlate. The Theil-Sen replacement if dogfeed shows the simpler algorithm leaves too many gaps in dipping zones.
- **Parameter-aware correlation scoring** — Robertson Ic / Dr / NAD class once available at the relevant stage. Phase 5.
- **Single-edge accept from the right-click menu** — extend the accept endpoint to take an optional `edge_ids: UUID[]` parameter; surface "Accept this one" in the right-click menu alongside "Reject".

## Backwards compatibility

Backwards-compat is SUSPENDED pre-ship (owner directive 2026-05-16 in CLAUDE.md). This slice exercises that suspension: schema change is non-additive (drops a table), API surface is non-additive (removes endpoints). Re-arm fires at first external distribution; the contact-level world becomes the v1.0 baseline at that point.

## Open questions resolved during brainstorming

| Question | Resolution |
|---|---|
| Scope: which Phase 2 pieces in this slice? | Both auto-correlate + lens detection. |
| Lens-detection signal? | #135 topology only. |
| Auto-correlate algorithm? | Boundary-signature aware (above + below lithology must match). |
| Theil-Sen dip transfer? | Scrapped. Simpler depth-window matching; Accept flow + manual #135 catch the false negatives. Per-project dip override is the follow-up if needed. |
| `source` vs `user_approved`? | Both fields, orthogonal. `source` = provenance, `user_approved` = state. |
| Auto-correlate triggers lens detection? | No. Auto edges are unapproved → not in the graph the detector reads. |
| Accept correlations scope? | Section-scoped by default. Optional `section_id` parameter on the endpoint allows model-scoped if omitted. |
| Lens calculator trigger? | Fires on: manual #135 create/delete + Accept correlations. Not on auto-correlate batch. |
| Companion creation gate? | Every contact on primary section has a `user_approved=TRUE` outbound edge. |
| Companion creation trigger? | Separate toolbar button — not folded into Build. |
| NAD-based scoring? | Out of scope. Circular dependency (NAD is geotech-downstream). |
| Remove formation-level body-click gesture? | Yes, plus the full Phase 3 cut: drop the edge table, rewrite the resolver to consume contact edges, drop formation-level use cases / endpoints / FE. |
| One PR or two? | One PR, Phase 2+3 combined. Commits sliced per file/use case. |

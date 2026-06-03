# Per-instance body identity — design

**Date:** 2026-06-03
**Status:** approved (brainstorm), pending implementation plan
**Owner directive:** "Design it properly now" — distinct uncorrelated litho units
of the same lithology+admixture must become distinct, separately-numbered
instances (QHSa1 / QHSa2), each its own body with its own label and extents.

---

## Problem

Three dogfeed symptoms share one root cause:

- **Bug A — missing second label.** Naming two same-lithology units between
  QHc1 and QHSa1 produced only one numbered label; the second never got its
  "2" suffix.
- **Bug C — body jumps on pinch-out accept.** Accepting a pinch-out makes the
  body jump up/left and ignore the original suggestion geometry.
- **Q1 — over-suppressed suggestions.** "Suggest pinch-outs" stopped offering
  candidates between already-named same-lithology bodies.

### Root cause

A `body` is identified by `(model_id, formation_id, body_ordinal)`
(`uq_body_model_formation_ordinal`). `body_ordinal` is sourced from the
**formation-level** instance resolver, and a litho **formation row** is
found-or-created by `(parent_formation_id, litho_main_soil_code,
canonical_admixture_signature)` (`accept_litho_suggestions._build_litho_formation_lookup`).

So two physically-distinct units with identical lithology+admixture collapse
into **one formation row**. The resolver (`resolve_litho_instances`) then runs
connected-components over **formation nodes** and *discards within-formation
correlation links as "self-loops"* (`resolve_litho_instances_use_case._run_resolver`,
the `fa == fb` branch) — i.e. it throws away the exact signal that would
distinguish two uncorrelated same-formation units. Result: one formation row →
one ordinal → one body → one label (rank 1 only), bodies that can't tell which
instance a claim targets (the 409 `ProvenanceViolationError`), and a render
path that re-derives a body's frame from "the shallowest formation contact" and
therefore snaps to the wrong instance (the jump).

The label machinery is **not** the bug: `BodyExtentOverlay` already ranks bodies
by depth within a `parent+lithology` group (`computeDepthStacking` +
`lensAutoLabel`) and would emit QHSa2 the moment a second body exists.

---

## Confirmed model (owner)

- **An instance = one connected component of correlated layers.** Anything
  uncorrelated is its own numbered instance. Two laterally-separate SAND
  columns you never linked → QHSa1 + QHSa2. Two SAND layers stacked at one
  column separated by clay → trivially distinct (you cannot self-correlate a
  column). Correlating two units merges their number; uncorrelating splits it.
- **The `body` table *is* the instance entity** (decision B-i). It already
  carries identity, `name`, `source_investigation_id`, per-side extents, and
  drives the label. We make it correct rather than standing up a parallel
  `litho_instance` table that would duplicate ~90% of `body` and re-touch the
  2-day-old body-with-extent refactor.

The formation row stays the **shared naming type** (parent + soil + admixture):
it carries the colour, the Lithology-roster entry, and is reused across
sections and sibling models. It must NOT become per-physical-body.

---

## Design

### 1. Layer-level resolver (the engine)

`resolve_litho_instances` (pure domain service) drops from formation
granularity to **layer** granularity:

1. Inputs: accepted `litho_layer` rows
   `(layer_id, formation_id, parent_formation_id, litho_main_soil_code,
   depth_top_m, anchor_investigation_id)` + the user-approved correlation
   edges, with each edge's endpoints translated to **layer ids** (see
   "Edge↔layer correspondence" below).
2. Build connected components over **layers** via BFS. A singleton uncorrelated
   layer is its own component.
3. Group components by `(parent_formation_id, litho_main_soil_code)` taken from
   the component's shallowest layer. Sort components within a group by min
   `depth_top_m` (tiebreak: layer UUID). Assign ordinal `0, 1, 2, …`.
4. A component whose layers span more than one `(parent, soil)` group (only
   possible via a manual cross-lithology correlation — auto-correlate is
   lithology-scoped) takes the group of its shallowest layer as the
   **deterministic representative**, and logs a warning. This is rare and
   intentional-user-action territory; we pick a stable answer rather than
   forbidding it.

The formation-level **lock machinery is dropped for litho**
(`instance_ordinal_locked`, `LockConflict`, the lock-winner passes). Instances
are purely depth-auto-ranked; user intent persists through `body.name`, not an
ordinal pin. This is a net deletion of conflict-resolution code, not a port.
`geological_formation.instance_ordinal` / `instance_ordinal_locked` columns
remain in the schema (harmless; geological-model use only) but litho stops
writing/reading them.

### 2. Body reconciliation becomes the single authority

The resolver's write-back **reconciles `body` rows to the component set** —
consolidating today's scattered body creation into one place that
accept / correlate / uncorrelate / detect all converge on:

- Ensure exactly one `body` per component, keyed `(model_id, formation_id,
  body_ordinal)` where `body_ordinal` = the component ordinal from step 3.
  `uq_body_model_formation_ordinal` still holds: components within one
  `(model, formation)` get distinct ordinals.
- Stamp every accepted layer's `litho_layer.body_id` to its component's body.
- `source_investigation_id` is set on **CREATE only** (existing provenance
  rule, unchanged). For a multi-layer component the source is the shallowest
  layer's investigation.
- A body whose component no longer exists is **deleted unless `name` is set**
  (the existing preserve-named guard — a user-named body survives an orphaning
  topology change and is only removable via explicit delete).

### 3. Framing persistence — kills the jump (Bug C)

No new framing columns. Once `litho_layer.body_id` exists, **the member layers
*are* the frame.** `BodyExtentOverlay` groups layers by `body_id` and draws each
body's source-column band from that layer's real `depth_top_m` / `depth_base_m`,
with the wings driven by the per-side extents — instead of re-deriving from "the
shallowest formation contact," which is what made an accepted body snap to the
wrong instance. Render becomes data-driven.

### 4. Suggester, claim, labels, inspector

- **Suggester (`SuggestBodyPinchOuts`) and claim (`ClaimBodyExtent`)** resolve
  the target body from `layer.body_id` (the instance being framed), not from
  `(formation, formation.instance_ordinal)`. This is the proper fix for both
  the 409 (supersedes the interim `f73039eb` `(formation, instance_ordinal)`
  realignment) and Q1 over-suppression: suppression and claim are per-instance,
  so two distinct named bodies neither suppress each other nor collide.
- **Labels** need no code change beyond being fed the now-correct body set:
  `computeDepthStacking` ranks the distinct bodies → QHSa1 / QHSa2 (Bug A).
- **LithologyInspector / `ordinalStaleness.ts`** re-point from
  `geological_formation.instance_ordinal` to per-body instance labels, so the
  inspector lists instances (QHSa1, QHSa2) grouped by formation, consistent
  with the section labels.

### 5. Edge↔layer correspondence (implementation note)

`litho_contact_correlation_edge` endpoints reference contact ids. Post-A4 the
`litho_layer` row is the source of truth with a defensive FC↔LL mirror. The
resolver must map each edge endpoint to the layer it belongs to (a contact is
the top boundary of a layer). The plan resolves the exact join
(layer-by-top-depth-and-anchor, or the mirror's layer id) against the live
schema before coding; the design requires only that components are built over
**layers connected by approved edges**.

### 6. Migration & self-heal

Pre-ship amnesty applies — **no `format_version` bump.** One additive migration:

- `litho_layer.body_id` — nullable `UUID` FK → `body.id`, `ON DELETE SET NULL`,
  indexed (`idx_litho_layer_body`).

The existing startup sweep and the project-restore reconcile hooks already run
`ResolveLithoInstances` per litho model; they now invoke the layer-level
resolver. **Live dogfeed data self-heals on open:** stacked / uncorrelated
same-formation layers re-split into components → distinct bodies → correct
labels, with no re-accept. Bundle v4 gains `litho_layers[].body_id`; the
top-level `bodies[]` array already round-trips.

---

## Out of scope

- A standalone `litho_instance` table (rejected: B-i chosen — the body is the
  instance).
- Geotech-stage per-unit attributes (NAD class, Dr) — they attach to the
  geotech sibling model later; the body-as-instance is a sufficient home when
  that lands.
- Two-sided lens authoring / interfingering geometry (Phase 5, unchanged).
- Backwards-compat shims (suspended pre-ship).

---

## Testing

### Domain (unit, `tests/unit`)
- Two uncorrelated same-signature layers → distinct ordinals (0, 1).
- Same-column stacked layers separated by another lithology → distinct
  instances (cannot self-correlate).
- Correlating two components → one component, one ordinal.
- Uncorrelating → splits back into two components.
- Cross-`(parent, soil)` component → deterministic representative group +
  warning.

### Integration (`tests/integration`, sibling `_integration` DB)
- Accept two uncorrelated SAND units → two `body` rows + labels rank 1 / 2.
- Correlate → merge to one body; uncorrelate → split to two.
- Suggester suppression is per-instance (a named body on one instance does not
  suppress candidates on the other).
- Claim targets the correct per-instance body (no 409 cross-instance collision).
- Preserve-named orphan body survives a topology change that removes its layers.

### Frontend (vitest)
- `BodyExtentOverlay` derives each body's frame from its member layers — an
  accepted pinch-out does not jump.
- Two distinct bodies render `QHSa1` + `QHSa2`.

### e2e (Playwright Electron, `scripts/run-e2e.ps1`, offline fixture mode)
A `flow_per_instance_body_*` spec (per the #130 coverage-expansion convention;
close the dev app first — `:8765`):
1. Accept two uncorrelated same-lithology units on one section → assert two
   distinct labels render (`QHSa1` + `QHSa2`, not a single label).
2. Correlate them → assert labels collapse to a single instance.
3. Accept a pinch-out → assert the body band stays put (no jump) and keeps its
   label.

---

## Net change

One additive column (`litho_layer.body_id`), a resolver reworked from
formation- to layer-granularity (net code *reduction* from dropping the lock
machinery), a data-driven render fix in `BodyExtentOverlay`, per-instance
suggester/claim resolution, and an inspector label re-point. The formation row
remains the shared naming vocabulary; the body becomes the correct per-instance
entity.

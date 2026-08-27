# Parameters body tree — design spec

Date: 2026-08-27. Status: approved shape (owner picked variant B, "grouped");
this document is the contract for the implementation plan.

## Rulings this design implements (owner, verbatim)

1. Q1, body identity: *"uninterrupted fill is there because of the ties. Ties
   -> form a bodies -> causes uninterrupted fill -> one body."* Fill
   connectivity defines a body; ties are the mechanism that builds the fill.
   **Body resolution does not change.**
2. Tree shape: *"it is best to geometrically split all litho bodies first.
   That gives you the first depth of the tree, the geotech subsplit then
   lives beneath that. So you can halve silt > silt 1 or silt 2 or silt 3 >
   and under silt 3 you might have SF silt 1 and SF silt 2 (if they are
   geometrically split) and then MF silt."*
3. Grouping: variant **B** — a class row sits between the litho body and its
   geotech bodies (*"I think B is best right?"*, confirmed). The class row is
   the future home of the parked per-class pooling offer (R7) — **not built
   now**.

## 1. The tree

The Parameters pane's unit roster is REPLACED by one tree for both models:

```
LITHO UNIT            (litho formation row; always listed — kills the
│                      "litho units unreachable" gap)
└─ LITHO BODY         (resolver body on the litho model)
   └─ CLASS ROW       (one NAD class inside that litho body)
      └─ GEOTECH BODY (resolver body on the geotech model)
```

* **Ordering.** Litho units by roster order (display_order); litho bodies by
  ordinal; class rows by nad_class ascending; geotech bodies by ordinal.
* **Labels.** Litho body: the body's name if named, else `#<ordinal>` under
  its unit's name (rendered "SILT · #3"). Class row: the NAD class
  abbreviation + name (the `nadClasses.ts` single source). Geotech body:
  name if named, else `<class-abbr> #<ordinal>` ("SF #1"). Raw tooltips per
  the translate-at-presentation-boundary rule.
* **Counts.** Every selectable row shows `N bands · M with cone` computed
  over the ground its click pools (the F7 honesty convention). A class row
  sums its bodies; a litho body sums its classes.
* **Single-child collapse.** A level with exactly one child renders no
  expander and no child row; the parent row's click scopes the parent's own
  identity (the pooled set is identical by construction). Applies at every
  level (GT3 precedent).
* **Auto-expand.** A selection arriving by jump or deep link expands the
  path to its node (PU17 precedent).
* **Duplicate geo-label twins disappear from navigation**: class rows key on
  `nad_class` within a litho body, never on geotech formation rows. No
  backend change; the twin rows simply stop being a navigation concept.

### Membership: which geotech bands belong to a litho body

**Persisted in the DB, per the owner's spec note** (*"can't you just create a
foreign key … in a many to one manner in the DB?"*) — with the FK at BAND
level rather than body level, because litho recomputes re-mint litho body
ids: a body→body FK would dangle on every recompute, while a band→band FK is
stable and the body is derived live through it.

* Migration (additive, nullable, chains after `b8c9d0e1f2a3`):
  `litho_layer.parent_litho_layer_id` — FK to `litho_layer.id`,
  `ON DELETE SET NULL`. Meaningful only on geotech-model rows.
* Stamped at birth: the subdivider creates geotech bands BY splitting litho
  bands, so the materialiser writes the parent id it already holds. Manual
  band verbs (split / set-class / band edits) preserve or re-derive it the
  same way.
* Backfill: one data migration stamps existing geotech bands using the
  midpoint rule below; rows with no covering litho band stay NULL.
* Derivation, in plain words: take the geotech band's vertical midpoint;
  find the accepted litho band on the same investigation that covers that
  midpoint; that litho band is the parent. (This rewrites the sentence the
  owner flagged as garbled.) The litho BODY of a geotech band =
  `parent_litho_layer.body_id`, read live — never stored, never stale.
* The renderer reads `parent_litho_layer_id` from the layer payload; the
  midpoint rule survives only in the backfill and in the band verbs, one
  backend source.
* **.strix:** the bundle serialises columns generically
  (`__mapper__.column_attrs`), so the field rides the file for free; old
  bundles restore with NULL parents (the honest orphan state). The FK is
  SELF-referencing, so restore must insert the litho model's layers before
  the geotech model's (guaranteed by parent-model ordering — verify, or
  fall back to a two-pass parent update). Pin: save → wipe → restore →
  every parent id intact (integration test).

A geotech band with `parent_litho_layer_id = NULL` (no covering litho band)
is EXCLUDED from the tree and counted once per litho unit in a quiet footer
line ("N bands outside the litho model"), never given an invented home.

## 2. Scope model

`ParameterUnitScope` becomes a five-kind discriminated union (ShellContext) —
four tree nodes plus one jump-only fallback:

```ts
type ParameterUnitScope =
  | { kind: 'litho-unit';    unitId: string }                       // litho formation
  | { kind: 'litho-body';    unitId: string; bodyId: string }       // litho body
  | { kind: 'geotech-class'; lithoUnitId: string; lithoBodyId: string;
      nadClass: number }                                            // class row
  | { kind: 'geotech-body';  unitId: string; bodyId: string }       // geotech body
  | { kind: 'geotech-unit';  unitId: string }                       // jump-only fallback, no tree node
```

* The shipped `{kind:'litho'|'geotech', unitId, bodyId?}` maps 1:1:
  litho→litho-unit, litho+body→litho-body, geotech+body→geotech-body,
  geotech without body→geotech-unit. `parametersDeepLinkTarget` carries the
  same union.
* `geotech-unit` (the old pooled formation-row view) survives ONLY as a jump
  fallback; the tree never produces it and its header states "pooled across
  N bodies" as today.

### Jump mapping (fallback ladder)

Every section jump lands on the most specific node it can prove, falling
back one level at a time:

1. geotech surface with a resolved body → **geotech-body**;
2. geotech surface, body unresolved (e.g. a weld-merged model-fill region)
   but the region's litho parent body is unique → **geotech-class**
   (that litho body + the region's nadClass);
3. still unresolved → **geotech-unit** (today's behaviour);
4. litho surface with a body → **litho-body**; without → **litho-unit**.

## 3. Pooling per node kind

Population filters are UNCHANGED everywhere (canonical section membership,
hidden/removed excluded, accepted bands only). What changes is band
selection:

| Node | CPT/OKP/PSD pool |
|---|---|
| litho-unit | all accepted litho bands of the unit (R1 semantics, as shipped) |
| litho-body | the body's accepted litho bands (as shipped) |
| geotech-class | geotech bands of that nadClass whose litho parent band belongs to the litho body |
| geotech-body | the geotech body's accepted bands (F2 body authority, as shipped) |
| geotech-unit | the formation row's bands (as shipped, fallback only) |

Headers name the path: "SILT › #3 › SF — 2 bodies pooled" for a class row;
"SILT › #3 › SF #1" for a leaf; "X of Y bands" qualifier per F7 where the
pooled subset is smaller.

## 4. Fence cutout per node kind

`fenceCutoutPanels` generalises its body filter to a body SET (source-layer
authority per amended F3 — panel labels never consulted):

* litho-unit / litho-body / geotech-unit: as shipped today;
* geotech-class: panels whose source layers belong to ANY of the row's
  geotech bodies;
* geotech-body: as shipped (single body).

Frame, basemap and zoom stay the F4/F5 behaviour (full model, always).

## 5. What does NOT change

Body resolution, ties, the weld, the Per-test tab, the Methods tab,
section-jump menu surfaces (they already report body identity), the R7
offer (not built; its home is the class row), the e2e goldens (re-blessed
when this lands — the pane shape changes on purpose). Backend changes are
LIMITED to the parent-band FK: the migration, the materialiser/band-verb
stamping, the backfill, and the layer response field — nothing else.

## 6. Modules

Backend (the FK slice):

* migration `litho_layer.parent_litho_layer_id` + backfill (midpoint rule);
* `geotech_borehole_materialiser` + the band verbs stamp the parent at
  every write;
* `LithoLayerResponse` gains the field (additive).

Frontend:

* `parameterBodyTree.ts` (new, pure): builds the tree from
  `lithoFormations + lithoLayers + geotechLayers (with parent ids) + body
  rosters`; exposes `bandsForScope(scope)` used by pooling and cutout alike
  — one authority for "what does this node cover".
* `UnitListPane.tsx`: renders the tree (listbox a11y rules from F11 carry
  over: options own aria-expanded, no focusable descendants).
* `useUnitStatistics.ts` / `UnitIdentificationPanels` / `UnitFenceScene`:
  consume `bandsForScope` instead of per-kind branches.
* `ShellContext.ts` / `AppShell` / `SectionsCanvas`: the union + the ladder.
* `parameterUnitBodies.ts` shrinks to labels/ordinals helpers or folds into
  the tree module (implementation's call; one source either way).

## 7. Testing contract

Red-first pins, phrased in the rulings' words:

1. the tree shape on a two-twin, multi-body scene: one litho unit ▸ its
   bodies ▸ class rows ▸ geotech bodies; twins produce no extra rows;
2. single-child collapse at each level;
3. class-row click pools exactly its bodies' bands (and the header counts
   only contributing bodies);
4. the parent-band FK: stamped at subdivide and at every band verb; the
   backfill stamps legacy rows and leaves true orphans NULL; the tree's
   excluded-orphan counter reads exactly those NULLs;
5. the jump ladder: resolved body → leaf; weld-merged region with unique
   litho parent → class row; unresolved → geotech-unit;
6. cutout panel set equals the pooled band set's bodies for every kind
   (pure filter tests);
7. deep-link round-trip for all five kinds;
8. existing PU/UC/PB pins updated intent-preserved where the pane shape
   changed — each change red-first.

Full gates as always: tsc web, full vitest, hook-order check.

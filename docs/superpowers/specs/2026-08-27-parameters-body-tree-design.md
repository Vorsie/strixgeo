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

Geotech layers do not carry litho body ids. A geotech band belongs to litho
body B iff the accepted litho band on the SAME investigation whose
`[top, base)` interval contains the geotech band's midpoint is stamped
`body_id = B`. This is the established midpoint-in-band rule
(`unitIdentification.midpointInBand`), applied investigation-locally; it is a
pure renderer-side function over the two loaded layer lists.

A geotech band with NO covering accepted litho band (legacy or hand-edited
data) is EXCLUDED from the tree and counted once per litho unit in a quiet
footer line ("N bands outside the litho model"), never given an invented
home.

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

Body resolution, ties, the weld, every backend surface, the Per-test tab,
the Methods tab, section-jump menu surfaces (they already report body
identity), the R7 offer (not built; its home is the class row), the e2e
goldens (re-blessed when this lands — the pane shape changes on purpose).

## 6. Modules

* `parameterBodyTree.ts` (new, pure): builds the tree from
  `lithoFormations + lithoLayers + geotechLayers + body rosters`; exposes
  `bandsForScope(scope)` used by pooling and cutout alike — one authority
  for "what does this node cover".
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
4. the geotech-class membership rule (midpoint-in-litho-band, same
   investigation) incl. the excluded-orphan counter;
5. the jump ladder: resolved body → leaf; weld-merged region with unique
   litho parent → class row; unresolved → geotech-unit;
6. cutout panel set equals the pooled band set's bodies for every kind
   (pure filter tests);
7. deep-link round-trip for all five kinds;
8. existing PU/UC/PB pins updated intent-preserved where the pane shape
   changed — each change red-first.

Full gates as always: tsc web, full vitest, hook-order check.

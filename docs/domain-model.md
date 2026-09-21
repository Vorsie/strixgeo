# Domain Model

> Extracted from `CLAUDE.md` 2026-06-06 to keep the always-loaded file lean. Load this on demand when the pointer in CLAUDE.md says so.

## Domain Model

```
Project                      ← app-level container; everything else
                               carries app_project_id pointing at this
                               row. Soft-deleted via archived_at.

InSituTest (abstract base)
├── PushedInTest
│   ├── CPT   ← GEF / AGS / LAS
│   └── DMT   ← flat dilatometer, also pushed
└── BoreholeTest
    ├── Pressuremeter (PMT)
    ├── SPT
    └── VST

Borehole                     ← a physical hole, not a test
├── BoreholeTests[]
├── Samples[]
└── Observations[]           ← visual log, soil description

LabTest                      ← performed on a Sample, NOT on a Borehole
├── GrainSize          (typed: cumulative size-distribution curve)
├── AtterbergLimits    (typed: liquid-limit + plastic-limit)
├── CaCO3Content       (typed: % calcium carbonate by mass)
├── OrganicContent     (typed: organic carbon %)
├── WaterContent       (typed: w%)
└── ScalarLabTest      (catch-all: any (parameter, value, unit) tuple; ORM + API only, the unused domain class went 2026-09-22)

Monitoring: Piezometer, Inclinometer
Geophysical: MASW, Seismic CPT
```

**Key rules:**
- `LabTest` is associated with a `Sample`, not a `Borehole`
- `DMT` is a pushed test; `Pressuremeter` is a borehole test
- Shared location ≠ inheritance — use composition
- **Catch-all vs typed family rule:** ScalarLabTest is the default home for new
  scalar test parameters. Promote to a typed family ONLY when (a) the test
  needs structural columns the catch-all can't express (e.g. Atterberg's
  LL+PL aggregation, GrainSize's curve), or (b) the parameter is
  validated against a domain rule that needs first-class type safety.
  Adding a new test to the catch-all is one tuple in
  `DOV_OTHER_SCALAR_LAB_TEST_PARAMETERS` — no migration, no schema change.

**Interpretation primitives by model kind (post-A4 Shape A):**
- Geological models: ``FormationContact`` rows are the boundary-centric
  primitive (one row per contact at depth_top_m on an investigation).
- Lithostratigraphic models: ``LithoLayer`` rows are the layer-centric
  primitive (one row per [depth_top_m, depth_base_m] interval at an
  investigation; status ∈ {pending, accepted, rejected}). The LL row is
  the source of truth; a defensive FC↔LL trigger pair keeps a
  formation_contact mirror in sync for legacy /contacts readers
  (bundle export of geological models, external API callers). All
  internal BE + FE litho writers hit /layers/* endpoints natively.
  Exception: synthetic pinch-out contacts (anchor-less, debt #118
  litho-axis pinch-out wiring) stay on formation_contact — Shape A's
  anchor XOR doesn't fit.
- Correlation edges (``litho_contact_correlation_edge.layer_a_id /
  layer_b_id``, renamed from ``contact_a_id / contact_b_id`` in the
  2026-07-13 ARCH-08 cut) FK ``litho_layer.id`` post-A4 (UUIDs
  preserved end-to-end since the A2.5 backfill); the ``layer_*_side``
  columns pick each endpoint's 'top'/'base' contact.
- **Bodies** (``BodyOrm``) are single-lithology units traced across a
  section — the resolver's connected components of approved layer↔layer
  correlation edges, with ``body_id`` stamped on every member
  ``litho_layer``. A body's lateral SHAPE (bands / onlaps / lenses) is NOT
  stored: it is derived geometrically client-side by the partition fill
  (``utils/partitionFillV2/computeSectionFillV2.ts`` + ``PartitionFillOverlay``)
  from how many of each unit's two bounding contacts are correlated to the
  neighbour (2 → band, 1 → onlap, 0 → lens), per-gap / per-side.
  **⚠ The per-side lateral-extent system is RETIRED (2026-06-06, Option 1 —
  partition fill is the single source of truth for body shape).** Gone:
  the four extent kinds (``to_target`` / ``pinch_out_halfway`` /
  ``extrapolated`` / ``open``), ``DetectBodies``, ``SuggestBodyPinchOuts``,
  ``ClaimBodyExtent`` / ``ClearBodyExtent``, ``BodyExtentOverlay``, the
  ``extent_<side>_anchor_layer_id`` anchors (debt #195 is now moot — nothing
  populates extents to lose), and the 10 ``body.extent_*`` columns (drop
  migration ``d8868bb27884``). Kept on ``BodyOrm``: identity, ``body_ordinal``,
  ``name``, the Dissolve/Name context-menu actions, and "Materialise
  companions". Bodies still replace the former ``LithoLensOrm`` entity as the
  lateral primitive. Legacy ``.strix`` bundles carrying stale ``extent_*``
  keys still restore (unknown-key filter). Spec:
  ``docs/superpowers/specs/2026-06-06-body-extent-retirement-design.md``.
  **A2 — geological-formation independence (owner directive 2026-06-04,
  SUPERSEDES the same-day one-geological-formation invariant):** a litho body
  MAY span a geological-formation boundary. ``resolve_litho_instances`` drops a
  correlation edge ONLY on a different ``litho_main_soil_code`` (the one-lithology
  rule); the ``parent_formation_id`` is no longer an edge filter, so a sand
  correlated across the Holocene/Pleistocene boundary is ONE body. Litho units
  are geologically agnostic — accept keys them on ``(lithology, admixture)``
  only and writes ``parent_formation_id=None``; the segmenter no longer
  straddle-splits a layer at a geo boundary (the whole ``_compute_straddle_splits``
  / TIN-extrapolation / sliver-guard machinery is removed). The geological name
  is a DERIVED, body-level label — ``GET /bodies`` computes each body's
  ``geo_formation_id`` / ``geo_formation_name`` by thickness-weighted majority of
  its member layers vs the parent geological model's contacts, computed fresh on
  every read (``domain/services/body_geo_label.py``). Merging stays edge-driven
  and user-controlled: the Boom-Klei-under-Quaternary-clay case (both KLEI, real
  unconformity) stays two bodies because the engineer does not correlate across
  it. Body auto-labels drop the geo-parent prefix → ``Sa1`` / ``Sa2`` (lithology
  + depth rank); the geological name shows as separate context. This retired the
  #157 sliver / #76 straddle-toast / #149 double-unit bug family. Spec:
  ``docs/superpowers/specs/2026-06-04-a2-litho-geo-decoupling-design.md``.
  *(Residual cleanup deferred: the now-always-null ``parent_formation_id``
  column is still physically present — its drop touches the ``.gmproj`` bundle
  and is a planned follow-up migration.)*

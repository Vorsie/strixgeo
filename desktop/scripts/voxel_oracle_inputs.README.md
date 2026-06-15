# `voxel_oracle_inputs.json` — raw-inputs shape for the voxel oracle capture

`scripts/captureVoxelOracle.ts` reads this JSON and reconstructs the exact
`FenceSectionInput[]` that `LithologyCanvas.tsx` builds, then runs
`buildVoxelRequest` and writes `tests/fixtures/voxel/teststrix_partitions.json`.

The controller produces this file by dumping **one litho model** from the dev DB
(`test.strix`). Field names match the DB columns 1:1, so the dump maps directly.

## Shape

```jsonc
{
  // Voxel grid spacing in metres. Overridable on the CLI (argv[3]); default 2.0.
  "grid_spacing_m": 2.0,

  // Every project-visible CPT *and* borehole (NOT project-level excluded).
  // `elevation_m` may be null — a column with a null surface elevation is
  // dropped during assembly, exactly as the app does.
  "investigations": [
    { "id": "cpt-uuid", "location_x": 150000.0, "location_y": 200000.0, "elevation_m": 12.3 }
  ],

  // Every litho layer of the model.
  //   * the column anchor is `cpt_id ?? borehole_id`; a layer with NEITHER is
  //     skipped (no investigation to project onto).
  //   * `status === "accepted"` ⇒ the layer is `accepted` in the partition;
  //     non-accepted layers are filtered out by `assembleSectionPartitionInput`.
  "litho_layers": [
    {
      "id": "layer-uuid",
      "cpt_id": "cpt-uuid",
      "borehole_id": null,
      "formation_id": "formation-uuid",
      "body_id": "body-uuid",      // null when the layer is not part of a body
      "depth_top_m": 0.0,
      "depth_base_m": 5.2,
      "status": "accepted"
    }
  ],

  // Every section of the model.
  //   * `projection_buffer_m` drives the lateral projection filter in
  //     `investigationsOnSection` (an investigation outside the buffer is not
  //     projected onto the line).
  //   * the two exclusion id sets are the per-section explicit hides.
  "sections": [
    {
      "id": "section-uuid",
      "start_x": 150000.0,
      "start_y": 200000.0,
      "end_x": 151000.0,
      "end_y": 200500.0,
      "projection_buffer_m": 50.0,
      "excluded_cpt_ids": [],
      "excluded_borehole_ids": []
    }
  ],

  // Correlation edges keyed by section id. Only `user_approved: true` edges
  // drive the band/onlap/lens classification (the harness filters the rest out,
  // same as the app). `contact_a_id` / `contact_b_id` are litho-layer ids.
  "edges_by_section": {
    "section-uuid": [
      { "contact_a_id": "layer-uuid-1", "contact_b_id": "layer-uuid-2", "user_approved": true }
    ]
  }
}
```

## Run

```bash
cd desktop
npx tsx scripts/captureVoxelOracle.ts [rawInputsJson] [gridSpacingM]
```

- `rawInputsJson` — path to the JSON above. Default `scripts/voxel_oracle_inputs.json`.
- `gridSpacingM` — overrides the JSON's `grid_spacing_m`. Default = the JSON's value, else `2.0`.

Output: `tests/fixtures/voxel/teststrix_partitions.json` (a `VoxelBuildRequest`,
pretty-printed). The harness logs the section / column / region counts so the
controller can sanity-check the dump landed.

## Why this is a faithful oracle

The harness imports the **production** utilities — `investigationsOnSection`,
`assembleSectionPartitionInput`, `computeSectionFill`, and the canonical-world-
position pass (all via `buildVoxelRequest`). The fixture is therefore the exact
2-D partition the user validated on screen; it cannot drift from what the app
renders. Regenerate it whenever the partition algorithm or the dev-DB model
changes.

// desktop/scripts/captureVoxelOracle.ts
//
// Reproducible capture harness for the voxel-builder real-data oracle.
//
// It reads a "raw inputs" JSON (a dump of one litho model's investigations,
// litho layers, sections, and approved correlation edges — produced by the
// controller from the dev DB), reconstructs the EXACT `FenceSectionInput[]`
// that `LithologyCanvas.tsx`'s `fenceSectionInputs` useMemo builds, runs
// `buildVoxelRequest`, and writes the resulting `VoxelBuildRequest` fixture.
//
// The fixture is the frontend-truth oracle: the backend voxel builder is fed
// this payload and its output is compared against the same partition the user
// validated on screen. Because the harness routes through the production
// utilities (`investigationsOnSection`, `assembleSectionPartitionInput`,
// `computeSectionFill`, `computeCanonicalColumnWorldPositions` via
// `buildVoxelRequest`), the PARTITION MATH can never drift from what the app
// renders. The INPUT ASSEMBLY, however, is hand-mirrored from
// `LithologyCanvas.tsx`'s `fenceSectionInputs` useMemo (see
// `reconstructFenceSectionInputs` below) and CAN drift — keep the two in sync.
//
// ---------------------------------------------------------------------------
// RAW-INPUTS JSON SHAPE (the controller produces this from the dev DB)
// ---------------------------------------------------------------------------
//
// {
//   "grid_spacing_m": 2.0,
//   "investigations": [
//     { "id": str, "location_x": num, "location_y": num, "elevation_m": num|null }
//   ],
//   "litho_layers": [
//     { "id": str, "cpt_id": str|null, "borehole_id": str|null,
//       "formation_id": str, "body_id": str|null,
//       "depth_top_m": num, "depth_base_m": num, "status": str }
//   ],
//   "sections": [
//     { "id": str, "start_x": num, "start_y": num, "end_x": num, "end_y": num,
//       "projection_buffer_m": num,
//       "excluded_cpt_ids": [str], "excluded_borehole_ids": [str] }
//   ],
//   "edges_by_section": {
//     "<section_id>": [
//       { "layer_a_id": str, "layer_b_id": str, "user_approved": bool }
//     ]
//   }
// }
//
// Field names match the DB columns so the controller's dump maps 1:1:
//   * investigations: one entry per CPT *and* borehole that is visible in the
//     project (NOT excluded at the project level). `elevation_m` may be null
//     (a column with a null surface elevation is dropped, same as the app).
//   * litho_layers: every litho layer of the model. `investigationId` is
//     `cpt_id ?? borehole_id`; a layer with neither is skipped (no anchor).
//     `status === 'accepted'` ⇒ the layer is `accepted` in the partition.
//   * sections: each section's endpoints + `projection_buffer_m` (drives the
//     lateral projection filter) + its per-section exclusion id sets.
//   * edges_by_section: keyed by section id; only `user_approved` edges drive
//     the band/onlap/lens classification, exactly as in the app.
//
// ---------------------------------------------------------------------------
// USAGE (run with tsx — picks up the renderer tsconfig path/JSX settings):
//
//   cd desktop
//   npx tsx scripts/captureVoxelOracle.ts [rawInputsJson] [gridSpacingM]
//
//   rawInputsJson  default: scripts/voxel_oracle_inputs.json
//   gridSpacingM   default: the raw inputs' `grid_spacing_m`, else 2.0
//
// Output: tests/fixtures/voxel/teststrix_partitions.json (pretty-printed).
// ---------------------------------------------------------------------------

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildVoxelRequest } from '../src/renderer/src/utils/buildVoxelRequest'
import type { FenceSectionInput } from '../src/renderer/src/utils/buildProjectFence'
import type { FenceLayerInput, FenceProjectedColumn } from '../src/renderer/src/utils/sectionFenceData'
import { investigationsOnSection } from '../src/renderer/src/utils/sectionProjection'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_INPUTS = resolve(HERE, 'voxel_oracle_inputs.json')
// Repo-root `tests/fixtures/` (HERE = desktop/scripts → '..','..' = repo root),
// NOT desktop/tests — the backend (Python) voxel-litho tests + eval scripts load
// this fixture from the repo-root tests tree.
const OUTPUT = resolve(HERE, '..', '..', 'tests', 'fixtures', 'voxel', 'teststrix_partitions.json')

/** One investigation (CPT or borehole) with its surface elevation. */
interface RawInvestigation {
  id: string
  location_x: number
  location_y: number
  elevation_m: number | null
}

/** One litho layer of the model. */
interface RawLithoLayer {
  id: string
  cpt_id: string | null
  borehole_id: string | null
  formation_id: string
  body_id: string | null
  depth_top_m: number
  depth_base_m: number
  status: string
}

/** One section line with its projection buffer + exclusion sets. */
interface RawSection {
  id: string
  start_x: number
  start_y: number
  end_x: number
  end_y: number
  projection_buffer_m: number
  excluded_cpt_ids?: string[]
  excluded_borehole_ids?: string[]
}

/** One approved-or-not correlation edge (contact-id pair). */
interface RawEdge {
  layer_a_id: string
  layer_b_id: string
  user_approved: boolean
}

/** The full raw-inputs document the controller dumps from the dev DB. */
interface RawInputs {
  grid_spacing_m?: number
  investigations: RawInvestigation[]
  litho_layers: RawLithoLayer[]
  sections: RawSection[]
  edges_by_section: Record<string, RawEdge[]>
}

/**
 * Reconstruct the per-section fence inputs exactly as ``LithologyCanvas`` does.
 *
 * Mirrors the ``fenceSectionInputs`` useMemo: build the project-wide layer
 * inputs (anchored on ``cpt_id ?? borehole_id``), then per section project the
 * investigations onto the line, keep only approved edges, and assemble the
 * ``FenceSectionInput``.
 *
 * DRIFT NOTE: this hand-mirrors ``LithologyCanvas.tsx``'s ``fenceSectionInputs``
 * useMemo — the anchor rule (``cpt_id ?? borehole_id``), the exclusion-id union
 * (``excluded_cpt_ids`` ∪ ``excluded_borehole_ids``), and the approved-edge
 * filter (``user_approved``). If that useMemo changes, this MUST change too.
 */
function reconstructFenceSectionInputs(raw: RawInputs): FenceSectionInput[] {
  // Project-wide layer inputs, anchored on cpt_id ?? borehole_id (skip the
  // unanchored ones, same as the app).
  const layerInputs: FenceLayerInput[] = raw.litho_layers.flatMap((layer) => {
    const invId = layer.cpt_id ?? layer.borehole_id
    if (!invId) return []
    return [
      {
        investigationId: invId,
        layerId: layer.id,
        formationId: layer.formation_id,
        bodyId: layer.body_id ?? null,
        topDepthM: layer.depth_top_m,
        baseDepthM: layer.depth_base_m,
        accepted: layer.status === 'accepted',
      },
    ]
  })

  // `investigationsOnSection` needs each item to satisfy `InvestigationPoint`
  // (`id`, `location_x`, `location_y`); we also carry `elevation_m` through so
  // the projected column can read the surface elevation.
  const allItems = raw.investigations.map((inv) => ({
    id: inv.id,
    location_x: inv.location_x,
    location_y: inv.location_y,
    elevation_m: inv.elevation_m,
  }))

  return raw.sections.map<FenceSectionInput>((section) => {
    const excludedIds = new Set<string>([
      ...(section.excluded_cpt_ids ?? []),
      ...(section.excluded_borehole_ids ?? []),
    ])
    const projected = investigationsOnSection(
      {
        start_x: section.start_x,
        start_y: section.start_y,
        end_x: section.end_x,
        end_y: section.end_y,
        projection_buffer_m: section.projection_buffer_m,
      },
      allItems,
      excludedIds,
    )

    const projectedColumns: FenceProjectedColumn[] = projected.map((p) => ({
      investigationId: p.item.id,
      alongM: p.along,
      surfaceElevM: p.item.elevation_m,
    }))

    const rawEdges = raw.edges_by_section[section.id] ?? []
    const edges = rawEdges
      .filter((e) => e.user_approved)
      .map((e) => ({ a: e.layer_a_id, b: e.layer_b_id }))

    return {
      section: {
        start_x: section.start_x,
        start_y: section.start_y,
        end_x: section.end_x,
        end_y: section.end_y,
      },
      projectedColumns,
      layers: layerInputs,
      edges,
    }
  })
}

/** Read the raw inputs, build the payload, write the fixture. */
function main(): void {
  const inputsPath = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : DEFAULT_INPUTS
  const raw = JSON.parse(readFileSync(inputsPath, 'utf8')) as RawInputs

  const gridSpacingM = process.argv[3]
    ? Number(process.argv[3])
    : (raw.grid_spacing_m ?? 2.0)

  const fenceSectionInputs = reconstructFenceSectionInputs(raw)
  // The oracle compares against the backend at one fixed CUBIC spacing, so pass
  // the same value for horizontal (X/Y) and vertical (Z) — the anisotropic
  // emission collapses to a cubic grid (vertical === horizontal).
  const request = buildVoxelRequest(fenceSectionInputs, gridSpacingM, gridSpacingM)

  mkdirSync(dirname(OUTPUT), { recursive: true })
  writeFileSync(OUTPUT, `${JSON.stringify(request, null, 2)}\n`, 'utf8')

  const columnCount = request.sections.reduce((n, s) => n + s.columns.length, 0)
  const regionCount = request.sections.reduce((n, s) => n + s.regions.length, 0)
  // eslint-disable-next-line no-console
  console.info(
    `[captureVoxelOracle] wrote ${OUTPUT}: ` +
      `${request.sections.length} sections, ${columnCount} columns, ` +
      `${regionCount} regions, grid_spacing_m=${request.grid_spacing_m}`,
  )
}

main()

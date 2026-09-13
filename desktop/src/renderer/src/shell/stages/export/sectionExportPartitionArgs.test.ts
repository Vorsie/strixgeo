// "A section export from the hub equals the one the toolbar made" (owner ruling,
// installer #35). The closed-geometry exports POST the drawn partition; the hub
// must configure that partition exactly the way the Sections toolbar did, or it
// would ship a different model. This pins the derivation against a committed
// fixture — the args the toolbar's ``useDseriesExportItems`` used to build — so
// the two can never drift.

import { describe, it, expect } from 'vitest'

import {
  axisModelFor,
  sectionExportPartitionArgs,
  type SectionExportContext,
} from './sectionExportPartitionArgs'
import type { GeologicalModelResponse } from '../../../api/clients/geology.types'
import type { SectionLike } from '../../../utils/assembleLithoSectionInputs'

function model(id: string, kind: GeologicalModelResponse['kind']): GeologicalModelResponse {
  return {
    id,
    app_project_id: 'proj-1',
    name: id,
    description: null,
    kind,
    is_active: true,
    excluded_borehole_ids: [],
    parent_model_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

const SECTION: SectionLike = {
  id: 'sec-1',
  start_x: 0,
  start_y: 0,
  end_x: 100,
  end_y: 0,
} as unknown as SectionLike

const PACKING = new Map<string, string>([['f-geo', 'NAD-06|ZAND']])

function ctx(): SectionExportContext {
  return {
    projectId: 'proj-1',
    activeGeologicalModel: model('geo-1', 'geological'),
    activeLithoModel: model('litho-1', 'lithostratigraphic'),
    activeGeotechModel: model('geotech-1', 'geotechnical'),
    investigations: [
      { id: 'cpt-1', location_x: 10, location_y: 0, elevation_m: 5 },
      { id: 'bh-1', location_x: 90, location_y: 0, elevation_m: 6 },
    ],
    lithoLayers: [{ id: 'll-1' } as never],
    geotechLayers: [{ id: 'gl-1' } as never],
    packingClassOf: PACKING,
    viewState: { column_spacing: 2 },
  }
}

describe('axisModelFor', () => {
  it('reads the active model for each axis', () => {
    const c = ctx()
    expect(axisModelFor(c, 'geological')?.id).toBe('geo-1')
    expect(axisModelFor(c, 'lithostratigraphic')?.id).toBe('litho-1')
    expect(axisModelFor(c, 'geotechnical')?.id).toBe('geotech-1')
  })

  it('is null when the axis has no active model', () => {
    const c = ctx()
    c.activeGeotechModel = null
    expect(axisModelFor(c, 'geotechnical')).toBeNull()
  })
})

describe('a section export from the hub equals the one the toolbar made', () => {
  it('litho axis: the model\'s own partition, no frame — as the toolbar built it', () => {
    const c = ctx()
    const args = sectionExportPartitionArgs(c, SECTION, 'lithostratigraphic', 'section-export-dstability')
    expect(args).toEqual({
      projectId: 'proj-1',
      modelId: 'litho-1',
      section: SECTION,
      investigations: c.investigations,
      layers: c.lithoLayers,
      viewState: c.viewState,
      logLabel: 'section-export-dstability',
      frameModelId: null,
      frameLayers: undefined,
      packingClassOf: undefined,
    })
  })

  it('geotech axis: framed on the litho model with the packing-class map — as the toolbar built it', () => {
    const c = ctx()
    const args = sectionExportPartitionArgs(c, SECTION, 'geotechnical', 'section-export-dsheetpiling')
    expect(args).toEqual({
      projectId: 'proj-1',
      modelId: 'geotech-1',
      section: SECTION,
      investigations: c.investigations,
      layers: c.geotechLayers,
      viewState: c.viewState,
      logLabel: 'section-export-dsheetpiling',
      frameModelId: 'litho-1',
      frameLayers: c.lithoLayers,
      packingClassOf: PACKING,
    })
  })

  it('geological axis: the geological model, no frame', () => {
    const c = ctx()
    const args = sectionExportPartitionArgs(c, SECTION, 'geological', 'section-export-dxf')
    expect(args?.modelId).toBe('geo-1')
    expect(args?.frameModelId).toBeNull()
    expect(args?.layers).toBe(c.lithoLayers)
  })
})

describe('a card with nothing to export', () => {
  it('refuses (null) when the axis has no active model', () => {
    const c = ctx()
    c.activeGeotechModel = null
    expect(sectionExportPartitionArgs(c, SECTION, 'geotechnical', 'x')).toBeNull()
  })

  it('refuses (null) when no section is chosen', () => {
    const c = ctx()
    expect(sectionExportPartitionArgs(c, null, 'lithostratigraphic', 'x')).toBeNull()
  })
})

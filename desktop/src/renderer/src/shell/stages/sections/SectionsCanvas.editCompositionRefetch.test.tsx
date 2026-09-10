// Owner 2026-09-10, packaged #27 on test.strix: "why are these seams still
// here, i thought we fixed that issue" — a re-composed ZAND under a silt lens
// drew its whole ring as a black litho outline on the geotech axis.
//
// The outline pass dissolves an edge only when the SOIL on both sides is known
// and equal; a layer whose formation id the renderer's formation list does not
// carry resolves to no soil and is stroked all round. "Edit composition" can
// CREATE a new composition unit (find-or-create on soil + admixtures), and its
// save refetched the litho layers but never the formations — so the repointed
// layer pointed at a unit the litho frame had never heard of until the next
// project open. The save must refetch the formations too.
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { LithoLayerResponse } from '../../../api/client'
import { makeLithoModel, makeStubContext } from './__fixtures__/shellStub'

vi.mock('../../../components/SectionPanel', () => ({
  default: (props: { onEditLithoComposition?: (layerId: string) => void }) => (
    <button data-testid="edit-composition-stub" onClick={() => props.onEditLithoComposition?.('layer-1')} />
  ),
}))
vi.mock('../../../components/MapView', () => ({ default: () => null }))
vi.mock('../../../components/interpretation/LithoGhostCompositionEditor', () => ({
  default: (props: { onSave: (mainSoilCode: string, admixtures: unknown[]) => void }) => (
    <button data-testid="composition-save-stub" onClick={() => props.onSave('ZAND', [])} />
  ),
}))

const mockEditLayerComposition = vi.fn().mockResolvedValue({})
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    setBaseUrl: vi.fn(),
    api: {
      geology: {
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
        createContactCorrelation: vi.fn().mockResolvedValue(undefined),
        deleteContactCorrelation: vi.fn().mockResolvedValue(undefined),
        listContactCorrelations: vi.fn().mockResolvedValue([]),
        listGeotechPackingCorrelations: vi.fn().mockResolvedValue([]),
        editLayerComposition: (...args: unknown[]) => mockEditLayerComposition(...args),
      },
      virtueleBoring: { getModels: vi.fn().mockResolvedValue([]) },
      section: { list: vi.fn().mockResolvedValue([]), get: vi.fn() },
    },
  }
})

import SectionsCanvas from './SectionsCanvas'

afterEach(cleanup)

const layer: LithoLayerResponse = {
  id: 'layer-1',
  model_id: 'litho-model-1',
  formation_id: 'litho-fm-sand',
  borehole_id: 'bh-1',
  cpt_id: null,
  depth_top_m: 9.07,
  depth_base_m: 10.7,
  status: 'accepted' as LithoLayerResponse['status'],
  source: 'manual' as LithoLayerResponse['source'],
  confidence: 'high' as LithoLayerResponse['confidence'],
  observation_id: null,
  observation_layer_id: null,
  parent_geo_contact_id: null,
  body_id: null,
  notes: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

describe('Edit composition — the section must know the unit it just re-composed a layer into', () => {
  it('refetches the formation list after the composition PATCH, so a newly created unit resolves its soil', async () => {
    const ctx = makeStubContext({ lithoModel: makeLithoModel(), sectionModelAxis: 'lithostratigraphic' })
    ctx.geoModel.lithoLayers = [layer]
    const refetchFormations = vi.fn().mockResolvedValue(undefined)
    ctx.geoModel.refetchFormations = refetchFormations
    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )
    fireEvent.click(screen.getByTestId('edit-composition-stub'))
    fireEvent.click(await screen.findByTestId('composition-save-stub'))
    await waitFor(() => expect(mockEditLayerComposition).toHaveBeenCalledTimes(1))
    expect(mockEditLayerComposition.mock.calls[0][2]).toBe('layer-1')
    await waitFor(() => expect(refetchFormations).toHaveBeenCalled())
  })
})

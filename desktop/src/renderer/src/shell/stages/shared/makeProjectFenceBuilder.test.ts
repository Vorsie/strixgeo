// The fence builder refuses (returns null) when there is nothing to build, so
// the Export hub's fence card can't post an empty request. The happy path (real
// panels from real edges) is covered end-to-end by the fence DXF export tests +
// buildProjectFence's own suite; here we pin only the early-refusal contract,
// which needs no network.

import { describe, it, expect, vi } from 'vitest'

import { buildProjectFencePanels } from './makeProjectFenceBuilder'
import type { SectionLike } from '../../../utils/assembleLithoSectionInputs'

// If the builder reached the edge fetch we'd know — it would throw on the real
// api client under jsdom. These cases must return BEFORE any fetch.
vi.mock('./fetchApprovedEdgesBySection', () => ({
  fetchApprovedEdgesBySection: vi.fn(() => {
    throw new Error('fetch must not be reached on the refuse paths')
  }),
}))

const SECTION = { id: 's1', start_x: 0, start_y: 0, end_x: 10, end_y: 0 } as unknown as SectionLike

describe('buildProjectFencePanels — refuse before any fetch', () => {
  it('returns null when there is no project', async () => {
    const panels = await buildProjectFencePanels({
      projectId: null,
      modelId: 'm1',
      visibleSections: [SECTION],
      investigations: [],
      layers: [],
      logLabel: 'litho-fence',
    })
    expect(panels).toBeNull()
  })

  it('returns null when there is no model', async () => {
    const panels = await buildProjectFencePanels({
      projectId: 'p1',
      modelId: null,
      visibleSections: [SECTION],
      investigations: [],
      layers: [],
      logLabel: 'litho-fence',
    })
    expect(panels).toBeNull()
  })

  it('returns null when there are no sections', async () => {
    const panels = await buildProjectFencePanels({
      projectId: 'p1',
      modelId: 'm1',
      visibleSections: [],
      investigations: [],
      layers: [],
      logLabel: 'litho-fence',
    })
    expect(panels).toBeNull()
  })
})

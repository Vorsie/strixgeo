import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_VIRTUELE_BORING_OVERLAY,
  VIRTUELE_BORING_MAX_DEPTH_MAX_M,
  activeOverlayModels,
  readPaneVisibility,
  readVirtueleBoringOverlay,
  writePaneVisibility,
} from './virtueleBoringOverlay'

describe('readVirtueleBoringOverlay', () => {
  it('returns defaults for null / undefined view_state', () => {
    expect(readVirtueleBoringOverlay(null)).toEqual(DEFAULT_VIRTUELE_BORING_OVERLAY)
    expect(readVirtueleBoringOverlay(undefined)).toEqual(DEFAULT_VIRTUELE_BORING_OVERLAY)
  })

  it('returns defaults when the key is absent', () => {
    expect(readVirtueleBoringOverlay({})).toEqual(DEFAULT_VIRTUELE_BORING_OVERLAY)
  })

  it('reads valid model codes + maxDepthM from view_state', () => {
    const state = readVirtueleBoringOverlay({
      virtuele_boring: { modelA: 'g3dv3_F', modelB: 'hcovv2_H', maxDepthM: 50 },
    })
    expect(state.modelA).toBe('g3dv3_F')
    expect(state.modelB).toBe('hcovv2_H')
    expect(state.maxDepthM).toBe(50)
  })

  it('preserves explicit null maxDepthM (no clip)', () => {
    const state = readVirtueleBoringOverlay({
      virtuele_boring: { modelA: null, modelB: null, maxDepthM: null },
    })
    expect(state.maxDepthM).toBeNull()
  })

  it('falls back to default depth when value is out-of-range or non-numeric', () => {
    expect(
      readVirtueleBoringOverlay({ virtuele_boring: { maxDepthM: 0 } }).maxDepthM,
    ).toBe(DEFAULT_VIRTUELE_BORING_OVERLAY.maxDepthM)
    expect(
      readVirtueleBoringOverlay({
        virtuele_boring: { maxDepthM: VIRTUELE_BORING_MAX_DEPTH_MAX_M + 1 },
      }).maxDepthM,
    ).toBe(DEFAULT_VIRTUELE_BORING_OVERLAY.maxDepthM)
    expect(
      readVirtueleBoringOverlay({ virtuele_boring: { maxDepthM: 'thirty' } }).maxDepthM,
    ).toBe(DEFAULT_VIRTUELE_BORING_OVERLAY.maxDepthM)
  })

  it('collapses non-string slot values to null', () => {
    const state = readVirtueleBoringOverlay({
      virtuele_boring: { modelA: 42, modelB: '' },
    })
    expect(state.modelA).toBeNull()
    expect(state.modelB).toBeNull()
  })

  it('tolerates a non-object stored value without throwing', () => {
    expect(readVirtueleBoringOverlay({ virtuele_boring: 'whoops' })).toEqual(
      DEFAULT_VIRTUELE_BORING_OVERLAY,
    )
  })
})

describe('activeOverlayModels', () => {
  it('returns [] when both slots are off', () => {
    expect(
      activeOverlayModels({ modelA: null, modelB: null, maxDepthM: 30 }),
    ).toEqual([])
  })

  it('returns one entry when only one slot is active', () => {
    expect(
      activeOverlayModels({ modelA: 'g3dv3_F', modelB: null, maxDepthM: 30 }),
    ).toEqual(['g3dv3_F'])
  })

  it('returns both, A first, when distinct', () => {
    expect(
      activeOverlayModels({
        modelA: 'g3dv3_F',
        modelB: 'hcovv2_H',
        maxDepthM: 30,
      }),
    ).toEqual(['g3dv3_F', 'hcovv2_H'])
  })

  it('deduplicates when both slots reference the same model', () => {
    expect(
      activeOverlayModels({
        modelA: 'g3dv3_F',
        modelB: 'g3dv3_F',
        maxDepthM: 30,
      }),
    ).toEqual(['g3dv3_F'])
  })
})

describe('per-pane visibility (localStorage)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    window.localStorage.clear()
  })

  it('section view defaults to visible; detail panes default to hidden', () => {
    expect(readPaneVisibility('proj-1', 'section')).toBe(true)
    expect(readPaneVisibility('proj-1', 'cpt')).toBe(false)
    expect(readPaneVisibility('proj-1', 'borehole')).toBe(false)
  })

  it('round-trips per-pane visibility through localStorage', () => {
    writePaneVisibility('proj-1', 'cpt', true)
    writePaneVisibility('proj-1', 'borehole', true)
    writePaneVisibility('proj-1', 'section', false)
    expect(readPaneVisibility('proj-1', 'cpt')).toBe(true)
    expect(readPaneVisibility('proj-1', 'borehole')).toBe(true)
    expect(readPaneVisibility('proj-1', 'section')).toBe(false)
  })

  it('falls back to defaults when project id is null', () => {
    writePaneVisibility('proj-1', 'cpt', true)
    expect(readPaneVisibility(null, 'cpt')).toBe(false)
  })

  it('keys per project so two projects can disagree', () => {
    writePaneVisibility('proj-A', 'cpt', true)
    writePaneVisibility('proj-B', 'cpt', false)
    expect(readPaneVisibility('proj-A', 'cpt')).toBe(true)
    expect(readPaneVisibility('proj-B', 'cpt')).toBe(false)
  })
})

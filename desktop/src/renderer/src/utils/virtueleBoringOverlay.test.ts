import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VIRTUELE_BORING_OVERLAY,
  activeOverlayModels,
  readVirtueleBoringOverlay,
} from './virtueleBoringOverlay'

describe('readVirtueleBoringOverlay', () => {
  it('returns defaults for null / undefined view_state', () => {
    expect(readVirtueleBoringOverlay(null)).toEqual(DEFAULT_VIRTUELE_BORING_OVERLAY)
    expect(readVirtueleBoringOverlay(undefined)).toEqual(DEFAULT_VIRTUELE_BORING_OVERLAY)
  })

  it('returns defaults when the key is absent', () => {
    expect(readVirtueleBoringOverlay({})).toEqual(DEFAULT_VIRTUELE_BORING_OVERLAY)
  })

  it('reads valid model codes from both slots', () => {
    const state = readVirtueleBoringOverlay({
      virtuele_boring: { modelA: 'g3dv3_F', modelB: 'hcovv2_H' },
    })
    expect(state.modelA).toBe('g3dv3_F')
    expect(state.modelB).toBe('hcovv2_H')
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
    expect(activeOverlayModels({ modelA: null, modelB: null })).toEqual([])
  })

  it('returns one entry when only one slot is active', () => {
    expect(activeOverlayModels({ modelA: 'g3dv3_F', modelB: null })).toEqual(['g3dv3_F'])
    expect(activeOverlayModels({ modelA: null, modelB: 'hcovv2_H' })).toEqual(['hcovv2_H'])
  })

  it('returns both, A first, when distinct', () => {
    expect(
      activeOverlayModels({ modelA: 'g3dv3_F', modelB: 'hcovv2_H' }),
    ).toEqual(['g3dv3_F', 'hcovv2_H'])
  })

  it('deduplicates when both slots reference the same model', () => {
    expect(
      activeOverlayModels({ modelA: 'g3dv3_F', modelB: 'g3dv3_F' }),
    ).toEqual(['g3dv3_F'])
  })
})

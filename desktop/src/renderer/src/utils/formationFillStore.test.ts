import { describe, expect, it } from 'vitest'

import { getFormationFillVisible, toggleFormationFill } from './formationFillStore'

describe('formationFillStore', () => {
  it('defaults to visible and flips on toggle', () => {
    // Default-shown so existing behaviour is unchanged on load.
    expect(getFormationFillVisible()).toBe(true)
    toggleFormationFill()
    expect(getFormationFillVisible()).toBe(false)
    toggleFormationFill()
    expect(getFormationFillVisible()).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'

import { getGeotechFillVisible, toggleGeotechFill } from './geotechFillStore'

describe('geotechFillStore', () => {
  it('defaults to visible (NAD bands shown) and flips on toggle', () => {
    // Default-on: the NAD bands are the geotech deliverable, so the view loads
    // filled; the engineer toggles it off to inspect the correlation ribbons.
    expect(getGeotechFillVisible()).toBe(true)
    toggleGeotechFill()
    expect(getGeotechFillVisible()).toBe(false)
    toggleGeotechFill()
    expect(getGeotechFillVisible()).toBe(true)
  })
})

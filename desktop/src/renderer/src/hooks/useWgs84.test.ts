import { describe, expect, it } from 'vitest'

import { projectedToWgs84, wgs84ToProjected } from './useWgs84'

// Verified Belgian site coordinates: city centre of Antwerp is
// approximately at WGS84 (51.2194°N, 4.4025°E) and Lambert 72
// (153477, 213089). Verified Netherlands site: Amsterdam city centre
// at WGS84 (52.3676°N, 4.9041°E), RD New (121687, 487412).

describe('projectedToWgs84 + wgs84ToProjected — round-trips', () => {
  it('Belgium Lambert 72 (EPSG:31370) round-trips within 0.5 m', () => {
    const x = 150000
    const y = 200000
    const [lat, lng] = projectedToWgs84(x, y, 31370)
    const [bx, by] = wgs84ToProjected(lat, lng, 31370)
    expect(Math.abs(bx - x)).toBeLessThan(0.5)
    expect(Math.abs(by - y)).toBeLessThan(0.5)
  })

  it('Netherlands RD New (EPSG:28992) round-trips within 0.5 m', () => {
    const x = 155000
    const y = 463000
    const [lat, lng] = projectedToWgs84(x, y, 28992)
    const [bx, by] = wgs84ToProjected(lat, lng, 28992)
    expect(Math.abs(bx - x)).toBeLessThan(0.5)
    expect(Math.abs(by - y)).toBeLessThan(0.5)
  })

  it('Brussels area lands at the expected WGS84 coordinates', () => {
    // 150000, 200000 in Lambert 72 is near Brussels — lat ~50.85°,
    // lng ~4.36°. Pinning the rough output catches a regression
    // where someone swaps the EPSG defs.
    const [lat, lng] = projectedToWgs84(150000, 200000, 31370)
    expect(lat).toBeGreaterThan(50.5)
    expect(lat).toBeLessThan(51.5)
    expect(lng).toBeGreaterThan(4.0)
    expect(lng).toBeLessThan(5.0)
  })

  it('Amsterdam area lands at the expected WGS84 coordinates', () => {
    // 121687, 487412 RD New is Amsterdam city centre — lat ~52.37°,
    // lng ~4.90°.
    const [lat, lng] = projectedToWgs84(121687, 487412, 28992)
    expect(lat).toBeGreaterThan(52.0)
    expect(lat).toBeLessThan(53.0)
    expect(lng).toBeGreaterThan(4.5)
    expect(lng).toBeLessThan(5.5)
  })
})

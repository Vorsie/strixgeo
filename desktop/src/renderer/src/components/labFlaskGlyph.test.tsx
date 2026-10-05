// Owner finding 2026-10-05: "flask is on the marker on the map but it is a
// triangle vs a flask in the legend". At marker size the old ~7 px glyph lost
// its neck, so only the conical body showed. These pins say what the eye must
// see on the map marker, on the borelog sample marker and in the legend: a
// neck you can see, a rim line across its top, and ONE drawing for all three.
import { describe, expect, it } from 'vitest'

import {
  LAB_FLASK_HALO,
  LAB_FLASK_HALO_WIDTH,
  LAB_FLASK_MARKER_HEIGHT_PX,
  LAB_FLASK_STROKE,
  LAB_FLASK_STROKE_WIDTH,
  boreholeMarkerSvg,
  labFlaskPathD,
} from './mapMarkerStyle'
import { measureLabFlask } from '../test/labFlaskGeometry'

/** The flask path ``d`` the map marker draws. */
function markerFlaskD(selected: boolean, ringed: boolean): string {
  const svg = boreholeMarkerSvg({ fill: '#888', selected, ringed, hasLabTests: true })
  const m = svg.html.match(/data-glyph="lab-flask" d="([^"]+)"/)
  if (!m) throw new Error(`no flask in ${svg.html}`)
  return m[1]
}

describe('lab-test flask: reads as a flask at marker size', () => {
  it('the map marker flask has a neck you can see (at least 2 px inside the outline)', () => {
    const g = measureLabFlask(markerFlaskD(false, false))
    expect(g.neckWidth - LAB_FLASK_STROKE_WIDTH).toBeGreaterThanOrEqual(2)
    expect(g.neckHeight).toBeGreaterThanOrEqual(3)
  })

  it('the map marker flask carries a rim line across the top of the neck', () => {
    const g = measureLabFlask(markerFlaskD(false, false))
    expect(g.rimWidth).toBeGreaterThan(g.neckWidth)
  })

  it('the map marker flask is 10 to 11 px tall, not a 7 px triangle', () => {
    const g = measureLabFlask(markerFlaskD(false, false))
    expect(g.height).toBeGreaterThanOrEqual(10)
    expect(g.height).toBeLessThanOrEqual(11)
  })

  it('the badge stays clear of the square and the selection ring, inside the icon', () => {
    for (const selected of [false, true]) {
      for (const ringed of [false, true]) {
        const svg = boreholeMarkerSvg({ fill: '#888', selected, ringed, hasLabTests: true })
        const g = measureLabFlask(markerFlaskD(selected, ringed))
        // The light halo is the widest stroke: it sets the badge's outer edge.
        const half = LAB_FLASK_HALO_WIDTH / 2
        // The square (and the ring around it) ends at the box's right edge.
        const plain = boreholeMarkerSvg({ fill: '#888', selected, ringed, hasLabTests: false })
        expect(g.box.left - half).toBeGreaterThanOrEqual(plain.width)
        // Nothing clips: the outline plus its halo fits the icon.
        expect(g.box.top - half).toBeGreaterThanOrEqual(0)
        expect(g.box.right + half).toBeLessThanOrEqual(svg.width)
        expect(g.box.bottom + half).toBeLessThanOrEqual(svg.height)
      }
    }
  })
})

describe('lab-test flask: reads as a flask on dark ground too', () => {
  // Coordinator 2026-10-05: on the dark basemap the dark outline and rim
  // vanished and the white glyph read as a triangle again. A light halo under
  // the dark outline keeps the neck and the rim line visible on any ground.
  it('the map marker draws a light halo under the dark outline, same path, wider stroke', () => {
    const svg = boreholeMarkerSvg({ fill: '#888', selected: false, ringed: false, hasLabTests: true })
    const halo = svg.html.match(/<path data-glyph="lab-flask-halo" d="([^"]+)"[^>]*stroke="([^"]+)" stroke-width="([^"]+)"/)
    expect(halo).not.toBeNull()
    expect(halo![1]).toBe(markerFlaskD(false, false))
    expect(halo![2]).toBe(LAB_FLASK_HALO)
    expect(Number(halo![3])).toBeGreaterThan(LAB_FLASK_STROKE_WIDTH + 1)
    // Drawn first, so the dark outline sits on top of it.
    expect(svg.html.indexOf('lab-flask-halo')).toBeLessThan(svg.html.indexOf('data-glyph="lab-flask"'))
  })

  it('halo and outline contrast: a light halo around a dark line', () => {
    const lum = (hex: string): number => {
      const n = parseInt(hex.slice(1), 16)
      return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
    }
    expect(lum(LAB_FLASK_HALO)).toBeGreaterThan(0.8)
    expect(lum(LAB_FLASK_STROKE)).toBeLessThan(0.25)
  })
})

describe('lab-test flask: one drawing at every size', () => {
  it('the path scales: the same glyph at marker size is the marker flask shifted', () => {
    const atMarker = measureLabFlask(labFlaskPathD(0, 0, LAB_FLASK_MARKER_HEIGHT_PX))
    const onMap = measureLabFlask(markerFlaskD(false, false))
    expect(onMap.neckWidth).toBeCloseTo(atMarker.neckWidth, 6)
    expect(onMap.height).toBeCloseTo(atMarker.height, 6)
  })
})

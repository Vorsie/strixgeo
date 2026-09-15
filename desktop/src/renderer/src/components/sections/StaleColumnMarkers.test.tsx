/**
 * #266 — the drawing itself has to say which packing is out of date.
 *
 * From the debt entry: "the UI keeps rendering the old bands as though they
 * were current". A count in the toolbar is not enough; the engineer works on
 * the section, and the column he is about to correlate is where the warning has
 * to be.
 */
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import StaleColumnMarkers from './StaleColumnMarkers'
import type { PlacedColumn } from './utils'

function column(id: string, name: string, nudgedX: number, trueX = nudgedX): PlacedColumn {
  return {
    kind: 'cpt',
    trueX,
    nudgedX,
    width: 18,
    displaced: trueX !== nudgedX,
    proj: {
      item: { id, name } as never,
      along: trueX,
      offset: 0,
    } as never,
  }
}

function draw(columns: PlacedColumn[], stale: string[]): ReturnType<typeof render> {
  return render(
    <svg>
      <StaleColumnMarkers columns={columns} staleColumnIds={new Set(stale)} plotTop={40} />
    </svg>,
  )
}

describe('StaleColumnMarkers', () => {
  it('SCM1 marks the column whose lithology was edited after its bands were made', () => {
    const { queryByTestId } = draw(
      [column('inv-s17', 'GEO-23/125-S17', 100), column('inv-s9', 'GEO-23/125-S9', 200)],
      ['inv-s17'],
    )

    expect(queryByTestId('geotech-stale-column-inv-s17')).not.toBeNull()
    // The untouched column stays unmarked — an indicator on every column is
    // one the engineer learns to look past.
    expect(queryByTestId('geotech-stale-column-inv-s9')).toBeNull()
  })

  it('SCM2 draws nothing at all when every column matches its lithology', () => {
    const { queryByTestId } = draw([column('inv-s17', 'GEO-23/125-S17', 100)], [])

    expect(queryByTestId('geotech-stale-column-markers')).toBeNull()
  })

  it('SCM3 sits on the column where it is DRAWN, not where the test is', () => {
    // Crowded projections are nudged sideways by the spacing pass. Anchoring on
    // the raw along-section position would float the mark off its column
    // exactly on the busy sections where it matters most.
    const { getByTestId } = draw([column('inv-s17', 'GEO-23/125-S17', 260, 100)], ['inv-s17'])

    expect(getByTestId('geotech-stale-column-inv-s17').getAttribute('transform')).toBe(
      'translate(260, 50)',
    )
  })

  it('SCM4 says it in words, so it is not carried by colour alone', () => {
    // WCAG 2.2 1.4.1: a monochrome print and a colour-vision deficiency both
    // have to read this. The glyph and the hover text carry the meaning.
    const { getByTestId } = draw([column('inv-s17', 'GEO-23/125-S17', 100)], ['inv-s17'])
    const mark = getByTestId('geotech-stale-column-inv-s17')

    expect(mark.querySelector('title')?.textContent).toContain('GEO-23/125-S17')
    expect(mark.querySelector('title')?.textContent).toContain('older lithology')
    expect(mark.textContent).toContain('!')
  })

  it('SCM7 the tooltip tells the engineer WHAT IT MEANS and WHAT TO DO', () => {
    // Owner installer #40: "this doesn't point the user to how to solve it." The
    // marker must name the fix — pressing Subdivide (Onderverdelen) re-derives
    // the packing from the current lithology.
    const { getByTestId } = draw([column('inv-s17', 'GEO-23/125-S17', 100)], ['inv-s17'])
    const title = getByTestId('geotech-stale-column-inv-s17').querySelector('title')?.textContent
    expect(title).toContain('older lithology')
    expect(title).toContain('Subdivide')
  })

  it('SCM8 clicking the marker selects (focuses) the column', () => {
    // "clicking the marker selects the column" — the click focuses that column
    // so the engineer can act on it (and the inspector line offers Subdivide).
    const onSelectColumn = vi.fn()
    const { getByTestId } = render(
      <svg>
        <StaleColumnMarkers
          columns={[column('inv-s17', 'GEO-23/125-S17', 100)]}
          staleColumnIds={new Set(['inv-s17'])}
          plotTop={40}
          onSelectColumn={onSelectColumn}
        />
      </svg>,
    )
    fireEvent.click(getByTestId('geotech-stale-column-inv-s17'))
    expect(onSelectColumn).toHaveBeenCalledWith({
      kind: 'cpt',
      id: 'inv-s17',
      name: 'GEO-23/125-S17',
    })
  })

  it('SCM5 is amber, never red — the bands are out of date, not wrong', () => {
    // Project rule: amber for dirty / stale state. Red would read as "this
    // model is broken", and the bands are the honest output of an earlier
    // lithology.
    const { getByTestId } = draw([column('inv-s17', 'GEO-23/125-S17', 100)], ['inv-s17'])
    const disc = getByTestId('geotech-stale-column-inv-s17').querySelector('circle')

    expect(disc?.getAttribute('fill')).toContain('--color-status-amber')
    expect(disc?.getAttribute('fill')).not.toMatch(/red|#(e|f)[0-9a-f]?[0-2]{2}/i)
  })

  it('SCM6 never swallows a gesture on the column it is warning about', () => {
    // It sits over a column the engineer drags bands on. A badge that ate the
    // drag would obstruct the very fix it is asking for.
    const { getByTestId } = draw([column('inv-s17', 'GEO-23/125-S17', 100)], ['inv-s17'])

    expect(getByTestId('geotech-stale-column-markers').getAttribute('pointer-events')).toBe(
      'none',
    )
  })
})

import type { ReactElement } from 'react'

import type { SampleResponse } from '../../../api/client'
import { LAB_TEST_ICONS } from '../labTestIcons'
import { usePxPerM } from '../utils'
import { useT } from '../../../i18n/translate'

/**
 * Clickable samples column. Each sample is rendered as either a
 * vertical bracket (interval samples) or a circular spot marker
 * (point samples where ``depth_top == depth_base``), with the sample
 * number on the left of the bracket and the lab-test family glyphs
 * to its right.
 *
 * Selected samples get a soft blue highlight rectangle behind the
 * marker; clicking a selected sample toggles back to ``null``.
 *
 * Even sample rows with no lab tests are clickable — the detail panel
 * still surfaces sampling metadata (depth range, sample number,
 * sampling method).
 */
export function SamplesTrack({
  samples,
  x,
  y,
  width,
  selectedSampleId,
  onSampleClick,
}: {
  samples: SampleResponse[]
  x: number
  y: number
  width: number
  selectedSampleId: string | null
  onSampleClick: (id: string | null) => void
}): ReactElement {
  const t = useT()
  const PX_PER_M = usePxPerM()
  return (
    <g>
      {samples.map(sample => {
        const top = y + sample.depth_top_m * PX_PER_M
        const bottom = y + sample.depth_base_m * PX_PER_M
        const mid = (top + bottom) / 2
        const isSpot = sample.depth_top_m === sample.depth_base_m
        const selected = sample.id === selectedSampleId

        const tests = LAB_TEST_ICONS.filter(icon => icon.hasOn(sample))
        const hasAnyTest = tests.length > 0

        // Multi-line SVG tooltip: sample number / depth range / lab-test count.
        // The depth line is unit-only (no words), so it stays verbatim.
        const numberLabel = sample.sample_number ?? t('lab.unnumbered')
        const depthLine = `${sample.depth_top_m.toFixed(2)} – ${sample.depth_base_m.toFixed(2)} m`
        const testLine = t(
          tests.length === 1 ? 'borelog.labTestCountOne' : 'borelog.labTestCountMany',
          { n: tests.length },
        )
        const tooltip = `${numberLabel}\n${depthLine}\n${testLine}`

        return (
          <g
            key={sample.id}
            style={{ cursor: 'pointer' }}
            onClick={() => onSampleClick(selected ? null : sample.id)}
          >
            <title>{tooltip}</title>

            {selected && (
              <rect
                x={x + 1}
                y={top - 2}
                width={width - 2}
                height={Math.max(bottom - top, 12) + 4}
                // CSS var: light = blue-100 (#dbeafe), dark = blue-900/40.
                fill="var(--borelog-sample-selected-bg)"
                stroke="var(--borelog-sample-selected-border)"
                strokeWidth={1}
                rx={2}
              />
            )}

            {!isSpot ? (
              <rect
                x={x + 8}
                y={top}
                width={4}
                height={bottom - top}
                fill="var(--borelog-text-primary)"
                rx={1}
              />
            ) : (
              <circle cx={x + 10} cy={mid} r={4} fill="var(--borelog-text-primary)" />
            )}

            <text x={x + 18} y={mid + 3} fontSize={10} fill="var(--borelog-badge-text)">
              {sample.sample_number ?? '#?'}
            </text>
            {hasAnyTest && (
              <text x={x + 50} y={mid + 4} fontSize={11} fill="var(--borelog-badge-text)">
                {tests.map(t => t.symbol).join(' ')}
              </text>
            )}
            {!hasAnyTest && (
              <text x={x + 50} y={mid + 3} fontSize={9} fill="var(--borelog-text-muted)" fontStyle="italic">
                {t('borelog.noTests')}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
}

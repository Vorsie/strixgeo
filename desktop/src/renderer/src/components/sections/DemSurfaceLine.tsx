/**
 * DEM ground-surface polyline for the cross-section canvas.
 *
 * Renders the elevation profile fetched from /dem/sample as a single
 * SVG path. NoData samples (null elevation_m) break the line into
 * sub-paths — engineers expect a gap rather than a straight bridge
 * across missing data.
 *
 * Visual: thin earth-brown stroke at 60% opacity. Reads as terrain
 * context without competing with the investigation columns for
 * primary attention.
 */

import { useMemo } from 'react'

import type { DemSamplePoint } from '../../api/client'
import { useT } from '../../i18n/translate'

const DEM_STROKE = '#92400e' // amber-800 — earthy brown
const DEM_STROKE_WIDTH = 1.5

export default function DemSurfaceLine({
  samples,
  xToScreen,
  levelToScreen,
  plotTop,
  plotBottom,
  plotLeft,
  plotRight,
}: {
  samples: DemSamplePoint[]
  xToScreen: (x: number) => number
  levelToScreen: (level: number) => number
  plotTop: number
  plotBottom: number
  plotLeft: number
  plotRight: number
}): JSX.Element {
  // Walk the samples, accumulating SVG path "d" commands. ``M``
  // opens a new sub-path each time we cross a NoData gap or re-enter
  // the plot area from outside, so the renderer never draws a
  // straight line across missing data.
  const path = useMemo(() => {
    let d = ''
    let penDown = false
    for (const s of samples) {
      if (s.elevation_m === null) {
        penDown = false
        continue
      }
      const x = xToScreen(s.along_m)
      const y = levelToScreen(s.elevation_m)
      // Clip to the plot rect — points outside are skipped (the
      // surface line is part of the canvas; it shouldn't bleed into
      // the axis margins). We clamp the pen state on re-entry so a
      // single sample inside the rect doesn't draw a 1-point M move
      // and nothing else.
      if (
        x < plotLeft ||
        x > plotRight ||
        y < plotTop ||
        y > plotBottom
      ) {
        penDown = false
        continue
      }
      if (!penDown) {
        d += `M ${x.toFixed(2)} ${y.toFixed(2)} `
        penDown = true
      } else {
        d += `L ${x.toFixed(2)} ${y.toFixed(2)} `
      }
    }
    return d.trim()
  }, [samples, xToScreen, levelToScreen, plotTop, plotBottom, plotLeft, plotRight])

  const t = useT()

  if (path === '') return <></>

  return (
    <path
      d={path}
      stroke={DEM_STROKE}
      strokeWidth={DEM_STROKE_WIDTH}
      strokeOpacity={0.6}
      fill="none"
    >
      <title>{t('sections.dem.groundSurface')}</title>
    </path>
  )
}

// ReviewFlagLayer — the litho review-flag surface (owner ruling 2026-07-26; design
// partition-engine-v2.md §10).
//
// The safe-default repair re-emits the onlap for an uncorrelated same-litho neighbour that would
// otherwise render a foreign litho. The data is preserved by the engine; this overlay INVITES an
// optional correlation. Per the UX call: advisory NOT error (never a modal / build-blocker), AMBER
// low-emphasis, LITHO axis only, click → a small popover offering "Correlate" (draw the edge → they
// band next build) / "Keep separate" (dismiss, persisted in the .gmproj bundle so it does not renag).
//
// Presentational + self-contained: the parent computes each marker's screen position + its facing
// neighbour and passes them in; this component owns only the popover open-state. Pure SVG (no
// foreignObject) to match the other section overlays.

import { useState } from 'react'

import { useT } from '../../i18n/translate'

/** One positioned review flag: the flooded unit + where to draw its marker + its correlate target. */
export interface ReviewFlagMarker {
  /** Stable id (reviewFlagId) — the dismissal key + the popover open-state key. */
  id: string
  /** Screen x/y of the drilled unit (its column edge, at the unit's mid-elevation). */
  x: number
  y: number
  /** The flooded unit's litho-layer id (one endpoint of the "Correlate" edge). */
  flagLayerId: string
  /** The facing same-litho neighbour's layer id (the other endpoint), or null when none was found
   *  (then "Correlate" is disabled — the user can still dismiss). */
  facingLayerId: string | null
}

interface Props {
  /** Positioned, not-yet-dismissed markers (litho axis only — the parent gates the axis). */
  markers: readonly ReviewFlagMarker[]
  /** Create the correlation between the flooded unit and its facing same-litho neighbour. */
  onCorrelate: (flagLayerId: string, facingLayerId: string) => void
  /** Dismiss this flag (persisted). */
  onDismiss: (id: string) => void
  /** Drop to 'none' in correlate mode so the gesture beneath receives the click. */
  interactivePtr: 'auto' | 'none'
}

const AMBER = '#f59e0b' // amber-500 — "attention, not error" (not red)
const AMBER_DARK = '#b45309' // amber-700 (stroke / text)
const PANEL_BG = '#fffbeb' // amber-50 popover background
const TEXT = '#1e293b' // slate-800
const MARKER_R = 6
const MARKER_HIT_R = 11

/** Popover geometry (px). Opens down-right of the marker; the parent plot clips nothing here. */
const PW = 148
const PH = 62
const ROW_H = 22

export default function ReviewFlagLayer({ markers, onCorrelate, onDismiss, interactivePtr }: Props): JSX.Element | null {
  const [openId, setOpenId] = useState<string | null>(null)
  const t = useT()
  if (markers.length === 0) return null
  const open = openId != null ? markers.find((m) => m.id === openId) ?? null : null

  return (
    <g data-testid="review-flag-layer" style={{ pointerEvents: interactivePtr }}>
      {markers.map((m) => (
        <g key={m.id}>
          {/* invisible hit halo so a near-miss still opens the popover */}
          <circle cx={m.x} cy={m.y} r={MARKER_HIT_R} fill="transparent" style={{ cursor: 'pointer' }}
            onClick={(e) => { e.stopPropagation(); setOpenId(openId === m.id ? null : m.id) }} />
          <circle cx={m.x} cy={m.y} r={MARKER_R} fill={AMBER} stroke="#ffffff" strokeWidth={1.5} style={{ pointerEvents: 'none' }} />
          <text x={m.x} y={m.y + 3.2} fontSize={9} fontWeight="bold" textAnchor="middle" fill={AMBER_DARK} style={{ pointerEvents: 'none' }}>!</text>
        </g>
      ))}

      {open && (
        <g data-testid="review-flag-popover" transform={`translate(${open.x + 10}, ${open.y + 8})`}>
          <rect x={0} y={0} width={PW} height={PH} rx={6} fill={PANEL_BG} stroke={AMBER} strokeWidth={1} />
          <text x={8} y={15} fontSize={10.5} fontWeight="bold" fill={TEXT}>{t('sections.reviewFlag.uncorrelatedClay')}</text>
          {/* Correlate row (disabled when no facing neighbour was found) */}
          <g
            style={{ cursor: open.facingLayerId ? 'pointer' : 'not-allowed' }}
            onClick={(e) => {
              e.stopPropagation()
              if (open.facingLayerId) { onCorrelate(open.flagLayerId, open.facingLayerId); setOpenId(null) }
            }}
          >
            <rect x={6} y={ROW_H} width={PW - 12} height={16} rx={3} fill={open.facingLayerId ? '#fef3c7' : '#f1f5f9'} />
            <text x={12} y={ROW_H + 12} fontSize={10} fill={open.facingLayerId ? AMBER_DARK : '#94a3b8'}>{t('sections.reviewFlag.correlateOneBand')}</text>
          </g>
          {/* Keep-separate row */}
          <g
            style={{ cursor: 'pointer' }}
            onClick={(e) => { e.stopPropagation(); onDismiss(open.id); setOpenId(null) }}
          >
            <rect x={6} y={ROW_H + 18} width={PW - 12} height={16} rx={3} fill="#ffffff" stroke="#e2e8f0" strokeWidth={0.5} />
            <text x={12} y={ROW_H + 30} fontSize={10} fill={TEXT}>{t('sections.keepSeparate')}</text>
          </g>
        </g>
      )}
    </g>
  )
}

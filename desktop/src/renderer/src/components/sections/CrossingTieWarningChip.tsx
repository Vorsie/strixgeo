/**
 * CrossingTieWarningChip — a small persistent, non-blocking amber warning badge
 * for the section editor (owner §8 Q4: crossing approved correlation ties are a
 * HARD CONFLICT — neither bands, both fall back to pinch/lens, and the user gets a
 * visual warning until the conflict is resolved by deleting one tie).
 *
 * Rendered as SVG (the partition overlay is an SVG ``<g>``) anchored at the top-
 * left of the plot area. It NEVER steals focus, opens no dialog, and does not
 * intercept pointer events — a passive amber chip (docs/ux.md: amber for warnings,
 * dark-mode compatible). Extracted to its own file rather than growing the
 * ``PartitionFillOverlay`` god-component (debt #201).
 */

import { useT } from '../../i18n/translate'

/** Amber-500 — the project warning colour, legible on both light and dark section
 *  backgrounds; kept explicit (not a Tailwind class) because this renders in SVG. */
const AMBER = '#f59e0b'
/** Dark slate text on the amber chip for contrast (WCAG AA on amber-500). */
const CHIP_TEXT = '#1e293b'
const CHIP_H = 20
const CHIP_PAD_X = 8
/** Approximate character width as a fraction of font size (chip sizing estimate). */
const CHAR_W = 6.2
const FONT = 11

/** Props: the number of crossing-tie conflicts + where to anchor the chip. */
export interface Props {
  /** How many crossing-tie conflicts on the current section (> 0 to show). */
  conflictCount: number
  /** Plot-area left edge in screen px. */
  plotLeft: number
  /** Plot-area top edge in screen px. */
  plotTop: number
  /**
   * Centre the next conflict in the viewport (owner ask 2026-08-23: *"make that
   * clickable so it zooms to the first one, and then when it is resolved it
   * takes the second one"*). The caller owns which one is next — see
   * ``tieVisitNav.nextVisitIndex``.
   *
   * OMITTED keeps the original passive chip: ``pointerEvents: 'none'``, no
   * focus, no click steal. Only a caller that can actually pan supplies this,
   * so the chip never advertises an affordance it cannot honour.
   */
  onJump?: () => void
}

/**
 * Render the amber crossing-tie warning chip, or nothing when there are no
 * conflicts.
 *
 * Parameters
 * ----------
 * conflictCount : number
 *     Crossing-tie conflicts on the current section; the chip shows only when > 0.
 * plotLeft, plotTop : number
 *     Plot-area top-left anchor in screen px.
 *
 * Returns
 * -------
 * JSX.Element | null
 *     The SVG chip, or ``null`` when there is nothing to warn about.
 */
export default function CrossingTieWarningChip({
  conflictCount,
  plotLeft,
  plotTop,
  onJump,
}: Props): JSX.Element | null {
  const t = useT()
  if (conflictCount <= 0) return null
  const phrase = t(
    conflictCount === 1 ? 'sections.crossingTie.countOne' : 'sections.crossingTie.countMany',
    { n: conflictCount },
  )
  // The tail differs by mode on purpose. Passive, the only useful instruction is
  // WHAT to do; clickable, the affordance itself has to be discoverable, because
  // nothing about an SVG chip says "press me".
  const label = onJump
    ? t('sections.crossingTie.labelFind', { phrase })
    : t('sections.crossingTie.labelResolve', { phrase })
  const w = Math.ceil(label.length * CHAR_W) + CHIP_PAD_X * 2
  const x = plotLeft + 8
  const y = plotTop + 8
  return (
    <g
      data-testid="crossing-tie-warning"
      // Interactive ONLY when it can act: a chip that swallowed clicks without
      // doing anything would be worse than the passive one it replaces.
      style={{ pointerEvents: onJump ? 'auto' : 'none', cursor: onJump ? 'pointer' : undefined }}
      role={onJump ? 'button' : undefined}
      tabIndex={onJump ? 0 : undefined}
      aria-label={onJump ? t('sections.crossingTie.aria', { phrase }) : undefined}
      onClick={onJump}
      onKeyDown={
        onJump
          ? e => {
              // An SVG <g> gets none of a real button's keyboard behaviour, and
              // the section editor is keyboard-driven (WCAG 2.2 AA).
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onJump()
              }
            }
          : undefined
      }
    >
      <rect
        x={x}
        y={y}
        width={w}
        height={CHIP_H}
        rx={4}
        ry={4}
        fill={AMBER}
        fillOpacity={0.92}
        stroke={CHIP_TEXT}
        strokeOpacity={0.35}
        strokeWidth={0.75}
      />
      <text
        x={x + CHIP_PAD_X}
        y={y + CHIP_H / 2}
        fontSize={FONT}
        fontWeight={600}
        fill={CHIP_TEXT}
        dominantBaseline="central"
      >
        {label}
      </text>
    </g>
  )
}

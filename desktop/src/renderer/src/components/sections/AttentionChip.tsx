/**
 * An amber toolbar chip that is a plain label unless it can act.
 *
 * NAMED BY THE OWNER (2026-08-31): the one place the toolbar says
 * "something here needs your eye". (Renamed from ``PendingTieChip``
 * 2026-08-28, owner ruling). It carries whatever the toolbar needs to say:
 * "N pending here" (pending packing ties), "N tests excluded" (after a Build
 * without them), and the stale-litho column notice — three of its four call
 * sites have nothing to do with ties, and a tie-flavoured name also invited
 * confusion with the genuinely tie-specific {@link CrossingTieWarningChip}
 * next door.
 *
 * Born as the geotech toolbar's "N pending here" chip, which sits OUTSIDE the
 * packing-pipeline menu on purpose: it is the number step 4 is gated on, so it
 * has to be visible without opening anything.
 *
 * Owner dogfeed 2026-08-25: *"now i get a one pending notification but i don't
 * see any pending ties? Why don't we make that clickable so it highlights the
 * tie?"* — so it takes an optional ``onReveal``. With one it is a real
 * ``<button>`` (Enter and Space come free, focus ring comes free, the tab order
 * comes free); without one it stays the plain label it has always been, because
 * a chip that swallowed a click without acting would be worse than the label it
 * replaces. Same passive-unless-it-can-act contract as
 * {@link CrossingTieWarningChip}, which is the shipped precedent.
 *
 * SECOND USE (2026-08-26): the Geotechnical toolbar's "N tests excluded" chip
 * after a "Build without them". Same contract, same visual weight, different
 * words — so the wording and the test id are props and the behaviour is not
 * copied. Every one of those props defaults to the pending-tie chip's original
 * value, so that caller renders byte-identically to before.
 *
 * Extracted from ``SectionsToolbar`` rather than grown inside it — that file is
 * long past the 500-line god-component threshold (debt #201).
 */

/** Shared between both modes so the label reads identically either way. */
const CHIP_CLASS =
  'px-1.5 py-0.5 rounded text-[10px] font-semibold text-status-amber border border-status-amber/40'

/** Props: what the chip says, and whether it can act on it. */
export interface Props {
  /** Chip text, e.g. ``"1 pending here"`` — the count, in words. */
  label: string
  /** Hover / focus tooltip: the model total and where the rest sit. */
  title: string
  /**
   * Centre and highlight the next pending tie on the open section.
   *
   * OMITTED keeps the chip PASSIVE — a plain label, no focus stop, no click
   * steal. Only a caller that can actually reveal a tie supplies this, so the
   * chip never advertises an affordance it cannot honour.
   */
  onReveal?: () => void
  /** ``data-testid``. Defaults to the pending-tie chip's own. */
  testid?: string
  /** Sentence appended to ``title`` while interactive. */
  clickHint?: string
  /** Sentence appended to the ``aria-label`` while interactive. */
  ariaHint?: string
}

/**
 * Render the notice chip, interactive only when it can reveal something.
 *
 * Parameters
 * ----------
 * label : string
 *     Chip text — the count phrased for the open section.
 * title : string
 *     Tooltip. When ``onReveal`` is supplied, the clickable affordance is
 *     appended, because nothing about a small amber pill says "press me".
 * onReveal : () => void, optional
 *     Reveal handler; absent leaves the chip passive.
 * testid : string, optional
 *     ``data-testid``; defaults to the pending-tie chip's own.
 * clickHint : string, optional
 *     Tooltip sentence added while interactive.
 * ariaHint : string, optional
 *     ``aria-label`` sentence added while interactive.
 *
 * Returns
 * -------
 * JSX.Element
 *     A ``<button>`` when it can act, otherwise a ``<span>``.
 */
export default function AttentionChip({
  label,
  title,
  onReveal,
  testid = 'geotech-pending-tie-chip',
  clickHint = 'Click to find the next one on this section.',
  ariaHint = 'Activate to find the next pending packing tie.',
}: Props): JSX.Element {
  if (!onReveal) {
    return (
      <span data-testid={testid} className={CHIP_CLASS} title={title}>
        {label}
      </span>
    )
  }
  return (
    <button
      type="button"
      data-testid={testid}
      // Hover + focus ring in the section stage's own idiom (the same pair
      // SectionsInspector's amber rows use), so the chip reads as pressable
      // without inventing a third focus style for the toolbar.
      className={`${CHIP_CLASS} cursor-pointer hover:bg-status-amber/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-status-amber`}
      title={`${title} ${clickHint}`}
      aria-label={`${label}. ${ariaHint}`}
      onClick={onReveal}
    >
      {label}
    </button>
  )
}

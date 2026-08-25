/**
 * The geotech toolbar's amber "N pending here" chip.
 *
 * It sits OUTSIDE the packing-pipeline menu on purpose: it is the number step 4
 * is gated on, so it has to be visible without opening anything.
 *
 * Owner dogfeed 2026-08-25: *"now i get a one pending notification but i don't
 * see any pending ties? Why don't we make that clickable so it highlights the
 * tie?"* — so it now takes an optional ``onReveal``. With one it is a real
 * ``<button>`` (Enter and Space come free, focus ring comes free, the tab order
 * comes free); without one it stays the plain label it has always been, because
 * a chip that swallowed a click without acting would be worse than the label it
 * replaces. Same passive-unless-it-can-act contract as
 * {@link CrossingTieWarningChip}, which is the shipped precedent.
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
}

/**
 * Render the pending-tie chip, interactive only when it can reveal something.
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
 *
 * Returns
 * -------
 * JSX.Element
 *     A ``<button>`` when it can act, otherwise a ``<span>``.
 */
export default function PendingTieChip({ label, title, onReveal }: Props): JSX.Element {
  if (!onReveal) {
    return (
      <span data-testid="geotech-pending-tie-chip" className={CHIP_CLASS} title={title}>
        {label}
      </span>
    )
  }
  return (
    <button
      type="button"
      data-testid="geotech-pending-tie-chip"
      // Hover + focus ring in the section stage's own idiom (the same pair
      // SectionsInspector's amber rows use), so the chip reads as pressable
      // without inventing a third focus style for the toolbar.
      className={`${CHIP_CLASS} cursor-pointer hover:bg-status-amber/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-status-amber`}
      title={`${title} Click to find the next one on this section.`}
      aria-label={`${label}. Activate to find the next pending packing tie.`}
      onClick={onReveal}
    >
      {label}
    </button>
  )
}

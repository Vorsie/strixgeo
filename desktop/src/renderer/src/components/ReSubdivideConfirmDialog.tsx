// Confirmation dialog shown before re-running "Subdivide all bodies" when a
// geotechnical model already exists (connecting-geotech-units spec §7).
//
// Re-subdividing wipes and regenerates ALL geotech packing connections: the
// auto-derived ones are recreated, but any manual packing connections the user
// made are lost. That is irreversible, so per CLAUDE.md / docs/ux.md
// "Reversible vs irreversible" the gesture must confirm first:
//   1. Cancel (default focus — an accidental Enter must not wipe connections)
//   2. Re-subdivide — the destructive confirm
//
// It costs the engineer TWO different things, and the body names them
// separately because he weighs them differently (owner ruling B, 2026-08-01):
//   * packing CONNECTIONS — auto-derivable again via Auto-correlate;
//   * hand EDITS (bands he split or merged) — not derivable at all, since the
//     rebuild re-runs the segmenter over the CPT data and knows nothing about
//     where he put the boundary. Only mentioned when there are some: a warning
//     that fires at zero trains people to click past the one that matters.
//
// The first-ever subdivide does NOT prompt (no geotech model exists yet → no
// connections to lose); the caller gates this dialog on that condition.
// Thin wrapper over the generic ConfirmDialog (#165): no secondary action,
// just Cancel + the destructive confirm.

import ConfirmDialog from './ui/ConfirmDialog'

interface Props {
  /** Truthy = render the dialog. The caller owns the open lifecycle. */
  open: boolean
  /** Fired when the user clicks Cancel (or Esc). */
  onCancel: () => void
  /** Fired when the user clicks "Re-subdivide". */
  onConfirm: () => void
  /** When true, both buttons are disabled (async action in flight). */
  busy?: boolean
  /**
   * How many hand-edited packing bands the re-run will destroy — see
   * ``countGeotechHandEdits``. Zero (the default) renders no hand-edit
   * sentence at all.
   */
  handEditCount?: number
}

/**
 * Confirmation modal gating a re-run of "Subdivide all bodies".
 *
 * Renders a {@link ConfirmDialog} with a default-focused Cancel and a single
 * destructive "Re-subdivide" confirm; manual packing connections are cleared by
 * the regenerate, and any hand-edited bands are rebuilt from the CPT data —
 * both of which the body makes explicit.
 *
 * @returns The dialog element (or nothing when ``open`` is false).
 */
export default function ReSubdivideConfirmDialog({
  open,
  onCancel,
  onConfirm,
  busy = false,
  handEditCount = 0,
}: Props): JSX.Element {
  const oneHandEdit = handEditCount === 1
  return (
    <ConfirmDialog
      open={open}
      labelledBy="re-subdivide-confirm-title"
      testid="re-subdivide-confirm-dialog"
      cardClassName="w-[28rem]"
      cancelTestid="re-subdivide-cancel"
      onCancel={onCancel}
      busy={busy}
      title="Re-subdivide geotech model?"
      body={
        <>
          <p>
            Re-subdividing regenerates all geotech packing connections &mdash; any manual
            connections you made will be cleared.
          </p>
          {/* The second loss, and the heavier one — a connection can be re-derived by
              Auto-correlate, a hand-placed boundary cannot be re-derived at all. Rendered
              only when there is something to lose (owner ruling B). */}
          {handEditCount > 0 && (
            <p className="mt-2" data-testid="re-subdivide-hand-edits">
              It also rebuilds every packing band from the CPT data: the{' '}
              <span className="font-semibold">
                {handEditCount} hand-edited band{oneHandEdit ? '' : 's'}
              </span>{' '}
              you split or merged {oneHandEdit ? 'goes' : 'go'} back to the
              segmenter&rsquo;s boundaries. That cannot be recovered.
            </p>
          )}
          {/* The dialog used to be a dead end: wiping the model was the only way to get
              the automatic ties back. "Correlate packing → Auto-correlate" now proposes
              them without touching anything, so the alternative belongs at the exact
              moment the engineer is deciding whether to accept the loss. */}
          <p className="mt-2 text-text-secondary">
            To get the automatic ties back <em>without</em> losing your own, cancel and use
            Correlate packing &rarr; Auto-correlate instead.
          </p>
        </>
      }
      confirm={{
        label: 'Re-subdivide',
        onClick: onConfirm,
        variant: 'danger',
        testid: 're-subdivide-confirm',
      }}
    />
  )
}

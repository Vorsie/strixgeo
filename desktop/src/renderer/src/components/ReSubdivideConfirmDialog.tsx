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
}

/**
 * Confirmation modal gating a re-run of "Subdivide all bodies".
 *
 * Renders a {@link ConfirmDialog} with a default-focused Cancel and a single
 * destructive "Re-subdivide" confirm; manual packing connections are cleared by
 * the regenerate, which the body makes explicit.
 *
 * @returns The dialog element (or nothing when ``open`` is false).
 */
export default function ReSubdivideConfirmDialog({
  open,
  onCancel,
  onConfirm,
  busy = false,
}: Props): JSX.Element {
  return (
    <ConfirmDialog
      open={open}
      labelledBy="re-subdivide-confirm-title"
      testid="re-subdivide-confirm-dialog"
      cancelTestid="re-subdivide-cancel"
      onCancel={onCancel}
      busy={busy}
      title="Re-subdivide geotech model?"
      body={
        <p>
          Re-subdividing regenerates all geotech packing connections &mdash; any manual connections
          you made will be cleared.
        </p>
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

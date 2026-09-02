// Litho→geological snap prompt (debt #134 — sliver prevention).
//
// Opens when a litho-contact drag commits within tolerance of one or
// more geological contacts on the same investigation.  The user picks
// the direction of the snap:
//
//   * Snap litho to geological — the litho contact's depth follows the
//     selected geological contact's depth.  Cheap, no cascade.  Default
//     focus (owner directive 2026-05-26 — the safer outcome).
//   * Move geological to litho — the geological contact's depth follows
//     the litho.  Triggers a surface rebuild + a litho-axis re-sync.
//   * Cancel — leave both at their raw drag depths.  Esc fires Cancel.
//
// With two candidates within tolerance the dialog renders a radio
// group; the nearer candidate is default-checked (or the deeper one if
// equidistant — the candidate list arrives pre-sorted by the caller).

import { useEffect, useRef, useState } from 'react'

import type { FormationContactResponse } from '../api/client'
import { useT } from '../i18n/translate'
import Button from './ui/Button'
import Modal from './ui/Modal'

interface Props {
  /** Truthy → render the dialog.  Caller owns the open lifecycle. */
  open: boolean
  /** Geological-contact candidates within tolerance of the litho drag
   *  depth, pre-sorted by ``findGeoSnapCandidates``: nearer first, ties
   *  broken deeper-first (stratigraphic superposition). */
  candidates: readonly FormationContactResponse[]
  /** The raw drag depth the litho contact is about to commit to. */
  lithoDepthM: number
  /** Snap the litho contact's depth to the selected geological contact's
   *  depth.  Lightweight: a single contact PATCH on the litho row. */
  onSnapToGeo: (geoContactId: string) => void
  /** Move the selected geological contact's depth to the litho drag
   *  depth.  Heavy: PATCH the geo contact + cascade rebuild + re-sync. */
  onMoveGeoToLitho: (geoContactId: string) => void
  /** Dismiss without snapping — the litho contact commits at the raw
   *  drag depth.  Fired by Esc, the Cancel button, and a backdrop click. */
  onCancel: () => void
  /** While true, all three action buttons are disabled — the cascade
   *  from a prior selection is still in flight. */
  busy?: boolean
}

export default function LithoGeoSnapDialog({
  open,
  candidates,
  lithoDepthM,
  onSnapToGeo,
  onMoveGeoToLitho,
  onCancel,
  busy = false,
}: Props): JSX.Element | null {
  const t = useT()
  // Selected candidate id — defaults to the first (the caller already
  // sorted nearer-first / deeper-tie-break).  Resets when the dialog
  // re-opens with a different candidate set.
  const [selectedId, setSelectedId] = useState<string | null>(
    candidates.length > 0 ? candidates[0].id : null,
  )
  useEffect(() => {
    if (!open) return
    setSelectedId(candidates.length > 0 ? candidates[0].id : null)
  }, [open, candidates])

  // Default focus on Snap-litho per owner directive — the cheaper /
  // safer outcome.  An accidental Enter prefers the lightweight path.
  const snapBtnRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (open) snapBtnRef.current?.focus()
  }, [open])

  if (!open) return null
  if (candidates.length === 0) return null
  if (selectedId === null) return null

  const multi = candidates.length > 1

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      labelledBy="litho-geo-snap-title"
      busy={busy}
      cardClassName="w-[30rem]"
      testid="litho-geo-snap-dialog"
    >
      <div className="p-5">
        <h2
          id="litho-geo-snap-title"
          className="text-sm font-semibold text-text-primary mb-1"
        >
          {t('litho.snapTitle')}
        </h2>
        <p className="text-xs text-text-secondary mb-3">
          {t('litho.snapContactAt')}{' '}
          <span className="font-semibold tabular-nums">
            {lithoDepthM.toFixed(2)} m
          </span>{' '}
          {multi ? t('litho.snapWithinMulti') : t('litho.snapWithinSingle')}
        </p>

        {/* Candidate selector — radio group when there are two
            candidates, plain depth readout when there's only one. */}
        {multi ? (
          <fieldset className="mb-4 space-y-1.5">
            <legend className="sr-only">{t('litho.snapPickContact')}</legend>
            {candidates.map(c => {
              const distance = Math.abs(c.depth_top_m - lithoDepthM)
              const checked = selectedId === c.id
              return (
                <label
                  key={c.id}
                  className="flex items-baseline gap-2 text-xs text-text-primary cursor-pointer"
                >
                  <input
                    type="radio"
                    name="litho-geo-snap-candidate"
                    data-testid={`snap-candidate-${c.id}`}
                    checked={checked}
                    onChange={() => setSelectedId(c.id)}
                    disabled={busy}
                  />
                  <span className="tabular-nums font-semibold">
                    {c.depth_top_m.toFixed(2)} m
                  </span>
                  <span className="text-text-secondary">
                    {t('litho.snapDistanceAway', { distance: distance.toFixed(2) })}
                  </span>
                </label>
              )
            })}
          </fieldset>
        ) : (
          <p className="text-xs text-text-secondary mb-4">
            {t('litho.snapGeoContactAt')}{' '}
            <span className="font-semibold tabular-nums text-text-primary">
              {candidates[0].depth_top_m.toFixed(2)} m
            </span>
            .
          </p>
        )}

        <div className="flex justify-end gap-2 flex-wrap">
          <Button
            variant="secondary"
            size="md"
            onClick={onCancel}
            disabled={busy}
            data-testid="snap-cancel"
          >
            {t('litho.snapCancelKeepSeparate')}
          </Button>
          <Button
            variant="secondary"
            size="md"
            onClick={() => onMoveGeoToLitho(selectedId)}
            disabled={busy}
            data-testid="move-geo-to-litho"
          >
            {t('litho.snapMoveGeoToLitho')}
          </Button>
          {/* Default-focused primary action (the snap). Button forwards the
              ref (#165) so the old plain-<button> workaround is gone. */}
          <Button
            ref={snapBtnRef}
            variant="primary"
            size="md"
            onClick={() => onSnapToGeo(selectedId)}
            disabled={busy}
            data-testid="snap-litho-to-geo"
          >
            {t('litho.snapLithoToGeo')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

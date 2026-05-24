/**
 * Dialog for marking a formation contact as part of a litho lens entity.
 *
 * Triggered by right-click → "Mark as lens…" on a formation contact in the
 * lithostratigraphic axis of the section editor (#101 Slice 5).
 *
 * The dialog shows every investigation in the corridor.  The anchor column
 * (the investigation the right-clicked contact belongs to) is locked as
 * PRESENT — it is the evidence that establishes the lens's existence.
 * All other investigations default to UNKNOWN and the user toggles them
 * to PRESENT or ABSENT before submitting.
 *
 * Pre-population from the segmenter result (Q2 owner directive): when
 * ``segmenterAbsentIds`` is provided, those investigation ids are
 * pre-flagged as ABSENT.  The user can override any pre-population.
 *
 * On submit the dialog calls ``api.geology.createLens`` and reports the
 * result via ``onCreated``.  A second step offers to auto-create the
 * perpendicular companion section.
 */

import { useEffect, useRef, useState } from 'react'

import type { CreateLithoLensResponse } from '../../api/client'
import { api } from '../../api/client'
import Button from '../ui/Button'
import Modal from '../ui/Modal'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal investigation reference passed in by the caller. */
export interface CorridorInvestigation {
  /** Investigation id. */
  id: string
  /** 'cpt' | 'borehole' */
  kind: 'cpt' | 'borehole'
  /** Display name (test id / borehole code). */
  name: string
}

type Stance = 'present' | 'absent' | 'unknown'

interface StanceRow {
  investigation: CorridorInvestigation
  stance: Stance
  /** True when this is the anchor column — locked as PRESENT. */
  locked: boolean
}

interface Props {
  open: boolean
  projectId: string
  modelId: string
  sectionId: string
  /** Formation the right-clicked contact belongs to. */
  parentFormationId: string
  parentFormationName: string
  /** The contact id that was right-clicked — its anchor is PRESENT+locked. */
  anchorContactId: string
  /** The investigation the right-clicked contact is anchored to. */
  anchorInvestigationId: string
  anchorInvestigationKind: 'cpt' | 'borehole'
  /** All investigations projected onto this section (for the corridor list). */
  corridorInvestigations: readonly CorridorInvestigation[]
  /**
   * Investigation ids pre-flagged as ABSENT from the segmenter result (Q2).
   * The dialog still shows these as user-overridable; they just start
   * checked-ABSENT instead of UNKNOWN.
   */
  segmenterAbsentIds?: ReadonlySet<string>
  /** Called after the lens is successfully created. */
  onCreated: (result: CreateLithoLensResponse) => void
  /** Called when the dialog is dismissed without creating. */
  onClose: () => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MarkAsLensDialog({
  open,
  projectId,
  modelId,
  sectionId,
  parentFormationId,
  parentFormationName,
  anchorContactId,
  anchorInvestigationId,
  anchorInvestigationKind,
  corridorInvestigations,
  segmenterAbsentIds,
  onCreated,
  onClose,
}: Props): JSX.Element {
  const nameRef = useRef<HTMLInputElement>(null)

  // Initialise stance rows from the corridor investigations.
  // The anchor column is PRESENT + locked; others start from segmenter hint.
  const [rows, setRows] = useState<StanceRow[]>([])
  const [lensName, setLensName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset form whenever the dialog opens or corridor changes.
  // reason: intentional init on open — corridor list is stable while open
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return
    const initialRows: StanceRow[] = corridorInvestigations.map(inv => {
      const locked = inv.id === anchorInvestigationId
      const stance: Stance = locked
        ? 'present'
        : (segmenterAbsentIds?.has(inv.id) ?? false)
          ? 'absent'
          : 'unknown'
      return { investigation: inv, stance, locked }
    })
    setRows(initialRows)
    setLensName('')
    setError(null)
    // Focus the name field after mount.
    requestAnimationFrame(() => nameRef.current?.focus())
  }, [open])

  function setStance(id: string, next: Stance): void {
    setRows(prev =>
      prev.map(r => (r.investigation.id === id && !r.locked ? { ...r, stance: next } : r)),
    )
  }

  async function handleSubmit(): Promise<void> {
    const presentContactIds = anchorContactId ? [anchorContactId] : []
    const absentInvestigations = rows
      .filter(r => r.stance === 'absent')
      .map(r => ({ kind: r.investigation.kind, id: r.investigation.id }))

    setBusy(true)
    setError(null)
    try {
      const result = await api.geology.createLens(projectId, modelId, {
        parent_formation_id: parentFormationId,
        section_id: sectionId,
        name: lensName.trim() || undefined,
        present_contact_ids: presentContactIds,
        absent_investigations: absentInvestigations,
      })
      onCreated(result)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  const hasAbsent = rows.some(r => r.stance === 'absent')

  return (
    <Modal
      open={open}
      onCancel={onClose}
      labelledBy="mark-as-lens-title"
      busy={busy}
      cardClassName="w-[34rem]"
    >
      <div className="p-5 space-y-4">
        {/* Header */}
        <div>
          <h2
            id="mark-as-lens-title"
            className="text-sm font-semibold text-text-primary"
          >
            Mark as lens
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Formation: <span className="font-medium">{parentFormationName}</span>
          </p>
        </div>

        {/* Lens name */}
        <div>
          <label
            htmlFor="lens-name"
            className="block text-xs font-medium text-gray-700 mb-1"
          >
            Lens name{' '}
            <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            id="lens-name"
            ref={nameRef}
            type="text"
            maxLength={120}
            value={lensName}
            onChange={e => setLensName(e.target.value)}
            placeholder="e.g. Clay drape A"
            className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            disabled={busy}
          />
        </div>

        {/* Corridor investigation list */}
        <div>
          <p className="text-xs font-medium text-gray-700 mb-2">
            Corridor investigations
          </p>
          <p className="text-xs text-gray-500 mb-2">
            Mark each investigation as <strong>Present</strong> (lens body
            confirmed), <strong>Absent</strong> (different lithology at this
            depth — triggers wedge-tip geometry), or{' '}
            <strong>Unknown</strong> (no data).
          </p>
          <div className="max-h-52 overflow-y-auto rounded border border-gray-200 divide-y divide-gray-100">
            {rows.map(row => (
              <div
                key={row.investigation.id}
                className="flex items-center justify-between px-3 py-2 text-sm"
              >
                <span
                  className={
                    row.locked
                      ? 'text-gray-700 font-medium'
                      : 'text-gray-700'
                  }
                >
                  {row.investigation.name}
                  {row.locked && (
                    <span className="ml-1.5 text-[10px] uppercase tracking-wide text-gray-400 font-normal">
                      anchor
                    </span>
                  )}
                </span>
                <div className="flex gap-1">
                  {(['present', 'absent', 'unknown'] as const).map(s => (
                    <button
                      key={s}
                      type="button"
                      disabled={row.locked || busy}
                      onClick={() => setStance(row.investigation.id, s)}
                      className={[
                        'rounded px-2 py-0.5 text-[11px] font-medium capitalize transition-colors',
                        row.locked
                          ? s === 'present'
                            ? 'bg-green-100 text-green-800 cursor-default'
                            : 'invisible'
                          : row.stance === s
                            ? s === 'present'
                              ? 'bg-green-100 text-green-800 ring-1 ring-green-400'
                              : s === 'absent'
                                ? 'bg-red-100 text-red-800 ring-1 ring-red-400'
                                : 'bg-gray-100 text-gray-600 ring-1 ring-gray-400'
                            : 'bg-white text-gray-400 border border-gray-200 hover:bg-gray-50',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {rows.length === 0 && (
              <div className="px-3 py-4 text-xs text-gray-400 text-center">
                No investigations in corridor
              </div>
            )}
          </div>
        </div>

        {/* Absent count note */}
        {!hasAbsent && (
          <p className="text-xs text-amber-600">
            No investigations marked Absent — the lens will be created without
            wedge-tip geometry. Mark at least one column Absent to compute
            pinch-out contacts.
          </p>
        )}

        {/* Error */}
        {error !== null && (
          <p className="text-xs text-red-600 bg-red-50 rounded px-2.5 py-2">
            {error}
          </p>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={busy || rows.length === 0}
          >
            {busy ? 'Saving…' : 'Mark as lens'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

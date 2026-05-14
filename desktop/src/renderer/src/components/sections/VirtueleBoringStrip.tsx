/**
 * Cross-section overlay-controls strip — sits directly under the
 * SectionHeader and owns the user's Virtuele Boring picker.
 *
 * Three controls in one row:
 *
 *   * Model A dropdown — pick any DOV lagenmodel (g3dv3_F, hcovv2_H,
 *     OMAv1.1, ...) or "Off".
 *   * Model B dropdown — same options.
 *   * Depth input — show layers down to N m below each investigation's
 *     surface. Default 30 m. Setting to "Full" (clearing the input)
 *     renders DOV's complete crustal column down to bedrock.
 *   * Show on section — collapses the overlay on the section view
 *     without losing the picker state (useful when toggling between
 *     "look at my picks" and "look at DOV's predictions").
 *
 * The model catalogue is fetched lazily on first mount (DOV ships 12
 * entries; cached for the session). The picker is collapsed by
 * default so the strip doesn't intrude when the user hasn't asked
 * for overlays — clicking the chevron expands the controls.
 */

import { ChevronDown, ChevronRight, Database } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../api/client'
import type { VirtueleBoringLagenmodelEntry } from '../../api/client'
import { log } from '../../utils/log'
import {
  VIRTUELE_BORING_MAX_DEPTH_MAX_M,
  VIRTUELE_BORING_MAX_DEPTH_MIN_M,
} from '../../utils/virtueleBoringOverlay'

interface Props {
  modelA: string | null
  modelB: string | null
  maxDepthM: number | null
  /** Per-pane visibility on the section view. The picker stays
   * functional even when this is off — toggling it back on shows the
   * already-fetched predictions immediately. */
  showOnSection: boolean
  onChangePicker: (next: {
    modelA: string | null
    modelB: string | null
    maxDepthM: number | null
  }) => void
  onChangeShowOnSection: (next: boolean) => void
}

export default function VirtueleBoringStrip({
  modelA,
  modelB,
  maxDepthM,
  showOnSection,
  onChangePicker,
  onChangeShowOnSection,
}: Props): JSX.Element {
  const [open, setOpen] = useState(modelA !== null || modelB !== null)
  const [catalog, setCatalog] = useState<VirtueleBoringLagenmodelEntry[] | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  // Local-then-commit pattern for the depth input — the input shows
  // whatever the user is typing immediately, but the actual overlay
  // state (and the PATCH /view-state round-trip) only fires when
  // they leave the field. Matches the section-buffer slider's
  // commit-on-mouseup convention.
  const [localDepth, setLocalDepth] = useState<string>(
    maxDepthM === null ? '' : String(maxDepthM),
  )
  useEffect(() => {
    setLocalDepth(maxDepthM === null ? '' : String(maxDepthM))
  }, [maxDepthM])

  useEffect(() => {
    if (!open || catalog !== null) return
    let cancelled = false
    void (async () => {
      try {
        const result = await api.virtueleBoring.lagenmodellen()
        if (!cancelled) setCatalog(result)
      } catch (err) {
        log.warning('VirtueleBoringStrip', `lagenmodellen fetch failed: ${String(err)}`)
        if (!cancelled) setCatalogError('Could not reach DOV.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, catalog])

  const overlayActive = modelA !== null || modelB !== null

  function commitDepth(value: string): void {
    if (value.trim() === '') {
      onChangePicker({ modelA, modelB, maxDepthM: null })
      return
    }
    const n = Number(value)
    if (!Number.isFinite(n)) {
      // Reset the input visually to the previous committed value.
      setLocalDepth(maxDepthM === null ? '' : String(maxDepthM))
      return
    }
    const clamped = Math.min(
      VIRTUELE_BORING_MAX_DEPTH_MAX_M,
      Math.max(VIRTUELE_BORING_MAX_DEPTH_MIN_M, n),
    )
    onChangePicker({ modelA, modelB, maxDepthM: clamped })
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 border-b border-gray-200 bg-white text-xs">
      <button
        onClick={() => setOpen(prev => !prev)}
        className="flex items-center gap-1.5 text-gray-700 hover:text-gray-900"
        aria-expanded={open}
        title="Show / hide the DOV Virtuele Boring overlay controls"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Database size={12} className="text-gray-500" />
        <span className="text-[11px] font-medium">DOV virtuele boring</span>
        {overlayActive && !open && (
          <span className="text-[10px] text-gray-400 ml-1">
            ({[modelA, modelB].filter(Boolean).join(' · ')})
          </span>
        )}
      </button>

      {open && (
        <>
          <ModelSlotDropdown
            label="A"
            selected={modelA}
            catalog={catalog}
            onSelect={code => onChangePicker({ modelA: code, modelB, maxDepthM })}
          />
          <ModelSlotDropdown
            label="B"
            selected={modelB}
            catalog={catalog}
            onSelect={code => onChangePicker({ modelA, modelB: code, maxDepthM })}
          />
          <label className="flex items-center gap-1.5 text-[11px] text-gray-700">
            <span className="text-gray-500">Depth</span>
            <input
              type="number"
              min={VIRTUELE_BORING_MAX_DEPTH_MIN_M}
              max={VIRTUELE_BORING_MAX_DEPTH_MAX_M}
              step={5}
              value={localDepth}
              onChange={e => setLocalDepth(e.target.value)}
              onBlur={e => commitDepth(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  commitDepth(e.currentTarget.value)
                  e.currentTarget.blur()
                }
              }}
              placeholder="Full"
              className="w-16 px-1.5 py-0.5 border border-gray-200 rounded text-[11px] tabular-nums"
              title="Show layers down to N metres below each investigation's surface. Empty = full DOV column."
            />
            <span className="text-[10px] text-gray-400">m below surface</span>
          </label>
          {overlayActive && (
            <label className="flex items-center gap-1 text-[11px] text-gray-700">
              <input
                type="checkbox"
                checked={showOnSection}
                onChange={e => onChangeShowOnSection(e.target.checked)}
              />
              <span>Show on section</span>
            </label>
          )}
          {catalogError !== null && (
            <span className="text-[10px] text-amber-700">{catalogError}</span>
          )}
        </>
      )}
    </div>
  )
}

function ModelSlotDropdown({
  label,
  selected,
  catalog,
  onSelect,
}: {
  label: string
  selected: string | null
  catalog: VirtueleBoringLagenmodelEntry[] | null
  onSelect: (code: string | null) => void
}): JSX.Element {
  return (
    <label className="flex items-center gap-1 text-[11px] text-gray-700">
      <span className="text-gray-500">Model {label}</span>
      <select
        value={selected ?? ''}
        onChange={e => onSelect(e.target.value === '' ? null : e.target.value)}
        className="px-1.5 py-0.5 border border-gray-200 rounded text-[11px] bg-white max-w-[180px]"
        disabled={catalog === null}
        title={selected ?? 'No overlay in this slot'}
      >
        <option value="">Off</option>
        {(catalog ?? []).map(entry => (
          <option key={entry.code} value={entry.code} title={entry.beschrijving}>
            {entry.beschrijving}
          </option>
        ))}
      </select>
    </label>
  )
}

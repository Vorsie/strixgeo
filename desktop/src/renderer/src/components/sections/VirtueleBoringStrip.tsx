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

import type { VirtueleBoringLagenmodelEntry } from '../../api/client'
import { useVirtueleBoringCatalog } from '../../hooks/useVirtueleBoringCatalog'
import { useT } from '../../i18n/translate'
import {
  formatNumericForDisplay,
  tryParseNumeric,
} from '../ui/NumericInput'
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
  const catalog = useVirtueleBoringCatalog(open)
  const t = useT()
  // Local-then-commit pattern for the depth input — the input shows
  // whatever the user is typing immediately, but the actual overlay
  // state (and the PATCH /view-state round-trip) only fires when
  // they leave the field. Matches the section-buffer slider's
  // commit-on-mouseup convention.
  const [localDepth, setLocalDepth] = useState<string>(
    maxDepthM === null ? '' : formatNumericForDisplay(maxDepthM),
  )
  useEffect(() => {
    setLocalDepth(maxDepthM === null ? '' : formatNumericForDisplay(maxDepthM))
  }, [maxDepthM])

  const overlayActive = modelA !== null || modelB !== null

  function commitDepth(value: string): void {
    if (value.trim() === '') {
      onChangePicker({ modelA, modelB, maxDepthM: null })
      return
    }
    // Shares NumericInput's parser so "what counts as a number" is defined
    // once: both `.` and `,` are accepted whatever the OS locale says, and
    // scientific / hex / signed forms stay out. Negatives are NOT allowed —
    // this depth is measured downward from each investigation's own surface
    // and the overlay has no meaning above it.
    const n = tryParseNumeric(value)
    if (n === null) {
      // Reset the input visually to the previous committed value.
      setLocalDepth(maxDepthM === null ? '' : formatNumericForDisplay(maxDepthM))
      return
    }
    const clamped = Math.min(
      VIRTUELE_BORING_MAX_DEPTH_MAX_M,
      Math.max(VIRTUELE_BORING_MAX_DEPTH_MIN_M, n),
    )
    onChangePicker({ modelA, modelB, maxDepthM: clamped })
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 border-b border-border-subtle bg-surface-card text-xs">
      <button
        onClick={() => setOpen(prev => !prev)}
        className="flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
        aria-expanded={open}
        title={t('sections.vb.toggleHint')}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Database size={12} className="text-text-muted" />
        <span className="text-[11px] font-medium">{t('sections.vb.title')}</span>
        {overlayActive && !open && (
          <span className="text-[10px] text-text-muted ml-1">
            ({[modelA, modelB].filter(Boolean).join(' · ')})
          </span>
        )}
      </button>

      {open && (
        <>
          {open && catalog === null && (
            <span className="text-[10px] text-text-muted">{t('sections.vb.loadingCatalogue')}</span>
          )}
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
          <label className="flex items-center gap-1.5 text-[11px] text-text-secondary">
            <span className="text-text-muted">{t('common.depth')}</span>
            {/* type=text, NOT type=number: the browser's number-input value
                sanitisation drops any string its own locale doesn't
                recognise, so `12,5` reached commitDepth as "" and silently
                reset the overlay to the full column. inputMode keeps the
                numeric keypad on touch surfaces. Range is enforced by
                commitDepth's clamp against the same two constants. */}
            <input
              type="text"
              inputMode="decimal"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={localDepth}
              onChange={e => setLocalDepth(e.target.value)}
              onBlur={e => commitDepth(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  commitDepth(e.currentTarget.value)
                  e.currentTarget.blur()
                }
              }}
              placeholder={t('sections.vb.full')}
              className="w-16 px-1.5 py-0.5 border border-border-subtle rounded text-[11px] tabular-nums bg-surface-page text-text-primary"
              title={t('sections.vb.depthHint')}
            />
            <span className="text-[10px] text-text-muted">{t('sections.vb.depthBelowSurface')}</span>
          </label>
          {overlayActive && (
            <label className="flex items-center gap-1 text-[11px] text-text-secondary">
              <input
                type="checkbox"
                checked={showOnSection}
                onChange={e => onChangeShowOnSection(e.target.checked)}
                className="accent-accent"
              />
              <span>{t('sections.vb.showOnSection')}</span>
            </label>
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
  const t = useT()
  return (
    <label className="flex items-center gap-1 text-[11px] text-text-secondary">
      <span className="text-text-muted">{t('sections.vb.modelSlot', { label })}</span>
      <select
        value={selected ?? ''}
        onChange={e => onSelect(e.target.value === '' ? null : e.target.value)}
        className="px-1.5 py-0.5 border border-border-subtle rounded text-[11px] bg-surface-page text-text-primary max-w-[180px]"
        disabled={catalog === null}
        title={selected ?? t('sections.vb.noOverlay')}
      >
        <option value="">{t('sections.vb.off')}</option>
        {(catalog ?? []).map(entry => (
          <option key={entry.code} value={entry.code} title={entry.beschrijving}>
            {entry.beschrijving}
          </option>
        ))}
      </select>
    </label>
  )
}

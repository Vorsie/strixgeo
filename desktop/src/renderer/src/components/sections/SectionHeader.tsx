/**
 * Cross-section header strip — name, length, buffer slider, VEX
 * slider, scale read-out, reset, zoom +/-, close.
 *
 * The VEX slider is log-mapped: a linear 0-100 thumb travels across
 * the full ``VEX_MIN..VEX_MAX`` log range. Geotech sections regularly
 * want 5× and 50× both reachable; linear mapping would crowd the
 * small values.
 *
 * The buffer slider mirrors a local-then-commit pattern (matches the
 * DEM overlay opacity slider): the displayed value updates
 * immediately as the user drags, but the server-side patch fires
 * only on release. Until commit, the projected columns still use
 * the value from the server-truth ``section`` prop.
 */

import { useEffect, useState } from 'react'
import { Minus, Pencil, Plus, RotateCcw, X } from 'lucide-react'

import type { CrossSectionResponse } from '../../api/client'
import { useT } from '../../i18n/translate'
import type { MessageKey } from '../../i18n/locales/en'
import { sectionDisplayName } from '../../utils/sectionDisplayName'
import SectionNameInput from './SectionNameInput'
import { useSectionNameEditor } from './useSectionNameEditor'
import {
  COLUMN_SPACING_MAX,
  COLUMN_SPACING_MIN,
  type BoreholeChannels,
  type CptChannels,
} from './cptChannels'
import { VEX_MAX, VEX_MIN } from './utils'

// Order matches DOV's "lengteprofiel" PDF reading order: primary
// tracks (qc, Rf) first, then specialist toggles. Each entry is
// the channel key + a 2-char button label.
const CHANNEL_BUTTONS: readonly {
  key: keyof CptChannels
  label: string
  titleKey: MessageKey
}[] = [
  { key: 'qc', label: 'qc', titleKey: 'sections.header.qc' },
  { key: 'rf', label: 'Rf', titleKey: 'sections.header.rf' },
  { key: 'fs', label: 'fs', titleKey: 'sections.header.fs' },
  { key: 'u2', label: 'u2', titleKey: 'sections.header.u2' },
  { key: 'qTotal', label: 'qT', titleKey: 'sections.header.qTotal' },
]

// Borehole interpretation stream toggles, in DOV lengteprofiel
// display order. Labels chosen for readability — full DOV stream
// name in the tooltip. Geotech is the default-ON stream; the others
// are engineer-toggleable. drill_method + field_log are intentional
// gaps (they need a different column-render than the lithology
// strips and will arrive in a follow-up pass).
const BOREHOLE_CHANNEL_BUTTONS: readonly {
  key: keyof BoreholeChannels
  label: string
  titleKey: MessageKey
}[] = [
  { key: 'lithology', label: 'Litho', titleKey: 'sections.header.codedLithology' },
  { key: 'geotech', label: 'Geo', titleKey: 'sections.header.geotechnicalCoding' },
  { key: 'formal_strat', label: 'F-Strat', titleKey: 'sections.header.formalStratigraphy' },
  { key: 'informal_strat', label: 'I-Strat', titleKey: 'sections.header.informalStratigraphy' },
]

// Projection-buffer slider bounds. 5 m is the tightest engineers
// typically use (closely-spaced corridor surveys); 500 m covers
// regional / preliminary sections through sparse boreholes.
const BUFFER_MIN = 5
const BUFFER_MAX = 500

export default function SectionHeader({
  section,
  onRename,
  lengthM,
  onClose,
  onZoomIn,
  onZoomOut,
  vex,
  onVexChange,
  onVexCommit,
  onBufferCommit,
  channels,
  onChannelsChange,
  boreholeChannels,
  onBoreholeChannelsChange,
  snapToStratigraphy,
  onSnapToStratigraphyChange,
  columnSpacing,
  onColumnSpacingChange,
  onColumnSpacingCommit,
  scaleH,
  scaleV,
  onReset,
}: {
  section: CrossSectionResponse
  /** Rename from the header strip; absent = the name is plain text (owner 2026-09-22). */
  onRename?: (name: string) => void
  lengthM: number
  onClose: (() => void) | undefined
  onZoomIn: () => void
  onZoomOut: () => void
  vex: number
  onVexChange: (next: number) => void
  /** Fires on slider release with the final value; ``undefined``
   * means "don't persist" (test-render mode without a backend
   * seam). */
  onVexCommit: ((next: number) => void) | undefined
  onBufferCommit: ((next: number) => void) | undefined
  /** Current CPT channel toggle state — drives the active styling
   * on each channel button. */
  channels: CptChannels
  /** Fires on each toggle click with the next channels object.
   * Wires through to both the in-memory section state (so the
   * column glyphs re-render instantly) AND the section row's
   * view_state via ``PATCH /sections/{id}`` (so the toggle
   * survives reopens + .gmproj round-trips). */
  onChannelsChange: (next: CptChannels) => void
  /** Borehole interpretation stream toggles. Each enabled stream
   * renders as its own strip side by side inside the borehole's
   * column band; the band auto-widens with the count. */
  boreholeChannels: BoreholeChannels
  /** Same shape as ``onChannelsChange`` for the borehole toggle
   * group — optimistic in-memory update + bundle-persistent PATCH. */
  onBoreholeChannelsChange: (next: BoreholeChannels) => void
  /** Click-to-place snap mode — when on, borehole clicks snap to
   * the nearest formal/informal stratigraphy boundary within an
   * 8 px tolerance. Off = free placement. */
  snapToStratigraphy: boolean
  onSnapToStratigraphyChange: (next: boolean) => void
  /** Spacing multiplier (0..1). At 1.0 the nudge layout pushes
   * adjacent columns apart by their full visual width + edge gap;
   * at 0.0 the layout sees zero-width columns and lets bands sit
   * at their true projected X (overlap allowed). Does NOT change
   * the visual width of any column. */
  columnSpacing: number
  /** Fires on each input change — optimistic local update so the
   * slider feels smooth as the user drags. */
  onColumnSpacingChange: (next: number) => void
  /** Fires on slider release with the final value; ``undefined``
   * means "don't persist". */
  onColumnSpacingCommit: ((next: number) => void) | undefined
  scaleH: number
  scaleV: number
  onReset: () => void
}): JSX.Element {
  const t = useT()
  const displayName = sectionDisplayName(section, t)
  const nameEditor = useSectionNameEditor(section, displayName, onRename)
  const sliderValue = Math.round(
    ((Math.log10(vex) - Math.log10(VEX_MIN)) /
      (Math.log10(VEX_MAX) - Math.log10(VEX_MIN))) *
      100,
  )

  function handleSlider(e: React.ChangeEvent<HTMLInputElement>): void {
    const v = Number(e.target.value) / 100
    const logRange = Math.log10(VEX_MAX) - Math.log10(VEX_MIN)
    onVexChange(Math.pow(10, Math.log10(VEX_MIN) + v * logRange))
  }

  const [localBuffer, setLocalBuffer] = useState(section.projection_buffer_m)
  useEffect(() => {
    setLocalBuffer(section.projection_buffer_m)
  }, [section.id, section.projection_buffer_m])

  return (
    // ``flex-wrap`` so the controls fall onto a second row in narrow
    // windows instead of clipping the close button off the right
    // edge. ``gap-y-1`` keeps the wrapped row hugging the first.
    // Semantic tokens (surface-card, border-subtle, text-*) respond
    // to the dark class on <html> without additional dark: variants here;
    // the active / hover states on toggle buttons still use explicit
    // dark: overrides because the accent hues (blue-600, emerald-600,
    // purple-600) are fixed domain colour — see docs/ux.md Tier-5.
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 border-b border-border-subtle bg-surface-card text-xs">
      <div className="flex flex-col min-w-0">
        {nameEditor.editing ? (
          <SectionNameInput
            editor={nameEditor}
            className="text-xs font-medium text-text-primary bg-surface-card border border-accent rounded px-1.5 py-0.5 focus:outline-none min-w-[12rem]"
            ariaLabel={t('sections.name')}
            testId="section-header-name-input"
          />
        ) : nameEditor.canEdit ? (
          <button
            type="button"
            onClick={nameEditor.start}
            title={t('sections.rename')}
            className="group flex items-center gap-1 min-w-0 text-left"
            data-testid="section-header-name"
          >
            <span className="font-medium text-text-primary truncate">{displayName}</span>
            <Pencil
              size={10}
              className="flex-shrink-0 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity"
              aria-hidden="true"
            />
          </button>
        ) : (
          <span className="font-medium text-text-primary truncate" title={displayName}>
            {displayName}
          </span>
        )}
        <span className="text-[10px] text-text-muted">
          {t('sections.header.lengthBuffer', {
            length: lengthM.toFixed(0),
            buffer: section.projection_buffer_m.toFixed(0),
          })}
        </span>
        {/* Lens companion badge — visible when this section was auto-created
            as a perpendicular companion for a lens (#101 Slice 6). */}
        {section.is_body_companion && (
          <span
            className="text-[10px] text-violet-600 font-medium mt-0.5"
            title={
              section.companion_body_id
                ? t('sections.header.companionTitleActive')
                : t('sections.header.companionTitleDeleted')
            }
          >
            {section.companion_body_name
              ? t('sections.header.companionOf', { name: section.companion_body_name })
              : t('sections.header.lensCompanion')}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 ml-auto">
        <span
          className="text-[10px] text-text-muted"
          title={t('sections.header.bufferHint')}
        >
          {t('sections.header.buffer')}
        </span>
        <input
          type="range"
          min={BUFFER_MIN}
          max={BUFFER_MAX}
          step={5}
          value={Math.round(localBuffer)}
          onChange={e => setLocalBuffer(Number(e.target.value))}
          onMouseUp={() => onBufferCommit?.(localBuffer)}
          onTouchEnd={() => onBufferCommit?.(localBuffer)}
          onKeyUp={() => onBufferCommit?.(localBuffer)}
          className="w-28 cursor-pointer accent-accent"
          aria-label={t('sections.bufferLabel')}
          data-testid="section-control-buffer"
          disabled={onBufferCommit === undefined}
        />
        <span className="tabular-nums w-12 text-right text-text-secondary">±{Math.round(localBuffer)} m</span>
      </div>

      <div className="flex items-center gap-1">
        <span className="text-[10px] text-text-muted mr-1" title={t('sections.header.cptChannels')}>
          {t('sections.header.channels')}
        </span>
        {CHANNEL_BUTTONS.map(({ key, label, titleKey }) => {
          const active = channels[key]
          return (
            <button
              key={key}
              onClick={() => onChannelsChange({ ...channels, [key]: !active })}
              title={t(titleKey)}
              aria-label={t('sections.header.toggle', { label })}
              // Tutorial anchor (Chapter 3: the qc / Rf / fs / u2 / qT channels).
              data-testid={`section-control-channel-${key}`}
              aria-pressed={active}
              className={
                'px-1.5 py-0.5 text-[10px] tabular-nums rounded border transition-colors ' +
                (active
                  ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                  : 'bg-surface-page text-text-muted border-border-subtle hover:text-text-primary hover:bg-surface-card dark:hover:bg-surface-card')
              }
            >
              {label}
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-1">
        <span
          className="text-[10px] text-text-muted mr-1"
          title={t('sections.header.streamToggles')}
        >
          {t('sections.header.bore')}
        </span>
        {BOREHOLE_CHANNEL_BUTTONS.map(({ key, label, titleKey }) => {
          const active = boreholeChannels[key]
          return (
            <button
              key={key}
              onClick={() =>
                onBoreholeChannelsChange({ ...boreholeChannels, [key]: !active })
              }
              title={t(titleKey)}
              aria-label={t('sections.header.toggle', { label })}
              // Tutorial anchor (Chapter 3: the borehole interpretation streams).
              data-testid={`section-control-borehole-${key}`}
              aria-pressed={active}
              className={
                'px-1.5 py-0.5 text-[10px] tabular-nums rounded border transition-colors ' +
                (active
                  ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700'
                  : 'bg-surface-page text-text-muted border-border-subtle hover:text-text-primary hover:bg-surface-card dark:hover:bg-surface-card')
              }
            >
              {label}
            </button>
          )
        })}
      </div>

      <button
        onClick={() => onSnapToStratigraphyChange(!snapToStratigraphy)}
        aria-pressed={snapToStratigraphy}
        title={t('sections.header.snapHint')}
        data-testid="section-control-snap"
        className={
          'px-1.5 py-0.5 text-[10px] rounded border transition-colors ' +
          (snapToStratigraphy
            ? 'bg-purple-600 text-white border-purple-600 hover:bg-purple-700'
            : 'bg-surface-page text-text-muted border-border-subtle hover:text-text-primary hover:bg-surface-card dark:hover:bg-surface-card')
        }
      >
        {t('sections.header.snap')}
      </button>

      <div className="flex items-center gap-2">
        <span
          className="text-[10px] text-text-muted"
          title={t('sections.columnSpacingHint')}
        >
          {t('sections.header.spacing')}
        </span>
        <input
          type="range"
          min={Math.round(COLUMN_SPACING_MIN * 100)}
          max={Math.round(COLUMN_SPACING_MAX * 100)}
          step={5}
          value={Math.round(columnSpacing * 100)}
          onChange={e => onColumnSpacingChange(Number(e.target.value) / 100)}
          onMouseUp={() => onColumnSpacingCommit?.(columnSpacing)}
          onTouchEnd={() => onColumnSpacingCommit?.(columnSpacing)}
          onKeyUp={() => onColumnSpacingCommit?.(columnSpacing)}
          className="w-24 cursor-pointer accent-accent"
          aria-label={t('sections.columnSpacing')}
          data-testid="section-control-spacing"
          disabled={onColumnSpacingCommit === undefined}
        />
        <span className="tabular-nums w-10 text-right text-text-secondary">
          {Math.round(columnSpacing * 100)}%
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[10px] text-text-muted">{t('sections.vexShort')}</span>
        <input
          type="range"
          min={0}
          max={100}
          value={sliderValue}
          onChange={handleSlider}
          onMouseUp={() => onVexCommit?.(vex)}
          onTouchEnd={() => onVexCommit?.(vex)}
          onKeyUp={() => onVexCommit?.(vex)}
          className="w-32 cursor-pointer accent-accent"
          aria-label={t('sections.vex')}
          data-testid="section-control-vexag"
        />
        <span className="tabular-nums w-12 text-right text-text-secondary">{vex.toFixed(1)}×</span>
      </div>

      {/* The rendered scales, and the only place either is stated as a number. The
          vertical one carries a testid because a drag spec has to convert metres to
          screen pixels to aim a gesture: measuring that scale off two drawn features
          costs a pixel of error per feature, which on a compressed section is a large
          fraction of the distance being aimed at. Reading the value the renderer
          itself used removes the measurement from the test entirely. */}
      <div className="flex flex-col items-end text-[10px] text-text-muted tabular-nums">
        <span>{t('sections.header.scaleH', { scale: scaleH.toFixed(2) })}</span>
        <span data-testid="section-scale-v">
          {t('sections.header.scaleV', { scale: scaleV.toFixed(2) })}
        </span>
      </div>

      <div className="flex items-center rounded border border-border-subtle overflow-hidden">
        <button
          onClick={onZoomOut}
          className="flex items-center justify-center w-7 h-7 text-text-secondary hover:bg-surface-page hover:text-text-primary transition-colors border-r border-border-subtle"
          title={t('sections.zoomOutHint')}
          aria-label={t('common.zoomOut')}
        >
          <Minus size={13} />
        </button>
        <button
          onClick={onZoomIn}
          className="flex items-center justify-center w-7 h-7 text-text-secondary hover:bg-surface-page hover:text-text-primary transition-colors"
          title={t('sections.zoomInHint')}
          aria-label={t('common.zoomIn')}
        >
          <Plus size={13} />
        </button>
      </div>

      <button
        onClick={onReset}
        // Tutorial anchor (Chapter 3: view-state persistence — every slider here
        // saves to the section automatically; Reset returns the default framing).
        data-testid="section-view-reset"
        className="flex items-center gap-1 px-2 py-1 rounded border border-border-subtle text-text-secondary hover:bg-surface-page hover:text-text-primary transition-colors"
        title={t('sections.resetFraming')}
      >
        <RotateCcw size={11} />
        {t('common.reset')}
      </button>

      {/* Debt #93 (2026-05-21): the "Seed from stratigraphy" and "DXF"
          buttons that used to live here were duplicates of the
          SectionsToolbar "Seed" / "Export DXF" actions and added clutter
          (visible-but-disabled on the litho axis). Removed; the toolbar
          is now the canonical surface for those verbs. Reset stays
          because it acts on section-view-state (zoom/pan/spacing), not
          a model action. */}

      {onClose && (
        <button
          onClick={onClose}
          // ``ml-auto`` pushes the close button to the far right of
          // whichever wrapped row it lands on so it stays reachable
          // even when the header overflows into two rows in narrow
          // windows.
          className="ml-auto shrink-0 flex items-center justify-center w-7 h-7 rounded border border-border-subtle text-text-muted hover:bg-surface-page hover:text-text-primary transition-colors"
          title={t('sections.closeViewHint')}
          aria-label={t('sections.closeView')}
        >
          <X size={13} />
        </button>
      )}
    </div>
  )
}

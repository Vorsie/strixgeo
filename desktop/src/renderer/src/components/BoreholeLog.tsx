import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Columns3, Database, ListPlus, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'

import type {
  BoreholeDetailResponse,
  VirtueleBoringInvestigationPrediction,
  VirtueleBoringLayer,
} from '../api/client'
import {
  maxCharsForWidth,
  maxLinesForHeight,
  wrapLabelToLines,
} from '../utils/labelWrap'
import { SoilPatterns } from '../utils/soilPatterns'
import {
  DEFAULT_CONTACT_OVERLAY_VISIBILITY,
  type ContactOverlay,
  type ContactOverlayVisibility,
} from '../utils/contactOverlays'
import { ContactOverlayToggles } from './ContactOverlayToggles'
import { useVirtueleBoringCatalog } from '../hooks/useVirtueleBoringCatalog'
import { isTypingTarget } from '../utils/keyboard'
import { useT } from '../i18n/translate'
import LabTestPanel from './LabTestPanel'
import BoreholeTracksDialog from './borelog/components/BoreholeTracksDialog'
import type { BoreholeTrackEditing } from '../hooks/useBoreholeTrackEdits'
import LabSeriesSection from './labSeries/LabSeriesSection'
import {
  TOGGLEABLE_TRACK_IDS,
  trackLabel,
  useHiddenBoreholeLogTracks,
  type ToggleableTrackId,
} from '../hooks/useHiddenBoreholeLogTracks'
import {
  BASE_PX_PER_M,
  DRILL_TRACK_WIDTH,
  FIELD_LOG_TRACK_WIDTH,
  HEADER_HEIGHT,
  SAMPLES_TRACK_WIDTH,
  SVG_X_PAD,
  SVG_Y_PAD,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
} from './borelog/constants'
import {
  computeLayout,
  humanizeObservationType,
  PxPerMContext,
} from './borelog/utils'
import { BoreholeHeader } from './borelog/components/BoreholeHeader'
import { DrillMethodTrack } from './borelog/components/DrillMethodTrack'
import { FieldLogTrack } from './borelog/components/FieldLogTrack'
import { GroundwaterLine } from './borelog/components/GroundwaterLine'
import { Legend } from './borelog/components/Legend'
import { MTawAxis } from './borelog/components/MTawAxis'
import { ObservationTrack } from './borelog/components/ObservationTrack'
import { SamplesTrack } from './borelog/components/SamplesTrack'
import { SelectedSampleMarker } from './borelog/components/SelectedSampleMarker'
import { TrackHeader } from './borelog/components/TrackHeader'

// PR 4b–4d — full-feature borelog modelled on DOV's Rapport BoorProfiel:
//
// * Header strip (HTML)
// * SVG canvas with:
//   - mTAW axis on the left (when surface elevation known)
//   - One vertical track per observation stream (lithology with hatching
//     patterns; stratigraphy with plain text labels)
//   - Drill-method track (when drill_segments present)
//   - Field-log track (3 sub-stripes: color / moisture / consistency)
//   - Samples track with clickable per-test icons
//   - Groundwater horizontal dashed line
// * Legend (HTML) — only items actually used in this borehole
// * LabTestPanel slide-in (HTML overlay) when a sample is clicked
//
// The canvas is one big SVG element so patterns, click-targets, and the
// groundwater line all share the same coordinate space. Layout is computed
// once via ``computeLayout`` so x-offsets stay aligned.

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

interface Props {
  borehole: BoreholeDetailResponse
  // Called when the user saves a new elevation in the header editor.
  // Optional so existing call sites (tests, future read-only views) can
  // mount the borelog without wiring an API path. The editor hides the
  // pencil/clear affordances when this is omitted. ``zEpsg`` carries the
  // user's pick from the editor's datum dropdown (mTAW / NAP); it's
  // ``null`` when the value is being cleared.
  onElevationChange?: (elevationM: number | null, zEpsg: number | null) => Promise<void>
  // DOV Virtuele Boring overlay — informative-only ghost columns
  // rendered to the right of the existing tracks inside the same
  // SVG (so they scroll together). The toggle button in the toolbar
  // flips the per-pane visibility; the picker (model selection +
  // depth) lives on the section pane.
  virtueleBoringPrediction?: VirtueleBoringInvestigationPrediction | null
  // Effective model list for this pane — App.tsx resolves the
  // override-vs-section pick before passing here.
  virtueleBoringActiveModels?: readonly string[]
  virtueleBoringMaxDepthM?: number | null
  virtueleBoringVisible?: boolean
  onToggleVirtueleBoringVisible?: () => void
  // Per-pane model override. "" = follow section.
  virtueleBoringOverrideModel?: string
  onChangeVirtueleBoringOverrideModel?: (next: string) => void
  // True while the predictions network fetch is in flight. Surfaces a
  // spinner next to the DOV button so the pane doesn't appear hung.
  virtueleBoringLoading?: boolean
  // Faded horizontal contact lines for every formation contact
  // (geological model) and litho contact (lithostratigraphic model)
  // anchored at this borehole. Built by ``buildContactOverlays``
  // (see ``utils/contactOverlays.ts``). Spans the full data-track
  // width, painted last so the lines sit on top of the soil patterns
  // without obscuring them at the chosen opacity. Undefined / empty
  // = no overlay (the borelog renders unchanged).
  contactOverlays?: readonly ContactOverlay[]
  // Per-source on/off switches for those lines (owner 2026-10-04). The
  // caller filters ``contactOverlays``; the log only renders the two
  // switches, and only when ``onToggleContactOverlay`` is wired.
  contactOverlayVisibility?: Readonly<ContactOverlayVisibility>
  onToggleContactOverlay?: (source: ContactOverlay['source']) => void
  // Add / change / delete tracks by hand (owner 2026-09-29). Optional so
  // read-only mounts (tests, previews) hide the "Tracks" button.
  trackEditing?: BoreholeTrackEditing
  // Active project id: when given, the raw lab tests (oedometer / triaxial
  // readings) of this borehole's samples are listed under the log. Optional so
  // tests and read-only mounts render the log alone.
  projectId?: string
}

// Per-model ghost-column width inside the borelog. Same vocabulary
// as the section view + CPT depth column for visual consistency.
const VB_COLUMN_WIDTH = 50
const VB_COLUMN_GAP = 4
const VB_GAP_FROM_TRACKS = 8
const VB_LABEL_FONT_SIZE = 9

export default function BoreholeLog({
  borehole,
  onElevationChange,
  virtueleBoringPrediction = null,
  virtueleBoringActiveModels = [],
  virtueleBoringMaxDepthM = null,
  virtueleBoringVisible = false,
  onToggleVirtueleBoringVisible,
  virtueleBoringOverrideModel = '',
  onChangeVirtueleBoringOverrideModel,
  virtueleBoringLoading = false,
  contactOverlays,
  contactOverlayVisibility = DEFAULT_CONTACT_OVERLAY_VISIBILITY,
  onToggleContactOverlay,
  trackEditing,
  projectId,
}: Props): React.ReactElement {
  const t = useT()
  const {
    catalog: virtueleBoringCatalog,
    failed: dovCatalogFailed,
    status: dovCatalogStatus,
  } = useVirtueleBoringCatalog(onChangeVirtueleBoringOverrideModel !== undefined)
  const [selectedSampleId, setSelectedSampleId] = useState<string | null>(null)
  // Tracks panel (owner 2026-09-29) open/closed.
  const [tracksOpen, setTracksOpen] = useState(false)

  // Vertical zoom — broadcast via PxPerMContext so deeply nested track
  // sub-components don't need prop drilling. ``zoomFactor`` is a multiplier
  // on BASE_PX_PER_M; +/- buttons clamp it to [ZOOM_MIN, ZOOM_MAX].
  const [zoomFactor, setZoomFactor] = useState(1.0)
  const pxPerM = BASE_PX_PER_M * zoomFactor

  // Global (not project-scoped) hidden-track set. Persisted to localStorage
  // so the user's column preference survives across sessions + projects.
  const [hiddenTracks, setHiddenTracks] = useHiddenBoreholeLogTracks()

  // Columns dropdown open/close state + portal anchor position.
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [columnsPos, setColumnsPos] = useState<{ top: number; left: number } | null>(null)
  const columnsBtnRef = useRef<HTMLButtonElement>(null)
  const columnsMenuRef = useRef<HTMLDivElement>(null)

  // Number of tracks the borehole ACTUALLY HAS that are currently hidden —
  // used for the "Columns (N hidden)" badge. Only tracks present in THIS
  // borehole count; hiding a track that isn't here doesn't show as "hidden".
  const presentTrackIds = useMemo((): ReadonlySet<ToggleableTrackId> => {
    const ids = new Set<ToggleableTrackId>()
    for (const o of borehole.observations) {
      if (o.layers.length > 0) ids.add(o.observation_type as ToggleableTrackId)
    }
    if (borehole.drill_segments.length > 0) ids.add('drill_method')
    if (borehole.field_log_intervals.length > 0) ids.add('field_log')
    if (borehole.samples.length > 0) ids.add('samples_lab')
    return ids
  }, [borehole])

  const hiddenCount = useMemo(() => {
    let n = 0
    for (const id of hiddenTracks) {
      if (presentTrackIds.has(id)) n++
    }
    return n
  }, [hiddenTracks, presentTrackIds])

  // Can't-hide-all guard: ensure at least one DATA track remains visible
  // whenever the user tries to hide a track. Returns true when hiding
  // ``id`` would leave zero visible tracks on this borehole.
  function wouldHideAll(id: ToggleableTrackId): boolean {
    const visibleAfter = [...presentTrackIds].filter(
      tid => tid !== id && !hiddenTracks.has(tid),
    )
    return visibleAfter.length === 0
  }

  function toggleTrack(id: ToggleableTrackId): void {
    setHiddenTracks(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        // Can't-hide-all guard computed against ``prev`` (the updater's
        // authoritative set), NOT the render-frame ``hiddenTracks`` that
        // ``wouldHideAll`` closes over — batched state updates can advance
        // prev past the render snapshot, which would let the guard be
        // bypassed. ``presentTrackIds`` derives only from the borehole
        // prop, so closing over it inside the updater is stable.
        const visibleAfter = [...presentTrackIds].filter(
          tid => tid !== id && !prev.has(tid),
        )
        if (visibleAfter.length === 0) return prev
        next.add(id)
      }
      return next
    })
  }

  // Keyboard accessibility: the header-click is a pointer-only SHORTCUT.
  // The canonical, fully keyboard-operable control is the "Columns"
  // dropdown (standard label/checkbox HTML) which covers 100% of the
  // hide/show functionality — so WCAG 2.1.1 is satisfied without adding
  // tabIndex/onKeyDown to every SVG track header (which would spam the
  // tab order with ~8 stops ahead of the content). Intentional, not a gap.
  function hideTrack(id: ToggleableTrackId): void {
    // Clicked directly on a track header — same guard applies.
    if (wouldHideAll(id)) return
    setHiddenTracks(prev => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }

  // Close the Columns dropdown when the user clicks outside it.
  useEffect(() => {
    if (!columnsOpen) return
    function handleClick(e: MouseEvent): void {
      const t = e.target as Node
      // The menu is portalled to <body>, check both button and menu refs.
      if (columnsBtnRef.current?.contains(t) || columnsMenuRef.current?.contains(t)) return
      setColumnsOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [columnsOpen])

  function toggleColumnsMenu(): void {
    setColumnsOpen(o => {
      const next = !o
      // Anchor the portalled menu under the button — same approach as
      // DataToolbar's import dropdown. Fixed-position escapes any
      // overflow:hidden ancestor in the borelog toolbar.
      if (next && columnsBtnRef.current) {
        const r = columnsBtnRef.current.getBoundingClientRect()
        setColumnsPos({ top: r.bottom + 2, left: r.left })
      }
      return next
    })
  }

  const layout = useMemo(
    () => computeLayout(borehole, pxPerM, hiddenTracks),
    [borehole, pxPerM, hiddenTracks],
  )

  // Width of the DOV Virtuele Boring ghost-column rail rendered to
  // the right of the borelog's normal tracks. Zero when the overlay
  // is off or no models are armed; otherwise one slim column per
  // active model with a small gap between them.
  const overlayShows =
    virtueleBoringVisible && virtueleBoringActiveModels.length > 0
  const vbRailWidth = overlayShows
    ? VB_GAP_FROM_TRACKS +
      virtueleBoringActiveModels.length * VB_COLUMN_WIDTH +
      Math.max(0, virtueleBoringActiveModels.length - 1) * VB_COLUMN_GAP
    : 0
  const vbRailLeftX = layout.totalWidth - SVG_X_PAD + VB_GAP_FROM_TRACKS
  const svgWidth = layout.totalWidth + vbRailWidth

  const selectedSample =
    selectedSampleId != null
      ? (borehole.samples.find(s => s.id === selectedSampleId) ?? null)
      : null

  function zoomIn(): void {
    setZoomFactor(z => Math.min(ZOOM_MAX, z * ZOOM_STEP))
  }
  function zoomOut(): void {
    setZoomFactor(z => Math.max(ZOOM_MIN, z / ZOOM_STEP))
  }
  function zoomReset(): void {
    setZoomFactor(1.0)
  }

  // Ctrl+scroll wheel zoom — standard CAD/map UX. We attach via
  // ``addEventListener`` (NOT React's ``onWheel``) because React wheel
  // handlers are passive-by-default and ``preventDefault`` is a no-op
  // there; we need preventDefault to stop the page from also scrolling
  // while the user is zooming.
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    function onWheel(e: WheelEvent): void {
      if (!e.ctrlKey) return
      e.preventDefault()
      // ``deltaY`` < 0 means wheel-up = zoom in, > 0 means wheel-down =
      // zoom out. Same convention as image viewers / map tools.
      setZoomFactor(z => {
        const next = e.deltaY < 0 ? z * ZOOM_STEP : z / ZOOM_STEP
        return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next))
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Ctrl+0 resets vertical zoom to 100 %. Standard convention across
  // browsers / image viewers / IDEs. Skipped when an input owns focus.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key === '0' && !isTypingTarget(e.target)) {
        e.preventDefault()
        zoomReset()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // Auto-scroll the borelog so the selected sample's depth interval is
  // centred in the visible viewport. Fires ONLY on sample-id change —
  // re-running on zoom changes turned out to fight the user mid-wheel-
  // zoom (every wheel-tick re-triggered a smooth-scroll animation,
  // pulling the viewport away from where they were aiming). Reading
  // the latest ``pxPerM`` via a ref keeps the math correct without
  // re-firing the effect.
  const pxPerMRef = useRef(pxPerM)
  pxPerMRef.current = pxPerM
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el || !selectedSample) return
    const midDepth = (selectedSample.depth_top_m + selectedSample.depth_base_m) / 2
    const sampleY = SVG_Y_PAD + HEADER_HEIGHT + midDepth * pxPerMRef.current
    const targetTop = sampleY - el.clientHeight / 2
    el.scrollTo({
      top: Math.max(0, targetTop),
      behavior: 'smooth',
    })
  }, [selectedSample?.id])

  return (
    <PxPerMContext.Provider value={pxPerM}>
    <div className="flex flex-col h-full overflow-hidden bg-white dark:bg-slate-900">
      <BoreholeHeader borehole={borehole} onElevationChange={onElevationChange} />

      {/* Toolbar above the canvas — zoom controls + Columns toggle. */}
      <div className="flex items-center gap-1 px-3 py-1 border-b border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-[11px]">
        <button
          onClick={zoomOut}
          disabled={zoomFactor <= ZOOM_MIN + 1e-6}
          title={t('borelog.zoomOutVertical')}
          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-600 dark:text-slate-300 disabled:text-gray-300 dark:disabled:text-slate-600 disabled:cursor-not-allowed"
        >
          <ZoomOut size={13} />
        </button>
        <button
          onClick={zoomIn}
          disabled={zoomFactor >= ZOOM_MAX - 1e-6}
          title={t('borelog.zoomInVertical')}
          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-600 dark:text-slate-300 disabled:text-gray-300 dark:disabled:text-slate-600 disabled:cursor-not-allowed"
        >
          <ZoomIn size={13} />
        </button>
        <button
          onClick={zoomReset}
          disabled={Math.abs(zoomFactor - 1) < 1e-6}
          title={t('borelog.resetZoom1x')}
          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-600 dark:text-slate-300 disabled:text-gray-300 dark:disabled:text-slate-600 disabled:cursor-not-allowed"
        >
          <Maximize2 size={13} />
        </button>
        <span className="text-gray-400 dark:text-slate-500 ml-1 tabular-nums">
          {(zoomFactor * 100).toFixed(0)}%
        </span>

        {/* Tracks — add a track by hand or change any track (owner
            2026-09-29). Opens the modal Tracks panel; hidden on read-only
            mounts that pass no ``trackEditing``. */}
        {trackEditing !== undefined && (
          <button
            onClick={() => setTracksOpen(true)}
            title={t('tracks.buttonHint')}
            data-testid="borelog-tracks-button"
            className="ml-1 flex items-center gap-1 px-2 h-6 rounded border border-gray-200 dark:border-slate-600 text-[10px] text-gray-500 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
          >
            <ListPlus size={11} />
            {t('tracks.button')}
          </button>
        )}
        {trackEditing !== undefined && (
          <BoreholeTracksDialog
            open={tracksOpen}
            borehole={borehole}
            editing={trackEditing}
            onClose={() => setTracksOpen(false)}
          />
        )}

        {/* Columns dropdown — shows / hides individual tracks.
            The REQUIRED restore path per ux.md reversible-action rule:
            hiding a track via header-click has no visible undo button, so
            this dropdown is the only way back. It also lists every toggleable
            track up-front so power users can manage all columns in one place.
            The button shows "(N hidden)" when ≥1 track is hidden on this
            borehole, making the non-default state obvious. */}
        <div className="relative ml-1">
          <button
            ref={columnsBtnRef}
            onClick={toggleColumnsMenu}
            aria-expanded={columnsOpen}
            aria-haspopup="true"
            title={t('borelog.toggleColumnsHint')}
            className={[
              'flex items-center gap-1 px-2 h-6 rounded border text-[10px] transition-colors',
              columnsOpen
                ? 'border-gray-300 dark:border-slate-500 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200'
                : hiddenCount > 0
                  ? 'border-amber-400 dark:border-amber-500 text-amber-600 dark:text-amber-400 hover:bg-gray-100 dark:hover:bg-slate-700'
                  : 'border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700',
            ].join(' ')}
          >
            <Columns3 size={11} />
            {hiddenCount > 0
              ? t('borelog.columnsHidden', { n: hiddenCount })
              : t('borelog.columns')}
          </button>

          {columnsOpen && columnsPos &&
            createPortal(
              <div
                ref={columnsMenuRef}
                data-testid="borelog-columns-menu"
                style={{ position: 'fixed', top: columnsPos.top, left: columnsPos.left }}
                // z-[1200]: above toasts (z-[1100]) so it's never occluded
                className="w-64 bg-surface-overlay border border-border-subtle rounded shadow-lg z-[1200] py-1"
              >
                <div className="px-3 py-1 text-[9px] text-text-muted uppercase tracking-wide select-none">
                  {t('borelog.toggleColumns')}
                </div>
                {TOGGLEABLE_TRACK_IDS.map(id => {
                  const isPresent = presentTrackIds.has(id)
                  const isHidden = hiddenTracks.has(id)
                  const isVisible = !isHidden
                  // Disable the checkbox when hiding this track would remove
                  // the last visible track on the current borehole.
                  const wouldEmpty = isVisible && wouldHideAll(id) && isPresent
                  return (
                    <label
                      key={id}
                      className={[
                        'flex items-center gap-2.5 px-3 py-1.5 text-xs select-none',
                        isPresent
                          ? wouldEmpty
                            ? 'text-text-muted cursor-not-allowed'
                            : 'text-text-primary hover:bg-surface-card cursor-pointer'
                          : 'text-text-muted cursor-default opacity-40',
                      ].join(' ')}
                      title={
                        !isPresent
                          ? t('borelog.trackNotPresent')
                          : wouldEmpty
                            ? t('borelog.cannotHideLast')
                            : undefined
                      }
                    >
                      <input
                        type="checkbox"
                        checked={isPresent && isVisible}
                        disabled={!isPresent || wouldEmpty}
                        onChange={() => isPresent && !wouldEmpty && toggleTrack(id)}
                        className="accent-blue-500 dark:accent-blue-400"
                      />
                      <span className={!isPresent ? 'italic' : undefined}>
                        {trackLabel(t, id)}
                      </span>
                    </label>
                  )
                })}
              </div>,
              document.body,
            )}
        </div>
        {/* Stratigraphic / lithological boundary switches (owner
            2026-10-04), right-aligned just before the DOV control in the
            same pill style. When present they own the ``ml-auto`` push so
            the switches and the DOV control stay one group. */}
        {onToggleContactOverlay !== undefined && (
          <div className="flex items-center gap-1 ml-auto">
            <ContactOverlayToggles
              visibility={contactOverlayVisibility}
              onToggle={onToggleContactOverlay}
            />
          </div>
        )}
        {/* DOV overlay toggle + override picker. The button flips
            visibility; the dropdown selects which model THIS pane
            shows ("Follow section" inherits modelA/modelB; a
            specific code renders only that one). */}
        {onToggleVirtueleBoringVisible !== undefined && (
          <div
            className={
              'flex items-center gap-1 ' + (onToggleContactOverlay === undefined ? 'ml-auto' : 'ml-1')
            }
          >
            {/* Spinner shown while the predictions fetch is in flight
                so the pane doesn't look unresponsive after model pick. */}
            {virtueleBoringLoading && (
              <span
                aria-label={t('borelog.loadingDovPredictions')}
                className="inline-block w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"
              />
            )}
            <button
              onClick={onToggleVirtueleBoringVisible}
              disabled={virtueleBoringActiveModels.length === 0}
              aria-pressed={virtueleBoringVisible}
              aria-label={t('borelog.toggleVirtueleBoring')}
              title={
                virtueleBoringActiveModels.length === 0
                  ? t('borelog.dovPickModelHint')
                  : virtueleBoringVisible
                    ? t('borelog.hideDovOverlay')
                    : t('borelog.showDovOverlay')
              }
              className={
                'flex items-center gap-1 px-2 h-6 rounded border text-[10px] transition-colors ' +
                (virtueleBoringActiveModels.length === 0
                  ? 'border-gray-200 dark:border-slate-600 text-gray-300 dark:text-slate-600 cursor-not-allowed'
                  : virtueleBoringVisible
                    ? 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700'
                    : 'border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700')
              }
            >
              <Database size={11} />
              {/* i18n-exempt: DOV is the product/brand name (Databank Ondergrond Vlaanderen), identical across locales */}
              DOV
            </button>
            {onChangeVirtueleBoringOverrideModel !== undefined && (
              <select
                value={virtueleBoringOverrideModel}
                onChange={e => onChangeVirtueleBoringOverrideModel(e.target.value)}
                disabled={virtueleBoringCatalog === null}
                title={t('borelog.overrideDovModel')}
                aria-label={t('borelog.dovOverlayModel')}
                className="h-6 px-1 border border-gray-200 dark:border-slate-600 rounded text-[10px] bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 max-w-[160px]"
              >
                <option value="">{t('borelog.followSection')}</option>
                {(virtueleBoringCatalog ?? []).map(entry => (
                  <option key={entry.code} value={entry.code}>
                    {entry.beschrijving}
                  </option>
                ))}
              </select>
            )}
            {/* When the lagenmodel catalogue fetch failed (e.g. the
                backend refused the DOV host → 503) the picker above is
                disabled; say why instead of leaving it silently greyed. */}
            {dovCatalogFailed && (
              <span
                className="text-[10px] text-gray-400 dark:text-slate-500"
                title={t('borelog.dovUnavailable')}
              >
                {t('borelog.dovUnavailable')}
                {dovCatalogStatus !== null ? ` (${dovCatalogStatus})` : ''}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Horizontal split: borelog (flex-1, scrolls) + lab panel (fixed
          420px, only when a sample is selected). Switching from the old
          absolute-overlay pattern means the borelog stays visible and
          interactive while the user reads lab tests — it just gets
          narrower. The borelog's internal SVG already has its own
          horizontal scroll, so cropping the visible viewport doesn't
          hide tracks; the user can scroll within the borelog area. */}
      <div className="flex-1 flex flex-row overflow-hidden">
        <div ref={scrollContainerRef} className="flex-1 overflow-auto">
          <svg
            width={svgWidth}
            height={layout.totalHeight}
            className="block"
          >
          <defs>
            <SoilPatterns />
          </defs>

          {/* mTAW axis only renders when surface elevation is known.
              The "needs Z" affordances live elsewhere now: the amber
              "Set elevation" link in the header is the action; the
              footer legend explains the consequence ("borelog renders
              without absolute level axis"). The earlier in-canvas
              ``no Z (manual entry needed)`` SVG label was clipped by
              the first track header at default zoom, so it's been
              removed — three flagging surfaces was already one too
              many. */}
          {borehole.elevation_m != null && (
            <MTawAxis
              x={SVG_X_PAD}
              y={SVG_Y_PAD + HEADER_HEIGHT}
              height={layout.canvasHeight}
              surfaceElevation={borehole.elevation_m}
              totalDepth={layout.totalDepth}
              zEpsg={borehole.z_epsg}
            />
          )}

          {/* Observation tracks */}
          {layout.observationTracks.map(track => (
            <g key={track.observation.id}>
              <TrackHeader
                x={track.x}
                width={track.width}
                y={SVG_Y_PAD}
                title={humanizeObservationType(t, track.observation.observation_type)}
                rawToken={track.observation.observation_type}
                subtitle={[track.observation.author, track.observation.observation_date]
                  .filter(Boolean)
                  .join(' · ')}
                onHide={() => hideTrack(track.observation.observation_type as ToggleableTrackId)}
              />
              <ObservationTrack
                observation={track.observation}
                x={track.x}
                y={SVG_Y_PAD + HEADER_HEIGHT}
                width={track.width}
                totalDepth={layout.totalDepth}
              />
            </g>
          ))}

          {/* Drill method track */}
          {layout.drillMethodX != null && (
            <g>
              <TrackHeader
                x={layout.drillMethodX}
                width={DRILL_TRACK_WIDTH}
                y={SVG_Y_PAD}
                title={t('borelog.drillMethod')}
                subtitle={null}
                onHide={() => hideTrack('drill_method')}
              />
              <DrillMethodTrack
                segments={borehole.drill_segments}
                x={layout.drillMethodX}
                y={SVG_Y_PAD + HEADER_HEIGHT}
                width={DRILL_TRACK_WIDTH}
                totalDepth={layout.totalDepth}
              />
            </g>
          )}

          {/* Field log track */}
          {layout.fieldLogX != null && (
            <g>
              <TrackHeader
                x={layout.fieldLogX}
                width={FIELD_LOG_TRACK_WIDTH}
                y={SVG_Y_PAD}
                title={t('borelog.fieldLog')}
                // Column-header abbreviations (colour · moisture · consistency)
                // stay as-is — a cryptic 3-letter legend, like an axis symbol.
                subtitle="col · mst · con"
                onHide={() => hideTrack('field_log')}
              />
              <FieldLogTrack
                intervals={borehole.field_log_intervals}
                x={layout.fieldLogX}
                y={SVG_Y_PAD + HEADER_HEIGHT}
              />
            </g>
          )}

          {/* Samples track — clickable */}
          {layout.samplesX != null && (
            <g>
              <TrackHeader
                x={layout.samplesX}
                width={SAMPLES_TRACK_WIDTH}
                y={SVG_Y_PAD}
                title={t('borelog.samplesAndLabTests')}
                subtitle={t(
                  borehole.samples.length === 1
                    ? 'borelog.sampleCountOne'
                    : 'borelog.sampleCountMany',
                  { n: borehole.samples.length },
                )}
                onHide={() => hideTrack('samples_lab')}
              />
              <SamplesTrack
                samples={borehole.samples}
                x={layout.samplesX}
                y={SVG_Y_PAD + HEADER_HEIGHT}
                width={SAMPLES_TRACK_WIDTH}
                selectedSampleId={selectedSampleId}
                onSampleClick={setSelectedSampleId}
              />
            </g>
          )}

          {/* Groundwater line spanning every track */}
          {borehole.water_table_depth_m != null && layout.canvasRight > layout.canvasLeft && (
            <GroundwaterLine
              waterDepth={borehole.water_table_depth_m}
              fromX={layout.canvasLeft}
              toX={layout.canvasRight}
              y={SVG_Y_PAD + HEADER_HEIGHT}
              totalDepth={layout.totalDepth}
            />
          )}

          {/* Selected-sample depth marker — translucent yellow band
              drawn LAST so it sits on top of every track. The user can
              instantly see "you are here" while reading the lab pane,
              even when the borelog has dozens of layers and tracks.
              For spot samples (top == base) we force a 4-pixel minimum
              band height so it stays visible. */}
          {selectedSample && (
            <SelectedSampleMarker
              sample={selectedSample}
              fromX={SVG_X_PAD}
              toX={layout.canvasRight}
              y={SVG_Y_PAD + HEADER_HEIGHT}
            />
          )}

          {/* DOV Virtuele Boring ghost rail — slim labelled columns
              rendered next to the borelog's tracks, sharing the
              same depth-pixel scale (pxPerM) so layers align with
              the lithology / sample tracks pixel-for-pixel. */}
          {overlayShows && (
            <VirtueleBoringBorelogRail
              prediction={virtueleBoringPrediction}
              activeModels={virtueleBoringActiveModels}
              surfaceElevationM={borehole.elevation_m ?? null}
              maxDepthMBelowSurface={virtueleBoringMaxDepthM}
              leftX={vbRailLeftX}
              topY={SVG_Y_PAD + HEADER_HEIGHT}
              pxPerM={pxPerM}
              totalDepthM={layout.totalDepth}
            />
          )}

          {/* Faded geology + litho contact overlays — horizontal lines
              spanning the data-track area at each contact depth, in
              the formation's colour. Painted last so they sit on top
              of the soil patterns without obscuring them at the chosen
              opacity. Litho overlays are slightly more transparent
              than geology so the stratigraphic hierarchy stays
              visually distinguishable. */}
          {contactOverlays && contactOverlays.length > 0 && (
            <g data-testid="contact-overlays" aria-hidden="true">
              {contactOverlays.map(ov => {
                const y = SVG_Y_PAD + HEADER_HEIGHT + ov.depth_m * pxPerM
                const x1 = SVG_X_PAD
                const x2 = layout.totalWidth - SVG_X_PAD
                const opacity = ov.source === 'litho' ? 0.28 : 0.4
                return (
                  <g key={ov.key}>
                    <line
                      x1={x1}
                      y1={y}
                      x2={x2}
                      y2={y}
                      stroke={ov.color}
                      strokeOpacity={opacity}
                      strokeWidth={1}
                    />
                    <text
                      x={x2 - 4}
                      y={y - 2}
                      textAnchor="end"
                      fontSize={9}
                      fill={ov.color}
                      fillOpacity={0.85}
                    >
                      {ov.label}
                    </text>
                  </g>
                )
              })}
            </g>
          )}
          </svg>
        </div>

        {selectedSample && (
          <LabTestPanel
            sample={selectedSample}
            // Pass the full sibling list so the panel can nav prev/next.
            // Sorted by depth so navigation feels physical (top-to-bottom
            // through the borehole) rather than database-insertion order.
            allSamples={[...borehole.samples].sort(
              (a, b) => a.depth_top_m - b.depth_top_m,
            )}
            onSelectSample={setSelectedSampleId}
            onClose={() => setSelectedSampleId(null)}
          />
        )}
      </div>

      {projectId && <LabSeriesSection projectId={projectId} boreholeId={borehole.id} />}
      <Legend borehole={borehole} />
    </div>
    </PxPerMContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// VirtueleBoringBorelogRail — informative-only DOV overlay rendered
// inside the borelog SVG so it scrolls with the rest of the tracks.
// ---------------------------------------------------------------------------

function VirtueleBoringBorelogRail({
  prediction,
  activeModels,
  surfaceElevationM,
  maxDepthMBelowSurface,
  leftX,
  topY,
  pxPerM,
  totalDepthM,
}: {
  prediction: VirtueleBoringInvestigationPrediction | null
  activeModels: readonly string[]
  surfaceElevationM: number | null
  maxDepthMBelowSurface: number | null
  leftX: number
  topY: number
  pxPerM: number
  totalDepthM: number
}): JSX.Element | null {
  const t = useT()
  if (!prediction || surfaceElevationM === null) {
    return (
      <text x={leftX} y={topY + 12} fontSize={9} fill="#9ca3af">
        {t('borelog.noData')}
      </text>
    )
  }
  return (
    <g data-testid="virtuele-boring-borelog-rail">
      {activeModels.map((modelCode, modelIdx) => {
        const layers = prediction.predictions_by_model[modelCode]
        if (!layers || layers.length === 0) return null
        const left = leftX + modelIdx * (VB_COLUMN_WIDTH + VB_COLUMN_GAP)
        return (
          <g key={modelCode} data-testid={`vb-rail-${modelCode}`}>
            <text
              x={left + VB_COLUMN_WIDTH / 2}
              y={topY - 4}
              textAnchor="middle"
              fontSize={9}
              fill="#6b7280"
            >
              {modelCode}
            </text>
            {layers.map(layer => (
              <BorelogRailLayer
                key={`${layer.code}-${layer.top_m_taw}`}
                layer={layer}
                left={left}
                width={VB_COLUMN_WIDTH}
                surfaceElevationM={surfaceElevationM}
                topY={topY}
                pxPerM={pxPerM}
                totalDepthM={totalDepthM}
                maxDepthMBelowSurface={maxDepthMBelowSurface}
              />
            ))}
          </g>
        )
      })}
    </g>
  )
}

function BorelogRailLayer({
  layer,
  left,
  width,
  surfaceElevationM,
  topY,
  pxPerM,
  totalDepthM,
  maxDepthMBelowSurface,
}: {
  layer: VirtueleBoringLayer
  left: number
  width: number
  surfaceElevationM: number
  topY: number
  pxPerM: number
  totalDepthM: number
  maxDepthMBelowSurface: number | null
}): JSX.Element | null {
  const layerDepthTop = Math.max(0, surfaceElevationM - layer.top_m_taw)
  let layerDepthBase = surfaceElevationM - layer.base_m_taw
  if (maxDepthMBelowSurface !== null && layerDepthTop >= maxDepthMBelowSurface) {
    return null
  }
  if (maxDepthMBelowSurface !== null && layerDepthBase > maxDepthMBelowSurface) {
    layerDepthBase = maxDepthMBelowSurface
  }
  // Clip to the borelog's total depth so a much-deeper DOV layer
  // doesn't paint below the lithology tracks.
  if (layerDepthBase > totalDepthM) layerDepthBase = totalDepthM
  if (layerDepthBase <= 0 || layerDepthTop >= totalDepthM) return null
  const yTop = topY + layerDepthTop * pxPerM
  const yBase = topY + layerDepthBase * pxPerM
  const height = yBase - yTop
  if (height <= 0.3) return null
  const fill = layer.color_hex ?? '#9ca3af'
  const label = layer.beschrijving || layer.name
  const tooltip = `${label}: ${layer.top_m_taw.toFixed(2)} → ${layer.base_m_taw.toFixed(2)} mTAW (${layer.thickness_m.toFixed(2)} m)`
  const maxLines = maxLinesForHeight(height, VB_LABEL_FONT_SIZE)
  const lines = maxLines > 0
    ? wrapLabelToLines(label, maxCharsForWidth(width, VB_LABEL_FONT_SIZE), maxLines)
    : []
  const lineHeight = VB_LABEL_FONT_SIZE * 1.15
  const blockHeight = lineHeight * lines.length
  const firstBaselineY =
    yTop + height / 2 - blockHeight / 2 + VB_LABEL_FONT_SIZE * 0.8
  return (
    <g>
      <rect
        x={left}
        y={yTop}
        width={width}
        height={height}
        fill={fill}
        fillOpacity={0.55}
        stroke={fill}
        strokeOpacity={0.75}
        strokeWidth={0.5}
      >
        <title>{tooltip}</title>
      </rect>
      {lines.length > 0 && (
        <text
          x={left + width / 2}
          y={firstBaselineY}
          textAnchor="middle"
          fontSize={VB_LABEL_FONT_SIZE}
          fill="#111827"
          style={{ pointerEvents: 'none' }}
        >
          {lines.map((line, i) => (
            <tspan key={i} x={left + width / 2} dy={i === 0 ? 0 : lineHeight}>
              {line}
            </tspan>
          ))}
          <title>{tooltip}</title>
        </text>
      )}
    </g>
  )
}

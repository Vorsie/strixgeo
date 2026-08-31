// Application Settings dialog. Reached from File → Settings… (Ctrl+,).
//
// Scope mix: most settings ride in ``project.view_state`` (per-project,
// travel with the .gmproj bundle); the Appearance section is per-user
// and persists to localStorage via useTheme. Each section labels its
// scope so a colleague opening the same .gmproj knows why their theme
// didn't follow your file.
//
// Section rail: left nav of section names + right pane of controls.
// Renders one section at a time so the form fits the card without
// scrolling and the user can't accidentally edit two sections in one
// Save (each section has its own Save button that commits ONLY that
// section's diff).

import { Layers, Settings as SettingsIcon, SlidersHorizontal, Palette } from 'lucide-react'
import { useEffect, useState } from 'react'

import Button from './ui/Button'
import Modal from './ui/Modal'
import NumericInput from './ui/NumericInput'
import type { ThemeChoice } from '../hooks/useTheme'
import { LANGUAGE_LABELS, LANGUAGES, type Language } from '../i18n/i18n_constants'
import { setLanguage, useLanguage } from '../i18n/languageSelect'
import { useT } from '../i18n/translate'
import type { MessageKey } from '../i18n/locales/en'
import {
  GEOTECH_SUBDIVISION_BOUNDS,
  GEOTECH_SUBDIVISION_DEFAULTS,
  type GeotechSubdivisionPrefs,
} from '../utils/geotechSubdivisionPrefs'
import {
  LITHO_SEGMENTER_BOUNDS,
  LITHO_SEGMENTER_DEFAULTS,
  type LithoSegmenterPrefs,
} from '../utils/lithoSegmenterPrefs'
import {
  SECTION_DEFAULTS,
  SECTION_DEFAULTS_BOUNDS,
  type SectionDefaults,
} from '../utils/sectionDefaults'

type SectionKey = 'litho' | 'geotech' | 'sections' | 'appearance'

interface Props {
  open: boolean
  hasProject: boolean
  initialLithoSegmenter: LithoSegmenterPrefs
  initialGeotechSubdivision: GeotechSubdivisionPrefs
  initialSectionDefaults: SectionDefaults
  themeChoice: ThemeChoice
  onCancel: () => void
  onSubmitLithoSegmenter: (next: LithoSegmenterPrefs) => void
  onSubmitGeotechSubdivision: (next: GeotechSubdivisionPrefs) => void
  onSubmitSectionDefaults: (next: SectionDefaults) => void
  /** Per-user theme override. Persisted to localStorage by useTheme —
   *  applied immediately, no Save click needed (matches every other
   *  appearance toggle in the app: theme is reversible UI chrome). */
  onSetThemeChoice: (next: ThemeChoice) => void
}

// The rail carries message KEYS, not rendered labels — the array is module
// state, so a literal here would freeze the rail in whatever language the app
// booted in.
const SECTIONS: ReadonlyArray<{
  key: SectionKey
  labelKey: MessageKey
  icon: React.ReactNode
  scope: 'project' | 'device'
}> = [
  { key: 'litho', labelKey: 'settings.section.litho', icon: <SlidersHorizontal size={13} />, scope: 'project' },
  { key: 'geotech', labelKey: 'settings.section.geotech', icon: <SlidersHorizontal size={13} />, scope: 'project' },
  { key: 'sections', labelKey: 'settings.section.sections', icon: <Layers size={13} />, scope: 'project' },
  { key: 'appearance', labelKey: 'settings.section.appearance', icon: <Palette size={13} />, scope: 'device' },
]

export default function SettingsDialog({
  open,
  hasProject,
  initialLithoSegmenter,
  initialGeotechSubdivision,
  initialSectionDefaults,
  themeChoice,
  onCancel,
  onSubmitLithoSegmenter,
  onSubmitGeotechSubdivision,
  onSubmitSectionDefaults,
  onSetThemeChoice,
}: Props): JSX.Element | null {
  const t = useT()
  const [active, setActive] = useState<SectionKey>('litho')
  const [lithoDraft, setLithoDraft] = useState<LithoSegmenterPrefs>(initialLithoSegmenter)
  const [geotechDraft, setGeotechDraft] = useState<GeotechSubdivisionPrefs>(initialGeotechSubdivision)
  const [sectionsDraft, setSectionsDraft] = useState<SectionDefaults>(initialSectionDefaults)

  // Re-seed drafts on open so a Cancel in one session doesn't leak
  // into the next, and to reflect any outside changes (e.g. a colleague
  // patched the bundle in another window). ``active`` stays on the
  // user's last-selected tab — that's a session-scoped UI choice, not
  // tied to persisted prefs.
  useEffect(() => {
    if (open) {
      setLithoDraft(initialLithoSegmenter)
      setGeotechDraft(initialGeotechSubdivision)
      setSectionsDraft(initialSectionDefaults)
    }
  }, [open, initialLithoSegmenter, initialGeotechSubdivision, initialSectionDefaults])

  if (!open) return null

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      labelledBy="settings-title"
      cardClassName="w-[720px] max-h-[80vh] flex flex-col"
      testid="settings-dialog"
    >
      <div className="flex flex-col flex-1 min-h-0">
        <div className="px-6 pt-5 pb-3 border-b border-border-subtle flex items-center gap-2">
          <SettingsIcon size={16} className="text-text-muted" />
          <h2 id="settings-title" className="text-base font-semibold text-text-primary">
            {t('settings.title')}
          </h2>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Section rail. Each entry is a button so keyboard focus +
              Enter activate it; the active section gets a card-coloured
              background. */}
          <div
            className="w-48 border-r border-border-subtle py-3 px-2 space-y-0.5"
            role="tablist"
            aria-orientation="vertical"
          >
            {SECTIONS.map(s => {
              const selected = s.key === active
              return (
                <button
                  key={s.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActive(s.key)}
                  data-testid={`settings-section-${s.key}`}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs ${
                    selected
                      ? 'bg-surface-card text-text-primary font-medium'
                      : 'text-text-secondary hover:bg-surface-card/60'
                  }`}
                >
                  <span className="text-text-muted">{s.icon}</span>
                  {t(s.labelKey)}
                </button>
              )
            })}
          </div>

          {/* Active section body. Each branch owns its own header,
              controls and Save button. */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {active === 'litho' && (
              <LithoSection
                draft={lithoDraft}
                setDraft={setLithoDraft}
                initial={initialLithoSegmenter}
                hasProject={hasProject}
                onSubmit={() => onSubmitLithoSegmenter(lithoDraft)}
              />
            )}
            {active === 'geotech' && (
              <GeotechSection
                draft={geotechDraft}
                setDraft={setGeotechDraft}
                initial={initialGeotechSubdivision}
                hasProject={hasProject}
                onSubmit={() => onSubmitGeotechSubdivision(geotechDraft)}
              />
            )}
            {active === 'sections' && (
              <SectionsSection
                draft={sectionsDraft}
                setDraft={setSectionsDraft}
                initial={initialSectionDefaults}
                hasProject={hasProject}
                onSubmit={() => onSubmitSectionDefaults(sectionsDraft)}
              />
            )}
            {active === 'appearance' && (
              <AppearanceSection
                themeChoice={themeChoice}
                onSetThemeChoice={onSetThemeChoice}
              />
            )}
          </div>
        </div>

        <div className="px-6 py-3 border-t border-border-subtle flex items-center justify-end">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('common.close')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Litho segmenter section
// ---------------------------------------------------------------------------

function LithoSection({
  draft,
  setDraft,
  initial,
  hasProject,
  onSubmit,
}: {
  draft: LithoSegmenterPrefs
  setDraft: (next: LithoSegmenterPrefs) => void
  initial: LithoSegmenterPrefs
  hasProject: boolean
  onSubmit: () => void
}): JSX.Element {
  const t = useT()
  const thicknessBounds = LITHO_SEGMENTER_BOUNDS.minimumLayerThicknessM
  const gunsatBounds = LITHO_SEGMENTER_BOUNDS.gunsatKNm3
  const drBounds = LITHO_SEGMENTER_BOUNDS.drCompressionFactor
  const snapBounds = LITHO_SEGMENTER_BOUNDS.lithoSnapToleranceM
  const autoCorrBounds = LITHO_SEGMENTER_BOUNDS.autoCorrelateDepthWindowM
  const openLenBounds = LITHO_SEGMENTER_BOUNDS.openExtentLengthM
  const voxelHBounds = LITHO_SEGMENTER_BOUNDS.voxelHorizontalSpacingM
  const voxelVBounds = LITHO_SEGMENTER_BOUNDS.voxelVerticalSpacingM

  const thicknessValid =
    Number.isFinite(draft.minimumLayerThicknessM) &&
    draft.minimumLayerThicknessM >= thicknessBounds.min &&
    draft.minimumLayerThicknessM <= thicknessBounds.max
  const gunsatValid =
    Number.isFinite(draft.gunsatKNm3) &&
    draft.gunsatKNm3 >= gunsatBounds.min &&
    draft.gunsatKNm3 <= gunsatBounds.max
  const drValid =
    Number.isFinite(draft.drCompressionFactor) &&
    draft.drCompressionFactor >= drBounds.min &&
    draft.drCompressionFactor <= drBounds.max
  const snapValid =
    Number.isFinite(draft.lithoSnapToleranceM) &&
    draft.lithoSnapToleranceM >= snapBounds.min &&
    draft.lithoSnapToleranceM <= snapBounds.max
  const autoCorrValid =
    Number.isFinite(draft.autoCorrelateDepthWindowM) &&
    draft.autoCorrelateDepthWindowM >= autoCorrBounds.min &&
    draft.autoCorrelateDepthWindowM <= autoCorrBounds.max
  const openLenValid =
    Number.isFinite(draft.openExtentLengthM) &&
    draft.openExtentLengthM >= openLenBounds.min &&
    draft.openExtentLengthM <= openLenBounds.max
  const voxelHValid =
    Number.isFinite(draft.voxelHorizontalSpacingM) &&
    draft.voxelHorizontalSpacingM >= voxelHBounds.min &&
    draft.voxelHorizontalSpacingM <= voxelHBounds.max
  const voxelVValid =
    Number.isFinite(draft.voxelVerticalSpacingM) &&
    draft.voxelVerticalSpacingM >= voxelVBounds.min &&
    draft.voxelVerticalSpacingM <= voxelVBounds.max
  const allValid =
    thicknessValid &&
    gunsatValid &&
    drValid &&
    snapValid &&
    autoCorrValid &&
    openLenValid &&
    voxelHValid &&
    voxelVValid

  const dirty =
    draft.minimumLayerThicknessM !== initial.minimumLayerThicknessM ||
    draft.gunsatKNm3 !== initial.gunsatKNm3 ||
    draft.drCompressionFactor !== initial.drCompressionFactor ||
    draft.mergeSameLithology !== initial.mergeSameLithology ||
    draft.useNormalisedQc !== initial.useNormalisedQc ||
    draft.lithoSnapToleranceM !== initial.lithoSnapToleranceM ||
    draft.autoCorrelateDepthWindowM !== initial.autoCorrelateDepthWindowM ||
    draft.openExtentLengthM !== initial.openExtentLengthM ||
    draft.sectionFillAtSectionLine !== initial.sectionFillAtSectionLine ||
    draft.voxelHorizontalSpacingM !== initial.voxelHorizontalSpacingM ||
    draft.voxelVerticalSpacingM !== initial.voxelVerticalSpacingM

  return (
    <SectionShell
      title={t('settings.section.litho')}
      blurb={t('settings.litho.blurb')}
      scope="project"
    >
      <NumberRow
        id="settings-min-thickness"
        label={t('settings.litho.minThickness')}
        hint={t('settings.litho.minThicknessHint', {
          default: LITHO_SEGMENTER_DEFAULTS.minimumLayerThicknessM,
        })}
        value={draft.minimumLayerThicknessM}
        onChange={v => setDraft({ ...draft, minimumLayerThicknessM: v })}
        bounds={thicknessBounds}
        sliderMax={3.0}
        step={0.05}
        unit="m"
        disabled={!hasProject}
        invalid={!thicknessValid}
      />
      <NumberRow
        id="settings-gunsat"
        label={t('settings.litho.gunsat')}
        hint={t('settings.litho.gunsatHint', { default: LITHO_SEGMENTER_DEFAULTS.gunsatKNm3 })}
        value={draft.gunsatKNm3}
        onChange={v => setDraft({ ...draft, gunsatKNm3: v })}
        bounds={gunsatBounds}
        sliderMin={gunsatBounds.min}
        sliderMax={gunsatBounds.max}
        step={0.1}
        unit="kN/m³"
        disabled={!hasProject}
        invalid={!gunsatValid}
      />
      <NumberRow
        id="settings-dr-factor"
        label={t('settings.litho.drFactor')}
        hint={t('settings.litho.drFactorHint', {
          default: LITHO_SEGMENTER_DEFAULTS.drCompressionFactor,
        })}
        value={draft.drCompressionFactor}
        onChange={v => setDraft({ ...draft, drCompressionFactor: v })}
        bounds={drBounds}
        sliderMin={0.5}
        sliderMax={0.8}
        step={0.005}
        disabled={!hasProject}
        invalid={!drValid}
      />
      <CheckboxRow
        id="settings-merge-same-lithology"
        label={t('settings.litho.mergeSameLithology')}
        hint={t('settings.litho.mergeSameLithologyHint')}
        checked={draft.mergeSameLithology}
        onChange={v => setDraft({ ...draft, mergeSameLithology: v })}
        disabled={!hasProject}
      />
      <CheckboxRow
        id="settings-use-normalised-qc"
        label={t('settings.litho.normaliseQc')}
        hint={t('settings.litho.normaliseQcHint')}
        checked={draft.useNormalisedQc}
        onChange={v => setDraft({ ...draft, useNormalisedQc: v })}
        disabled={!hasProject}
      />
      <CheckboxRow
        id="settings-section-fill-at-section-line"
        label={t('settings.litho.fillAtSectionLine')}
        hint={t('settings.litho.fillAtSectionLineHint')}
        checked={draft.sectionFillAtSectionLine}
        onChange={v => setDraft({ ...draft, sectionFillAtSectionLine: v })}
        disabled={!hasProject}
      />
      <NumberRow
        id="settings-litho-snap-tolerance"
        label={t('settings.litho.snapTolerance')}
        hint={t('settings.litho.snapToleranceHint')}
        value={draft.lithoSnapToleranceM}
        onChange={v => setDraft({ ...draft, lithoSnapToleranceM: v })}
        bounds={snapBounds}
        sliderMin={snapBounds.min}
        sliderMax={1.0}
        step={0.01}
        unit="m"
        disabled={!hasProject}
        invalid={!snapValid}
      />
      <NumberRow
        id="settings-auto-correlate-depth-window"
        label={t('settings.litho.autoCorrelateWindow')}
        hint={t('settings.litho.autoCorrelateWindowHint', {
          min: autoCorrBounds.min,
          max: autoCorrBounds.max,
          default: LITHO_SEGMENTER_DEFAULTS.autoCorrelateDepthWindowM,
        })}
        value={draft.autoCorrelateDepthWindowM}
        onChange={v => setDraft({ ...draft, autoCorrelateDepthWindowM: v })}
        bounds={autoCorrBounds}
        sliderMin={autoCorrBounds.min}
        sliderMax={2.0}
        step={0.05}
        unit="m"
        disabled={!hasProject}
        invalid={!autoCorrValid}
      />
      <NumberRow
        id="settings-open-extent-length"
        label={t('settings.litho.openExtentLength')}
        hint={t('settings.litho.openExtentLengthHint', {
          min: openLenBounds.min,
          max: openLenBounds.max,
          default: LITHO_SEGMENTER_DEFAULTS.openExtentLengthM,
        })}
        value={draft.openExtentLengthM}
        onChange={v => setDraft({ ...draft, openExtentLengthM: v })}
        bounds={openLenBounds}
        sliderMin={openLenBounds.min}
        sliderMax={openLenBounds.max}
        step={0.5}
        unit="m"
        disabled={!hasProject}
        invalid={!openLenValid}
      />

      {/* Voxel size — the cell dimensions the "Build model" voxel builder labels
          space at. A separate X/Y vs Z knob because geology is thin-layered
          vertically: a fine Z over a coarse X/Y catches thin layers without
          exploding the map-plane voxel count. */}
      <div className="pt-1">
        <h4 className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">
          {t('settings.litho.voxelHeading')}
        </h4>
        <p className="text-[11px] text-text-muted mt-0.5 leading-snug">
          {t('settings.litho.voxelBlurb')}
        </p>
      </div>
      <NumberRow
        id="settings-voxel-horizontal"
        label={t('settings.litho.voxelHorizontal')}
        hint={t('settings.litho.voxelHorizontalHint', {
          min: voxelHBounds.min,
          max: voxelHBounds.max,
          default: LITHO_SEGMENTER_DEFAULTS.voxelHorizontalSpacingM,
        })}
        value={draft.voxelHorizontalSpacingM}
        onChange={v => setDraft({ ...draft, voxelHorizontalSpacingM: v })}
        bounds={voxelHBounds}
        sliderMin={voxelHBounds.min}
        sliderMax={voxelHBounds.max}
        step={0.5}
        unit="m"
        disabled={!hasProject}
        invalid={!voxelHValid}
      />
      <NumberRow
        id="settings-voxel-vertical"
        label={t('settings.litho.voxelVertical')}
        hint={t('settings.litho.voxelVerticalHint', {
          min: voxelVBounds.min,
          max: voxelVBounds.max,
          default: LITHO_SEGMENTER_DEFAULTS.voxelVerticalSpacingM,
        })}
        value={draft.voxelVerticalSpacingM}
        onChange={v => setDraft({ ...draft, voxelVerticalSpacingM: v })}
        bounds={voxelVBounds}
        sliderMin={voxelVBounds.min}
        sliderMax={voxelVBounds.max}
        step={0.25}
        unit="m"
        disabled={!hasProject}
        invalid={!voxelVValid}
      />

      <SectionFooter
        hasProject={hasProject}
        dirty={dirty}
        allValid={allValid}
        onReset={() => setDraft({ ...LITHO_SEGMENTER_DEFAULTS })}
        onSubmit={onSubmit}
      />
    </SectionShell>
  )
}

// ---------------------------------------------------------------------------
// Geotechnical subdivision section
// ---------------------------------------------------------------------------

/**
 * Settings section for the geotech NAD subdivision ("Subdivide all bodies").
 *
 * Exposes the min-thickness knob, the gradient-snap toggle, and — only when snap
 * is enabled — the snap window. Exported so the conditional Save-validity logic
 * (`allValid` short-circuits the snap-window check when snap is off) can be unit
 * tested directly without driving the whole dialog.
 */
export function GeotechSection({
  draft,
  setDraft,
  initial,
  hasProject,
  onSubmit,
}: {
  draft: GeotechSubdivisionPrefs
  setDraft: (next: GeotechSubdivisionPrefs) => void
  initial: GeotechSubdivisionPrefs
  hasProject: boolean
  onSubmit: () => void
}): JSX.Element {
  const t = useT()
  const thicknessBounds = GEOTECH_SUBDIVISION_BOUNDS.minimumLayerThicknessM
  const snapWindowBounds = GEOTECH_SUBDIVISION_BOUNDS.gradientSnapWindowM

  const thicknessValid =
    Number.isFinite(draft.minimumLayerThicknessM) &&
    draft.minimumLayerThicknessM >= thicknessBounds.min &&
    draft.minimumLayerThicknessM <= thicknessBounds.max
  const snapWindowValid =
    Number.isFinite(draft.gradientSnapWindowM) &&
    draft.gradientSnapWindowM >= snapWindowBounds.min &&
    draft.gradientSnapWindowM <= snapWindowBounds.max

  const allValid = thicknessValid && (!draft.gradientSnapEnabled || snapWindowValid)

  const dirty =
    draft.minimumLayerThicknessM !== initial.minimumLayerThicknessM ||
    draft.gradientSnapEnabled !== initial.gradientSnapEnabled ||
    draft.gradientSnapWindowM !== initial.gradientSnapWindowM

  return (
    <SectionShell
      title={t('settings.section.geotech')}
      blurb={t('settings.geotech.blurb')}
      scope="project"
    >
      <NumberRow
        id="settings-geotech-min-thickness"
        label={t('settings.geotech.minThickness')}
        hint={t('settings.geotech.minThicknessHint', {
          min: thicknessBounds.min,
          max: thicknessBounds.max,
          default: GEOTECH_SUBDIVISION_DEFAULTS.minimumLayerThicknessM,
        })}
        value={draft.minimumLayerThicknessM}
        onChange={v => setDraft({ ...draft, minimumLayerThicknessM: v })}
        bounds={thicknessBounds}
        sliderMin={thicknessBounds.min}
        sliderMax={thicknessBounds.max}
        step={0.05}
        unit="m"
        disabled={!hasProject}
        invalid={!thicknessValid}
      />
      <CheckboxRow
        id="settings-geotech-gradient-snap"
        label={t('settings.geotech.gradientSnap')}
        hint={t('settings.geotech.gradientSnapHint')}
        checked={draft.gradientSnapEnabled}
        onChange={v => setDraft({ ...draft, gradientSnapEnabled: v })}
        disabled={!hasProject}
      />
      {draft.gradientSnapEnabled && (
        <NumberRow
          id="settings-geotech-gradient-snap-window"
          label={t('settings.geotech.gradientSnapWindow')}
          hint={t('settings.geotech.gradientSnapWindowHint', {
            min: snapWindowBounds.min,
            max: snapWindowBounds.max,
            default: GEOTECH_SUBDIVISION_DEFAULTS.gradientSnapWindowM,
          })}
          value={draft.gradientSnapWindowM}
          onChange={v => setDraft({ ...draft, gradientSnapWindowM: v })}
          bounds={snapWindowBounds}
          sliderMin={snapWindowBounds.min}
          sliderMax={snapWindowBounds.max}
          step={0.05}
          unit="m"
          disabled={!hasProject}
          invalid={!snapWindowValid}
        />
      )}

      <SectionFooter
        hasProject={hasProject}
        dirty={dirty}
        allValid={allValid}
        onReset={() => setDraft({ ...GEOTECH_SUBDIVISION_DEFAULTS })}
        onSubmit={onSubmit}
      />
    </SectionShell>
  )
}

// ---------------------------------------------------------------------------
// Cross-sections section
// ---------------------------------------------------------------------------

function SectionsSection({
  draft,
  setDraft,
  initial,
  hasProject,
  onSubmit,
}: {
  draft: SectionDefaults
  setDraft: (next: SectionDefaults) => void
  initial: SectionDefaults
  hasProject: boolean
  onSubmit: () => void
}): JSX.Element {
  const t = useT()
  const bufferBounds = SECTION_DEFAULTS_BOUNDS.bufferM
  const vexBounds = SECTION_DEFAULTS_BOUNDS.verticalExaggeration
  const tieBounds = SECTION_DEFAULTS_BOUNDS.tieStrikeToleranceM

  const bufferValid =
    Number.isFinite(draft.bufferM) &&
    draft.bufferM >= bufferBounds.min &&
    draft.bufferM <= bufferBounds.max
  const vexValid =
    Number.isFinite(draft.verticalExaggeration) &&
    draft.verticalExaggeration >= vexBounds.min &&
    draft.verticalExaggeration <= vexBounds.max
  const tieValid =
    Number.isFinite(draft.tieStrikeToleranceM) &&
    draft.tieStrikeToleranceM >= tieBounds.min &&
    draft.tieStrikeToleranceM <= tieBounds.max

  const dirty =
    draft.bufferM !== initial.bufferM ||
    draft.verticalExaggeration !== initial.verticalExaggeration ||
    draft.tieStrikeToleranceM !== initial.tieStrikeToleranceM

  return (
    <SectionShell
      title={t('settings.section.sections')}
      blurb={t('settings.sections.blurb')}
      scope="project"
    >
      <NumberRow
        id="settings-section-buffer"
        label={t('settings.sections.buffer')}
        hint={t('settings.sections.bufferHint', { default: SECTION_DEFAULTS.bufferM })}
        value={draft.bufferM}
        onChange={v => setDraft({ ...draft, bufferM: v })}
        bounds={bufferBounds}
        sliderMin={1}
        sliderMax={200}
        step={1}
        unit="m"
        disabled={!hasProject}
        invalid={!bufferValid}
      />
      <NumberRow
        id="settings-section-vex"
        label={t('settings.sections.vex')}
        hint={t('settings.sections.vexHint', {
          default: SECTION_DEFAULTS.verticalExaggeration,
        })}
        value={draft.verticalExaggeration}
        onChange={v => setDraft({ ...draft, verticalExaggeration: v })}
        bounds={vexBounds}
        sliderMin={1}
        sliderMax={10}
        step={0.1}
        unit="×"
        disabled={!hasProject}
        invalid={!vexValid}
      />
      <NumberRow
        id="settings-section-tie-strike-tolerance"
        label={t('settings.sections.tieTolerance')}
        hint={t('settings.sections.tieToleranceHint')}
        value={draft.tieStrikeToleranceM}
        onChange={v => setDraft({ ...draft, tieStrikeToleranceM: v })}
        bounds={tieBounds}
        sliderMin={tieBounds.min}
        sliderMax={200}
        step={1}
        unit="m"
        disabled={!hasProject}
        invalid={!tieValid}
      />

      <SectionFooter
        hasProject={hasProject}
        dirty={dirty}
        allValid={bufferValid && vexValid && tieValid}
        onReset={() => setDraft({ ...SECTION_DEFAULTS })}
        onSubmit={onSubmit}
      />
    </SectionShell>
  )
}

// ---------------------------------------------------------------------------
// Appearance section
// ---------------------------------------------------------------------------

function AppearanceSection({
  themeChoice,
  onSetThemeChoice,
}: {
  themeChoice: ThemeChoice
  onSetThemeChoice: (next: ThemeChoice) => void
}): JSX.Element {
  const t = useT()
  // Device-local language pref. Read as a hook (not a prop) for the same reason
  // as the partition-engine toggle above: it is reversible chrome that applies
  // immediately with no Save step, and threading it through App would touch a
  // component this change has no other business in.
  const language = useLanguage()

  return (
    <SectionShell
      title={t('settings.section.appearance')}
      blurb={t('settings.appearance.blurb')}
      scope="device"
    >
      <div>
        <label
          htmlFor="settings-language"
          className="block text-[11px] font-medium text-text-secondary mb-1"
        >
          {t('settings.appearance.language')}
        </label>
        <div className="flex items-center gap-3">
          <select
            id="settings-language"
            data-testid="settings-language"
            value={language}
            onChange={e => setLanguage(e.target.value as Language)}
            className="w-44 border border-border-default rounded px-2 py-1 text-sm bg-surface-overlay text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
          >
            {/* Every language is offered in its OWN language: a Dutch speaker
                scans for "Nederlands", not for "Dutch". */}
            {LANGUAGES.map(code => (
              <option key={code} value={code}>
                {LANGUAGE_LABELS[code]}
              </option>
            ))}
          </select>
        </div>
        <p className="text-[11px] text-text-muted mt-1.5 leading-snug">
          {t('settings.appearance.languageHint')}
        </p>
      </div>

      <div>
        <label
          htmlFor="settings-theme"
          className="block text-[11px] font-medium text-text-secondary mb-1"
        >
          {t('settings.appearance.theme')}
        </label>
        <div className="flex items-center gap-3">
          <select
            id="settings-theme"
            value={themeChoice}
            onChange={e => onSetThemeChoice(e.target.value as ThemeChoice)}
            className="w-44 border border-border-default rounded px-2 py-1 text-sm bg-surface-overlay text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="system">{t('settings.appearance.themeSystem')}</option>
            <option value="light">{t('settings.appearance.themeLight')}</option>
            <option value="dark">{t('settings.appearance.themeDark')}</option>
          </select>
        </div>
        <p className="text-[11px] text-text-muted mt-1.5 leading-snug">
          {t('settings.appearance.themeHint')}
        </p>
      </div>
    </SectionShell>
  )
}

// ---------------------------------------------------------------------------
// Shared section primitives
// ---------------------------------------------------------------------------

function SectionShell({
  title,
  blurb,
  scope,
  children,
}: {
  title: string
  blurb: string
  scope: 'project' | 'device'
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          <ScopeBadge scope={scope} />
        </div>
        <p className="text-xs text-text-muted mt-0.5">{blurb}</p>
      </div>
      {children}
    </div>
  )
}

function ScopeBadge({ scope }: { scope: 'project' | 'device' }): JSX.Element {
  // Subtle inline label so the user can see at a glance whether a
  // section travels with the .gmproj or stays on this machine. Uses
  // muted colours so it doesn't compete with the section title.
  const t = useT()
  const label = t(scope === 'project' ? 'settings.scope.project' : 'settings.scope.device')
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded border border-border-subtle text-text-muted">
      {label}
    </span>
  )
}

function SectionFooter({
  hasProject,
  dirty,
  allValid,
  onReset,
  onSubmit,
}: {
  hasProject: boolean
  dirty: boolean
  allValid: boolean
  onReset: () => void
  onSubmit: () => void
}): JSX.Element {
  const t = useT()
  return (
    <>
      {!hasProject && (
        <p className="text-[11px] text-status-amber">{t('settings.needProject')}</p>
      )}
      <div className="pt-2 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onReset} disabled={!hasProject}>
          {t('settings.resetDefaults')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onSubmit}
          disabled={!dirty || !allValid || !hasProject}
          data-testid="settings-save-button"
        >
          {t('common.save')}
        </Button>
      </div>
    </>
  )
}

function NumberRow({
  id,
  label,
  hint,
  value,
  onChange,
  bounds,
  sliderMin,
  sliderMax,
  step,
  unit,
  disabled,
  invalid,
}: {
  id: string
  label: string
  hint: string
  value: number
  onChange: (next: number) => void
  bounds: { min: number; max: number }
  /** Slider range — usually narrower than the input bounds so the
   *  slider stays useful for the common range while the input allows
   *  the full backend range. */
  sliderMin?: number
  sliderMax: number
  step: number
  unit?: string
  disabled?: boolean
  invalid?: boolean
}): JSX.Element {
  const t = useT()
  const sMin = sliderMin ?? bounds.min
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[11px] font-medium text-text-secondary mb-1"
      >
        {label}
      </label>
      <div className="flex items-center gap-3">
        <input
          id={`${id}-slider`}
          type="range"
          min={sMin}
          max={sliderMax}
          step={step}
          value={Math.min(Math.max(value, sMin), sliderMax)}
          onChange={e => onChange(Number(e.target.value))}
          disabled={disabled}
          className="flex-1 accent-accent"
          aria-label={t('settings.sliderLabel', { label })}
        />
        {/* Locale-tolerant numeric box — accepts BOTH ``,`` and ``.``
            as decimal separator, blocks letters/symbols at the keydown
            level. See ``NumericInput.tsx`` for why we don't use
            ``type=number``. Out-of-range values still land in the
            controlled draft so the user can clear + retype; the
            invalid flag (driven by the section's Save-validation
            gate) paints the red border. */}
        <NumericInput
          id={id}
          value={value}
          onChange={onChange}
          disabled={disabled}
          invalid={invalid}
          aria-label={label}
          className={`w-24 border rounded px-2 py-1 text-sm bg-surface-overlay text-text-primary focus:outline-none focus:ring-2 focus:ring-accent ${
            invalid ? 'border-status-danger' : 'border-border-default'
          }`}
        />
        {unit && <span className="text-xs text-text-muted w-10">{unit}</span>}
      </div>
      <p className="text-[11px] text-text-muted mt-1.5 leading-snug">{hint}</p>
    </div>
  )
}

function CheckboxRow({
  id,
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  id: string
  label: string
  hint: string
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}): JSX.Element {
  return (
    <div>
      <label
        htmlFor={id}
        className={`flex items-center gap-2 cursor-pointer select-none ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <input
          id={id}
          data-testid={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={e => onChange(e.target.checked)}
          className="rounded accent-accent"
        />
        <span className="text-[11px] font-medium text-text-secondary">{label}</span>
      </label>
      <p className="text-[11px] text-text-muted mt-1.5 leading-snug ml-6">{hint}</p>
    </div>
  )
}

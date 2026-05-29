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

type SectionKey = 'litho' | 'sections' | 'appearance'

interface Props {
  open: boolean
  hasProject: boolean
  initialLithoSegmenter: LithoSegmenterPrefs
  initialSectionDefaults: SectionDefaults
  themeChoice: ThemeChoice
  onCancel: () => void
  onSubmitLithoSegmenter: (next: LithoSegmenterPrefs) => void
  onSubmitSectionDefaults: (next: SectionDefaults) => void
  /** Per-user theme override. Persisted to localStorage by useTheme —
   *  applied immediately, no Save click needed (matches every other
   *  appearance toggle in the app: theme is reversible UI chrome). */
  onSetThemeChoice: (next: ThemeChoice) => void
}

const SECTIONS: ReadonlyArray<{
  key: SectionKey
  label: string
  icon: React.ReactNode
  scope: 'project' | 'device'
}> = [
  { key: 'litho', label: 'Litho segmenter', icon: <SlidersHorizontal size={13} />, scope: 'project' },
  { key: 'sections', label: 'Cross-sections', icon: <Layers size={13} />, scope: 'project' },
  { key: 'appearance', label: 'Appearance', icon: <Palette size={13} />, scope: 'device' },
]

export default function SettingsDialog({
  open,
  hasProject,
  initialLithoSegmenter,
  initialSectionDefaults,
  themeChoice,
  onCancel,
  onSubmitLithoSegmenter,
  onSubmitSectionDefaults,
  onSetThemeChoice,
}: Props): JSX.Element | null {
  const [active, setActive] = useState<SectionKey>('litho')
  const [lithoDraft, setLithoDraft] = useState<LithoSegmenterPrefs>(initialLithoSegmenter)
  const [sectionsDraft, setSectionsDraft] = useState<SectionDefaults>(initialSectionDefaults)

  // Re-seed drafts on open so a Cancel in one session doesn't leak
  // into the next, and to reflect any outside changes (e.g. a colleague
  // patched the bundle in another window). ``active`` stays on the
  // user's last-selected tab — that's a session-scoped UI choice, not
  // tied to persisted prefs.
  useEffect(() => {
    if (open) {
      setLithoDraft(initialLithoSegmenter)
      setSectionsDraft(initialSectionDefaults)
    }
  }, [open, initialLithoSegmenter, initialSectionDefaults])

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
            Settings
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
                  {s.label}
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
            Close
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
  const thicknessBounds = LITHO_SEGMENTER_BOUNDS.minimumLayerThicknessM
  const gunsatBounds = LITHO_SEGMENTER_BOUNDS.gunsatKNm3
  const drBounds = LITHO_SEGMENTER_BOUNDS.drCompressionFactor
  const snapBounds = LITHO_SEGMENTER_BOUNDS.lithoSnapToleranceM
  const straddleBounds = LITHO_SEGMENTER_BOUNDS.straddleMinPieceThicknessM
  const autoCorrBounds = LITHO_SEGMENTER_BOUNDS.autoCorrelateDepthWindowM
  const lensBounds = LITHO_SEGMENTER_BOUNDS.maxLensThicknessM

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
  const straddleValid =
    Number.isFinite(draft.straddleMinPieceThicknessM) &&
    draft.straddleMinPieceThicknessM >= straddleBounds.min &&
    draft.straddleMinPieceThicknessM <= straddleBounds.max
  const autoCorrValid =
    Number.isFinite(draft.autoCorrelateDepthWindowM) &&
    draft.autoCorrelateDepthWindowM >= autoCorrBounds.min &&
    draft.autoCorrelateDepthWindowM <= autoCorrBounds.max
  const lensValid =
    Number.isFinite(draft.maxLensThicknessM) &&
    draft.maxLensThicknessM >= lensBounds.min &&
    draft.maxLensThicknessM <= lensBounds.max
  const allValid =
    thicknessValid &&
    gunsatValid &&
    drValid &&
    snapValid &&
    straddleValid &&
    autoCorrValid &&
    lensValid

  const dirty =
    draft.minimumLayerThicknessM !== initial.minimumLayerThicknessM ||
    draft.gunsatKNm3 !== initial.gunsatKNm3 ||
    draft.drCompressionFactor !== initial.drCompressionFactor ||
    draft.mergeSameLithology !== initial.mergeSameLithology ||
    draft.lithoSnapToleranceM !== initial.lithoSnapToleranceM ||
    draft.straddleMinPieceThicknessM !== initial.straddleMinPieceThicknessM ||
    draft.autoCorrelateDepthWindowM !== initial.autoCorrelateDepthWindowM ||
    draft.maxLensThicknessM !== initial.maxLensThicknessM

  return (
    <SectionShell
      title="Litho segmenter"
      blurb="Tuning for the Suggest verb on the Litho axis. Applies to the next Suggest call; already-accepted units are unchanged."
      scope="project"
    >
      <NumberRow
        id="settings-min-thickness"
        label="Minimum layer thickness (m)"
        hint={`Layers thinner than this are merged into their neighbour, regardless of lithology. Lower values catch thin clay drapes; higher values produce a coarser column. Composes with the "Merge same-lithology layers" toggle below — thickness merging runs first, then same-lithology merging. Default ${LITHO_SEGMENTER_DEFAULTS.minimumLayerThicknessM} m.`}
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
        label="Soil unit weight above water (kN/m³)"
        hint={`Used to compute σ'v above the water table, which feeds the Robertson Ic and sand Dr. Site-wide for now: peat ~12, sand ~18, dense Quaternary ~19. Per-soil γ is a future enhancement. Default ${LITHO_SEGMENTER_DEFAULTS.gunsatKNm3}.`}
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
        label="Sand Dr compression factor"
        hint={`Jamiolkowski compression factor in the relative-density correlation. 0.675 = average quartz; lower for calcareous sands, higher for crushable feldspar. Most engineers leave this alone. Default ${LITHO_SEGMENTER_DEFAULTS.drCompressionFactor}.`}
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
        label="Merge same-lithology layers"
        hint="Adjacent splits that share lithology (sand-on-sand, etc.) are absorbed into one. Packing-density splits will return as suggestions in the Geotech stage when it ships."
        checked={draft.mergeSameLithology}
        onChange={v => setDraft({ ...draft, mergeSameLithology: v })}
        disabled={!hasProject}
      />
      <NumberRow
        id="settings-litho-snap-tolerance"
        label="Litho↔geology snap (m)"
        hint={`Litho and geological boundaries within this distance are treated as the same surface — linked and snapped together, so moving one moves the other (#162). Also drives the drag-snap prompt (#134). Range 0.01–5.0 m.`}
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
        id="settings-straddle-min-piece-thickness"
        label="Sliver guard (m)"
        hint={`Litho boundaries within this distance of a geological boundary aren't split — suppresses thin sliver units on accept (#157). A suggestion whose top or base lands closer than this threshold to a formation contact is treated as touching the contact rather than straddling it. Range ${straddleBounds.min}–${straddleBounds.max} m. Default ${LITHO_SEGMENTER_DEFAULTS.straddleMinPieceThicknessM} m.`}
        value={draft.straddleMinPieceThicknessM}
        onChange={v => setDraft({ ...draft, straddleMinPieceThicknessM: v })}
        bounds={straddleBounds}
        sliderMin={straddleBounds.min}
        sliderMax={1.0}
        step={0.01}
        unit="m"
        disabled={!hasProject}
        invalid={!straddleValid}
      />
      <NumberRow
        id="settings-auto-correlate-depth-window"
        label="Auto-correlate depth window (m)"
        hint={`How far apart in depth two contacts on neighbouring tests may be and still auto-correlate (relaxed further by horizontal distance). Widen it to catch correlations across dipping beds; narrow it to reject loose matches. Auto-correlate only ever links adjacent tests, never across an intervening one. Range ${autoCorrBounds.min}–${autoCorrBounds.max} m. Default ${LITHO_SEGMENTER_DEFAULTS.autoCorrelateDepthWindowM} m.`}
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
        id="settings-max-lens-thickness"
        label="Lens max thickness (m)"
        hint={`Degeneracy guard for lens detection. A detected lens thicker than this is rejected as spurious — a near-whole-column "lens" born from a loose correlation, not a real thin enclosed body. Set to 0 to turn the guard OFF. Range ${lensBounds.min}–${lensBounds.max} m. Default ${LITHO_SEGMENTER_DEFAULTS.maxLensThicknessM} m.`}
        value={draft.maxLensThicknessM}
        onChange={v => setDraft({ ...draft, maxLensThicknessM: v })}
        bounds={lensBounds}
        sliderMin={lensBounds.min}
        sliderMax={lensBounds.max}
        step={0.5}
        unit="m"
        disabled={!hasProject}
        invalid={!lensValid}
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
  const bufferBounds = SECTION_DEFAULTS_BOUNDS.bufferM
  const vexBounds = SECTION_DEFAULTS_BOUNDS.verticalExaggeration

  const bufferValid =
    Number.isFinite(draft.bufferM) &&
    draft.bufferM >= bufferBounds.min &&
    draft.bufferM <= bufferBounds.max
  const vexValid =
    Number.isFinite(draft.verticalExaggeration) &&
    draft.verticalExaggeration >= vexBounds.min &&
    draft.verticalExaggeration <= vexBounds.max

  const dirty =
    draft.bufferM !== initial.bufferM ||
    draft.verticalExaggeration !== initial.verticalExaggeration

  return (
    <SectionShell
      title="Cross-sections"
      blurb="Defaults applied when you draw a new cross-section. Existing sections keep whatever they were created with — change those on the section header."
      scope="project"
    >
      <NumberRow
        id="settings-section-buffer"
        label="Default projection buffer (m)"
        hint={`Half-width of the corridor around the section line; investigations within ±buffer get projected onto the section. Tight foundation footprints ~15 m, harbour studies 50-100 m. Default ${SECTION_DEFAULTS.bufferM} m.`}
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
        label="Default vertical exaggeration"
        hint={`Vertical-to-horizontal scale ratio. 1× is geometrically honest; 2-5× makes thin layers legible at regional scale. Default ${SECTION_DEFAULTS.verticalExaggeration}×.`}
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

      <SectionFooter
        hasProject={hasProject}
        dirty={dirty}
        allValid={bufferValid && vexValid}
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
  return (
    <SectionShell
      title="Appearance"
      blurb="Per-device preferences. These stay on this machine and do NOT travel with the .gmproj bundle."
      scope="device"
    >
      <div>
        <label
          htmlFor="settings-theme"
          className="block text-[11px] font-medium text-text-secondary mb-1"
        >
          Theme
        </label>
        <div className="flex items-center gap-3">
          <select
            id="settings-theme"
            value={themeChoice}
            onChange={e => onSetThemeChoice(e.target.value as ThemeChoice)}
            className="w-44 border border-border-default rounded px-2 py-1 text-sm bg-surface-overlay text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="system">System (follow OS)</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
        <p className="text-[11px] text-text-muted mt-1.5 leading-snug">
          System follows the OS preference and updates live when you flip
          Windows/macOS dark mode. Override here to pin the theme.
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
  const label =
    scope === 'project' ? 'Stored in this project' : 'Stored on this device'
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
  return (
    <>
      {!hasProject && (
        <p className="text-[11px] text-status-amber">
          Open or create a project to change these settings.
        </p>
      )}
      <div className="pt-2 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onReset} disabled={!hasProject}>
          Reset to defaults
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onSubmit}
          disabled={!dirty || !allValid || !hasProject}
          data-testid="settings-save-button"
        >
          Save
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
          aria-label={`${label} slider`}
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

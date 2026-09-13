/**
 * Modal editor for a single ghost-suggestion's composition (debt #72).
 *
 * Lets the engineer change a ghost litho layer's MAIN SOIL CODE and/or
 * its admixture list BEFORE accepting the suggestion. Lives next to
 * ``LithoCompositionPickerDialog`` — same vocabulary (constants from
 * the picker module), simpler shape: no tabs, no "existing units"
 * picker, no server interaction. Save returns the composition to the
 * caller; the caller stashes it on the suggestion's edits Map entry
 * and accept commits with the new values.
 *
 * Why a separate component instead of reusing the picker dialog: the
 * picker is built around the manual-create flow (Tab 1 picks an
 * existing unit; Tab 2 creates a new formation on the server). Ghost
 * composition edit is local-state only — no formation create, no
 * existing-unit pick. Reusing the picker would require an editMode
 * branch that hides Tab 1 + swaps the Save handler — more prop
 * surface than this dedicated editor's ~150 LOC.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'

import Modal from '../ui/Modal'
import Button from '../ui/Button'
import Select from '../ui/Select'
import {
  admixtureAmountOptions,
  admixtureSoilAdjective,
  admixtureSoilOptions,
  lithoBaseLabel,
  lithoDisplayName,
} from '../../utils/lithoLabels'
import { useT } from '../../i18n/translate'
import { useLanguage } from '../../i18n/languageSelect'

// Vocabulary mirrors LithoCompositionPickerDialog. Base-lithology labels
// share a single source of truth (utils/lithoConstants.LITHOLOGY_LABELS)
// so the picker and the editor cannot drift on naming. Admixture
// dropdown options now come from ``utils/lithoLabels`` so the picker,
// the editor, and the formatter share one curated vocabulary — fixes
// the 2026-05-21 dogfeed bug where a stored ``soil_code='OM'`` rendered
// as "Gravel (GL)" in the dropdown because OM wasn't in the option list.
const MAIN_SOIL_CODES = ['GRIND', 'ZAND', 'SILT', 'KLEI', 'VEEN'] as const
type MainSoilCode = (typeof MAIN_SOIL_CODES)[number]

export interface GhostAdmixtureItem {
  soil_code: string
  amount: string
  locally: boolean
}

interface AdmixtureRow extends GhostAdmixtureItem {
  /** Stable React key for the row across re-renders. */
  id: number
}

export interface LithoGhostCompositionEditorProps {
  open: boolean
  /** Initial main soil code; defaults to ZAND when not in the enum. */
  initialMainSoilCode: string
  /** Initial admixture list; cloned at open time so external mutations don't bleed in. */
  initialAdmixtures: readonly GhostAdmixtureItem[]
  /**
   * When true the main-soil ``<select>`` is disabled.  Used when the editor
   * is opened for a whole correlated body — the body's lithology is fixed by
   * the correlation group; only admixtures may change.  Absent / false = the
   * normal ghost-suggestion editing flow where the engineer may also change
   * the main soil code.
   */
  mainSoilLocked?: boolean
  /**
   * Called when the user clicks Save. The caller stashes the result
   * on the suggestion's edits Map entry; the modal does NOT close
   * itself — the caller decides (matches the picker dialog's
   * pattern, lets the caller batch state updates).
   */
  onSave: (
    mainSoilCode: string,
    admixtures: GhostAdmixtureItem[],
  ) => void
  /** Cancel / Esc / backdrop click — the modal closes via the parent. */
  onCancel: () => void
}

export default function LithoGhostCompositionEditor({
  open,
  initialMainSoilCode,
  initialAdmixtures,
  mainSoilLocked = false,
  onSave,
  onCancel,
}: LithoGhostCompositionEditorProps): JSX.Element | null {
  const t = useT()
  // The active language, subscribed so the dropdowns re-render on a language
  // flip. The admixture soil / amount options are localised at the presentation
  // boundary (owner ruling 2026-09-06): the raw DOV code is the option value,
  // the label follows the UI language, and the raw token is the option tooltip.
  const language = useLanguage()
  const soilOptionsBase = admixtureSoilOptions(language)
  const amountOptionsBase = admixtureAmountOptions(language)
  // Normalise the incoming main soil code — segmenter SHOULD send a
  // BaseLithology token but a defensive fallback keeps the dialog
  // openable even on stale / unknown values.
  const initialNormalised: MainSoilCode = useMemo(() => {
    return (MAIN_SOIL_CODES as readonly string[]).includes(initialMainSoilCode)
      ? (initialMainSoilCode as MainSoilCode)
      : 'ZAND'
  }, [initialMainSoilCode])

  const [mainCode, setMainCode] = useState<MainSoilCode>(initialNormalised)
  const [rows, setRows] = useState<AdmixtureRow[]>(() =>
    initialAdmixtures.map((a, i) => ({
      id: i,
      soil_code: a.soil_code,
      amount: a.amount,
      locally: a.locally,
    })),
  )
  const nextRowIdRef = useRef(initialAdmixtures.length)
  // Tracks whether the dialog was open on the previous render so we
  // can detect the false→true transition (the moment to seed state)
  // without re-firing on every parent re-render. Dogfeed bug
  // 2026-05-20: the parent's ghost columns pass `initialAdmixtures`
  // through an inline `.map(...)` so the prop is a new array on
  // every render; a naive `[open, initialAdmixtures]` dep array
  // reset the rows mid-edit, wiping any admixture the user just
  // added — including the dropdown selection they were about to
  // change. Open-transition gating fixes that without losing the
  // "seed when reopened for a different ghost layer" requirement.
  const wasOpenRef = useRef(false)
  // Initial focus goes to CANCEL, never to the main-soil control. The Modal
  // otherwise focuses its first control, which is that soil picker; when it was
  // a native <select>, one ArrowUp on it moved from Sand to Gravel (the option
  // right above it), so a stray key meant for the canvas rewrote a sand piece on
  // 1411-GEO-23/126-B4 as GRIND (owner 2026-09-10: "there is no gravel in that
  // project"). The picker is now an in-app listbox (owner #35) whose closed
  // trigger ignores arrow keys, but the rule stands: a dialog's initial focus is
  // a button, never a value control. Child effects run before the Modal's own
  // focus effect, which then sees focus already inside the card and leaves it
  // alone — the same pre-focus contract ConfirmDialog uses for its Cancel.
  const footerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    footerRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
  }, [open])

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      // false → true transition: seed from the just-passed props.
      // We DELIBERATELY read initialNormalised / initialAdmixtures
      // off the closure at this exact tick — that captures the
      // intended seed for this open-cycle. Any subsequent prop
      // identity changes while open stays true are ignored (the
      // user is mid-edit, their state is the source of truth).
      setMainCode(initialNormalised)
      setRows(
        initialAdmixtures.map((a, i) => ({
          id: i,
          soil_code: a.soil_code,
          amount: a.amount,
          locally: a.locally,
        })),
      )
      nextRowIdRef.current = initialAdmixtures.length
    }
    wasOpenRef.current = open
    // reason: prop-identity deps (initialNormalised / initialAdmixtures)
    // would re-fire this effect on every parent re-render and clobber
    // in-progress edits — the dogfeed bug. The wasOpenRef gate is the
    // correct seeding trigger (false→true transition only), so reading
    // the props off the closure inside the if is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function addAdmixtureRow(): void {
    const id = nextRowIdRef.current++
    // Seed with the first curated soil code (language-independent, the code is
    // the option VALUE, not its label).
    setRows(prev => [
      ...prev,
      { id, soil_code: soilOptionsBase[0].code, amount: '', locally: false },
    ])
  }
  function removeAdmixtureRow(id: number): void {
    setRows(prev => prev.filter(r => r.id !== id))
  }
  function updateRow(id: number, patch: Partial<GhostAdmixtureItem>): void {
    setRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)))
  }

  // Live preview uses the same Dutch label formatter as the picker
  // dialog so the user sees identical naming everywhere.
  const previewLabel = useMemo(
    () =>
      lithoDisplayName(
        mainCode,
        rows.map(r => ({ soil_code: r.soil_code, amount: r.amount, locally: r.locally })),
      ),
    [mainCode, rows],
  )

  function handleSave(): void {
    onSave(
      mainCode,
      rows.map(r => ({
        soil_code: r.soil_code,
        amount: r.amount,
        locally: r.locally,
      })),
    )
  }

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      labelledBy="ghost-composition-editor-title"
      cardClassName="w-[26rem]"
    >
      <div className="p-5">
        <h2
          id="ghost-composition-editor-title"
          className="text-sm font-semibold text-text-primary mb-3"
        >
          {mainSoilLocked
            ? t('composition.editAdmixturesTitle')
            : t('composition.editSuggestionTitle')}
        </h2>

        {/* Main soil code dropdown */}
        <div className="mb-3">
          <label
            id="ghost-edit-main-code-label"
            htmlFor="ghost-edit-main-code"
            className="block text-xs text-text-secondary mb-1"
          >
            {t('composition.mainSoil')}
            {mainSoilLocked && (
              <span className="ml-1 text-text-muted">{t('composition.fixedByCorrelation')}</span>
            )}
          </label>
          {/* In-app listbox, not a native <select>: the native popup does not
              open in the packaged Electron window (owner #35). The base soil
              name is shown in the active UI language (never the raw Dutch token
              in parens — "Sand (ZAND)" leaked Dutch into an English UI, dogfeed
              2026-05-23); the picker dialog uses the same rule. */}
          <Select
            id="ghost-edit-main-code"
            value={mainCode}
            options={MAIN_SOIL_CODES.map(code => ({
              value: code,
              label: lithoBaseLabel(code),
            }))}
            onChange={v => setMainCode(v as MainSoilCode)}
            disabled={mainSoilLocked}
            ariaLabelledBy="ghost-edit-main-code-label"
            className={`w-full text-xs rounded border border-border-default px-2 py-1 text-text-primary ${
              mainSoilLocked
                ? 'bg-surface-sunken opacity-60 cursor-not-allowed'
                : 'bg-surface-page'
            }`}
          />
        </div>

        {/* Admixture rows */}
        <div className="mb-3">
          <p className="text-xs text-text-secondary mb-1">{t('composition.admixtures')}</p>
          {rows.length === 0 && (
            <p className="text-[11px] text-text-muted italic mb-1">{t('composition.noAdmixtures')}</p>
          )}
          <div className="flex flex-col gap-1.5">
            {rows.map(row => {
              // Safety net (dogfeed 2026-05-21): if the stored
              // soil_code or amount isn't in the curated option list,
              // append a one-off fallback option so the dropdown shows
              // the user what's actually stored. Without this, the
              // <select> silently snaps to the first option, making
              // the dialog claim "Gravel (GL)" when the underlying
              // value was e.g. "OM" (organic matter).
              const soilOptions = soilOptionsBase.some(
                o => o.code === row.soil_code,
              )
                ? soilOptionsBase
                : [
                    ...soilOptionsBase,
                    {
                      // Stored code outside the curated list: label it in the
                      // active language too, raw token as value + tooltip.
                      code: row.soil_code,
                      label: `${admixtureSoilAdjective(row.soil_code, language)} (${row.soil_code})`,
                      title: row.soil_code,
                    },
                  ]
              const amountOptions = amountOptionsBase.some(
                o => o.code === row.amount,
              )
                ? amountOptionsBase
                : [
                    ...amountOptionsBase,
                    { code: row.amount, label: `${row.amount} (raw)`, title: row.amount },
                  ]
              return (
              <div key={row.id} className="flex items-center gap-1.5">
                <Select
                  value={row.soil_code}
                  options={soilOptions.map(opt => ({
                    value: opt.code,
                    label: opt.label,
                    title: opt.title,
                  }))}
                  onChange={v => updateRow(row.id, { soil_code: v })}
                  ariaLabel={t('composition.admixtureSoilCode')}
                  wrapperClassName="min-w-0 flex-1"
                  className="w-full text-xs rounded border border-border-default bg-surface-page px-1.5 py-1 text-text-primary"
                />
                <Select
                  value={row.amount}
                  options={amountOptions.map(opt => ({
                    value: opt.code,
                    label: opt.label,
                    title: opt.title,
                  }))}
                  onChange={v => updateRow(row.id, { amount: v })}
                  ariaLabel={t('composition.admixtureAmount')}
                  wrapperClassName="min-w-0 flex-1"
                  className="w-full text-xs rounded border border-border-default bg-surface-page px-1.5 py-1 text-text-primary"
                />
                <label className="flex shrink-0 items-center gap-1 text-xs text-text-secondary select-none cursor-pointer">
                  <input
                    type="checkbox"
                    checked={row.locally}
                    onChange={e => updateRow(row.id, { locally: e.target.checked })}
                    className="rounded"
                  />
                  {t('composition.locally')}
                </label>
                <button
                  onClick={() => removeAdmixtureRow(row.id)}
                  className="shrink-0 text-text-muted hover:text-red-600"
                  title={t('composition.removeAdmixture')}
                  aria-label={t('composition.removeAdmixture')}
                >
                  <X size={12} />
                </button>
              </div>
              )
            })}
          </div>
          <button
            onClick={addAdmixtureRow}
            className="mt-1.5 flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
          >
            <Plus size={11} />
            {t('composition.addAdmixture')}
          </button>
        </div>

        {/* Live preview */}
        <div className="rounded border border-border-subtle bg-surface-page px-3 py-2 mb-4">
          <p className="text-[10px] text-text-muted uppercase tracking-wide mb-0.5">
            {t('composition.preview')}
          </p>
          <p
            className="text-sm font-medium text-text-primary"
            data-testid="ghost-edit-preview"
          >
            {previewLabel}
          </p>
        </div>

        <div
          ref={footerRef}
          className="flex justify-end items-center gap-2 pt-3 border-t border-border-subtle"
        >
          <Button variant="secondary" size="md" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size="md" onClick={handleSave}>
            {t('composition.save')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

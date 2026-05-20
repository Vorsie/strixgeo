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
import { formatLithoDisplayName } from '../../utils/lithoLabels'

// Vocabulary mirrors LithoCompositionPickerDialog. Kept inline so the
// two components don't form a tight import coupling — both can evolve
// independently if one's UX needs diverge from the other's.
const MAIN_SOIL_CODES = ['GRIND', 'ZAND', 'SILT', 'KLEI', 'VEEN'] as const
type MainSoilCode = (typeof MAIN_SOIL_CODES)[number]

const MAIN_SOIL_LABELS: Record<MainSoilCode, string> = {
  GRIND: 'Grind',
  ZAND: 'Zand',
  SILT: 'Silt',
  KLEI: 'Klei',
  VEEN: 'Veen',
}

const ADMIXTURE_SOIL_OPTIONS: Array<{ code: string; label: string }> = [
  { code: 'GL', label: 'Grind (GL)' },
  { code: 'ZN', label: 'Zand (ZN)' },
  { code: 'SL', label: 'Silt (SL)' },
  { code: 'KL', label: 'Klei (KL)' },
  { code: 'VE', label: 'Veen (VE)' },
]

const ADMIXTURE_AMOUNT_OPTIONS: Array<{ code: string; label: string }> = [
  { code: '', label: '— (niet gespecificeerd)' },
  { code: 'Z', label: 'Zwak (Z)' },
  { code: 'W', label: 'Weinig (W)' },
  { code: 'M', label: 'Matig (M)' },
  { code: 'V', label: 'Veel (V)' },
  { code: 'S', label: 'Sterk (S)' },
]

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
  onSave,
  onCancel,
}: LithoGhostCompositionEditorProps): JSX.Element | null {
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

  // Reset internal state whenever the dialog reopens with a new
  // initial composition — required because the same component
  // instance is reused across multiple ghost layers (open → edit
  // layer A → close → open → edit layer B), and React doesn't
  // remount unless the key changes.
  useEffect(() => {
    if (!open) return
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
  }, [open, initialNormalised, initialAdmixtures, nextRowIdRef])

  function addAdmixtureRow(): void {
    const id = nextRowIdRef.current++
    setRows(prev => [
      ...prev,
      { id, soil_code: ADMIXTURE_SOIL_OPTIONS[0].code, amount: '', locally: false },
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
      formatLithoDisplayName(
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
          Edit suggestion composition
        </h2>

        {/* Main soil code dropdown */}
        <div className="mb-3">
          <label
            htmlFor="ghost-edit-main-code"
            className="block text-xs text-text-secondary mb-1"
          >
            Main soil
          </label>
          <select
            id="ghost-edit-main-code"
            value={mainCode}
            onChange={e => setMainCode(e.target.value as MainSoilCode)}
            className="w-full text-xs rounded border border-border-default bg-surface-page px-2 py-1 text-text-primary"
          >
            {MAIN_SOIL_CODES.map(code => (
              <option key={code} value={code}>
                {MAIN_SOIL_LABELS[code]} ({code})
              </option>
            ))}
          </select>
        </div>

        {/* Admixture rows */}
        <div className="mb-3">
          <p className="text-xs text-text-secondary mb-1">Admixtures</p>
          {rows.length === 0 && (
            <p className="text-[11px] text-text-muted italic mb-1">No admixtures.</p>
          )}
          <div className="flex flex-col gap-1.5">
            {rows.map(row => (
              <div key={row.id} className="flex items-center gap-1.5">
                <select
                  value={row.soil_code}
                  onChange={e => updateRow(row.id, { soil_code: e.target.value })}
                  className="text-xs rounded border border-border-default bg-surface-page px-1.5 py-1 text-text-primary"
                  aria-label="Admixture soil code"
                >
                  {ADMIXTURE_SOIL_OPTIONS.map(opt => (
                    <option key={opt.code} value={opt.code}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <select
                  value={row.amount}
                  onChange={e => updateRow(row.id, { amount: e.target.value })}
                  className="text-xs rounded border border-border-default bg-surface-page px-1.5 py-1 text-text-primary"
                  aria-label="Admixture amount"
                >
                  {ADMIXTURE_AMOUNT_OPTIONS.map(opt => (
                    <option key={opt.code} value={opt.code}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1 text-xs text-text-secondary select-none cursor-pointer">
                  <input
                    type="checkbox"
                    checked={row.locally}
                    onChange={e => updateRow(row.id, { locally: e.target.checked })}
                    className="rounded"
                  />
                  locally
                </label>
                <button
                  onClick={() => removeAdmixtureRow(row.id)}
                  className="ml-auto text-text-muted hover:text-red-600"
                  title="Remove admixture"
                  aria-label="Remove admixture"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={addAdmixtureRow}
            className="mt-1.5 flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
          >
            <Plus size={11} />
            Add admixture
          </button>
        </div>

        {/* Live preview */}
        <div className="rounded border border-border-subtle bg-surface-page px-3 py-2 mb-4">
          <p className="text-[10px] text-text-muted uppercase tracking-wide mb-0.5">
            Preview
          </p>
          <p
            className="text-sm font-medium text-text-primary"
            data-testid="ghost-edit-preview"
          >
            {previewLabel}
          </p>
        </div>

        <div className="flex justify-end items-center gap-2 pt-3 border-t border-border-subtle">
          <Button variant="secondary" size="md" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" size="md" onClick={handleSave}>
            Save composition
          </Button>
        </div>
      </div>
    </Modal>
  )
}

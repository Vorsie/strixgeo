/**
 * Create / edit a geological formation.
 *
 * Same Modal + Button shell as NewProjectDialog. Three fields:
 *
 *   * name — required, the engineer-facing label. The input offers
 *     a G3Dv3 autocomplete dropdown so typing "boom" surfaces the
 *     canonical "Boom" entry — selecting it autofills the colour
 *     (G3Dv3-prescribed RGB) and regional_ref (G3D abbreviation,
 *     e.g. "PA_Bm"). Plain text is still accepted for informal /
 *     foreign / custom names that aren't in the catalog.
 *   * color — HTML5 colour input; defaults to a neutral grey when
 *     the user opens "new", autofilled from G3Dv3 on suggestion pick.
 *   * regional_ref — optional regional reference / external code.
 *     Free-text, autofilled with the G3D abbreviation on pick.
 *
 * ``initialValue === null`` ⇒ create mode (empty fields, title
 * "New formation"). Non-null ⇒ edit mode (fields prefilled, title
 * "Edit formation"). The submit handler is async; the modal stays
 * busy + locked until it resolves.
 *
 * Fields the backend supports but we don't surface yet:
 * ``code``, ``display_order``, ``description``. The Sidebar
 * drag-reorder + auto-populate already manage display_order; the
 * others land when the formations list needs categorisation.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import type {
  FormalStratigraphyUnitResponse,
  G3Dv3UnitResponse,
  GeologicalFormationCreatePayload,
  GeologicalFormationResponse,
  GeologicalFormationUpdatePayload,
} from '../../api/client'
import { useFormalStratigraphyCatalog } from '../../hooks/useFormalStratigraphyCatalog'
import { useG3Dv3Catalog } from '../../hooks/useG3Dv3Catalog'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { useT } from '../../i18n/translate'

const DEFAULT_COLOR = '#9ca3af' // gray-400 — same neutral as the backend default
const MAX_SUGGESTIONS = 8 // bound dropdown height; "boom"-prefix typically <8 hits anyway

interface Props {
  open: boolean
  /** ``null`` = create mode; non-null = edit mode (pre-filled). */
  initialValue: GeologicalFormationResponse | null
  onSubmit: (
    payload: GeologicalFormationCreatePayload | GeologicalFormationUpdatePayload,
  ) => Promise<void> | void
  onCancel: () => void
}

/**
 * Rank suggestions for the given query.
 *
 * Two-tier scoring:
 * 1. Prefix match on Dutch name (case-insensitive) — common case,
 *    ranked first; sorted by age_rank (youngest first) so the most
 *    expected hit lands at the top.
 * 2. Substring match on Dutch name OR abbreviation — catches mid-word
 *    typing and code-style queries ("ne_di" → Diest).
 *
 * Exported for the test harness.
 */
export function rankFormationSuggestions(
  units: G3Dv3UnitResponse[],
  query: string,
  limit: number = MAX_SUGGESTIONS,
): G3Dv3UnitResponse[] {
  const q = query.trim().toLowerCase()
  if (q === '') return []
  const prefixHits: G3Dv3UnitResponse[] = []
  const substringHits: G3Dv3UnitResponse[] = []
  for (const u of units) {
    const name = u.name_nl.toLowerCase()
    const abbrev = u.abbreviation.toLowerCase()
    if (name.startsWith(q)) {
      prefixHits.push(u)
    } else if (name.includes(q) || abbrev.includes(q)) {
      substringHits.push(u)
    }
  }
  // Stable youngest-first within each tier (catalog ships sorted by
  // age_rank, so a copy preserves the order — no extra sort needed).
  return [...prefixHits, ...substringHits].slice(0, limit)
}

/**
 * Rank formal-stratigraphy suggestions for the given query.
 *
 * Prefix matches (on the Dutch name OR the code) rank first, then substring
 * matches — so "holoc" surfaces "Quartair Holoceen (QH)" and "qh" surfaces it
 * by code. Exported for the test harness.
 */
export function rankFormalSuggestions(
  units: FormalStratigraphyUnitResponse[],
  query: string,
  limit: number = MAX_SUGGESTIONS,
): FormalStratigraphyUnitResponse[] {
  const q = query.trim().toLowerCase()
  if (q === '') return []
  const prefixHits: FormalStratigraphyUnitResponse[] = []
  const substringHits: FormalStratigraphyUnitResponse[] = []
  for (const u of units) {
    const name = u.name_nl.toLowerCase()
    const code = u.code.toLowerCase()
    if (name.startsWith(q) || code.startsWith(q)) {
      prefixHits.push(u)
    } else if (name.includes(q) || code.includes(q)) {
      substringHits.push(u)
    }
  }
  return [...prefixHits, ...substringHits].slice(0, limit)
}

export default function FormationDialog({
  open,
  initialValue,
  onSubmit,
  onCancel,
}: Props): JSX.Element | null {
  const t = useT()
  const [name, setName] = useState('')
  const [color, setColor] = useState(DEFAULT_COLOR)
  const [regionalRef, setRegionalRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Informal→formal link: the chosen DOV formal-stratigraphy code (stored in
  // the formation's ``code``) + a separate search box. ``formalCode`` is the
  // link; ``formalQuery`` is just the autocomplete search text.
  const [formalCode, setFormalCode] = useState<string | null>(null)
  const [formalQuery, setFormalQuery] = useState('')
  const [formalOpen, setFormalOpen] = useState(false)
  const [formalActiveIndex, setFormalActiveIndex] = useState(0)

  const { units: catalogUnits } = useG3Dv3Catalog()
  const { units: formalUnits } = useFormalStratigraphyCatalog()

  // Resolve the linked code → canonical name for the "currently linked" badge.
  const formalLinkedName = useMemo(
    () => formalUnits?.find(u => u.code === formalCode)?.name_nl ?? null,
    [formalUnits, formalCode],
  )

  // Reset + prefill on open. Without this the dialog leaks state
  // across cancel / re-open and edit / create cycles.
  useEffect(() => {
    if (!open) return
    setName(initialValue?.name ?? '')
    setColor(initialValue?.color ?? DEFAULT_COLOR)
    setRegionalRef(initialValue?.regional_ref ?? '')
    setFormalCode(initialValue?.code ?? null)
    setFormalQuery('')
    setFormalOpen(false)
    setFormalActiveIndex(0)
    setBusy(false)
    setSuggestionsOpen(false)
    setActiveIndex(0)
    const timer = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [open, initialValue])

  const suggestions = useMemo(
    () =>
      catalogUnits === null ? [] : rankFormationSuggestions(catalogUnits, name),
    [catalogUnits, name],
  )

  const formalSuggestions = useMemo(
    () => (formalUnits === null ? [] : rankFormalSuggestions(formalUnits, formalQuery)),
    [formalUnits, formalQuery],
  )

  function applyFormalSuggestion(unit: FormalStratigraphyUnitResponse): void {
    setFormalCode(unit.code)
    setFormalQuery('')
    setFormalOpen(false)
  }

  function applySuggestion(unit: G3Dv3UnitResponse): void {
    setName(unit.name_nl)
    if (unit.color_hex) setColor(unit.color_hex)
    setRegionalRef(unit.abbreviation)
    setSuggestionsOpen(false)
  }

  async function handleSubmit(): Promise<void> {
    const trimmedName = name.trim()
    if (!trimmedName || busy) return
    const trimmedRef = regionalRef.trim()
    setBusy(true)
    try {
      await onSubmit({
        name: trimmedName,
        color,
        regional_ref: trimmedRef === '' ? null : trimmedRef,
        // The informal→formal link: store the chosen formal-stratigraphy code
        // on the formation (drives the lens auto-name). null = unlinked.
        code: formalCode,
      })
    } finally {
      setBusy(false)
    }
  }

  function handleFormalKey(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (!formalOpen || formalSuggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFormalActiveIndex(i => (i + 1) % formalSuggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFormalActiveIndex(i => (i - 1 + formalSuggestions.length) % formalSuggestions.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      applyFormalSuggestion(formalSuggestions[formalActiveIndex])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setFormalOpen(false)
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (suggestionsOpen && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex(i => (i + 1) % suggestions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex(i => (i - 1 + suggestions.length) % suggestions.length)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        applySuggestion(suggestions[activeIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setSuggestionsOpen(false)
        return
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleSubmit()
    }
  }

  const isEdit = initialValue !== null
  return (
    <Modal open={open} onCancel={onCancel} labelledBy="formation-dialog-title" busy={busy} testid="create-formation-dialog">
      <div className="p-6">
        <h2
          id="formation-dialog-title"
          className="text-base font-semibold text-gray-800 mb-1"
        >
          {isEdit ? t('formation.editTitle') : t('formation.newTitle')}
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          {/* i18n-exempt: Boom Klei / Diest Zand are Belgian formation proper nouns */}
          {t('formation.dialogBlurb')} <em>Boom Klei</em>, <em>Diest Zand</em>,
          <em> {t('formation.exampleQuaternary')}</em>.
        </p>

        <label
          htmlFor="formation-name"
          className="block text-xs font-medium text-gray-600 mb-1"
        >
          {t('common.name')}
        </label>
        <div className="relative mb-3">
          <input
            ref={inputRef}
            id="formation-name"
            type="text"
            value={name}
            onChange={e => {
              setName(e.target.value)
              setSuggestionsOpen(true)
              setActiveIndex(0)
            }}
            onFocus={() => setSuggestionsOpen(true)}
            onBlur={() => {
              // Delay so a click on a suggestion fires before close.
              setTimeout(() => setSuggestionsOpen(false), 120)
            }}
            onKeyDown={handleKey}
            disabled={busy}
            placeholder={t('formation.namePlaceholder')}
            autoComplete="off"
            role="combobox"
            data-testid="create-formation-name-input"
            aria-autocomplete="list"
            aria-expanded={suggestionsOpen && suggestions.length > 0}
            aria-controls="formation-name-suggestions"
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
          />
          {suggestionsOpen && suggestions.length > 0 && (
            <ul
              id="formation-name-suggestions"
              role="listbox"
              className="absolute left-0 right-0 top-full mt-1 z-10 max-h-72 overflow-y-auto bg-white border border-gray-200 rounded shadow-md"
            >
              {suggestions.map((u, i) => (
                <li
                  key={u.abbreviation}
                  role="option"
                  aria-selected={i === activeIndex}
                  onMouseDown={e => {
                    // onMouseDown so the click registers before the
                    // input's onBlur closes the dropdown.
                    e.preventDefault()
                    applySuggestion(u)
                  }}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer ${
                    i === activeIndex ? 'bg-blue-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <span
                    aria-hidden
                    className="inline-block w-3 h-3 rounded-sm border border-gray-300 flex-shrink-0"
                    style={{ backgroundColor: u.color_hex ?? 'transparent' }}
                  />
                  <span className="text-gray-800 truncate">{u.name_nl}</span>
                  <span className="ml-auto text-xs text-gray-400 font-mono">
                    {u.abbreviation}
                  </span>
                  {u.rank === 'member' && (
                    <span className="text-[10px] text-gray-400 uppercase tracking-wide">
                      {/* i18n-exempt: stratigraphic rank token ("lid" = member); hardcoded Dutch, see report */}
                      lid
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid grid-cols-[auto_1fr] gap-3 items-start mb-3">
          <div>
            <label
              htmlFor="formation-color"
              className="block text-xs font-medium text-gray-600 mb-1"
            >
              {t('formation.colour')}
            </label>
            <input
              id="formation-color"
              type="color"
              value={color}
              onChange={e => setColor(e.target.value)}
              disabled={busy}
              className="w-10 h-9 border border-gray-300 rounded cursor-pointer disabled:cursor-not-allowed"
            />
          </div>
          <div>
            <label
              htmlFor="formation-regional-ref"
              className="block text-xs font-medium text-gray-600 mb-1"
            >
              {t('formation.regionalReference')}{' '}
              <span className="text-gray-400">{t('common.optional')}</span>
            </label>
            <input
              id="formation-regional-ref"
              type="text"
              value={regionalRef}
              onChange={e => setRegionalRef(e.target.value)}
              disabled={busy}
              placeholder={t('formation.codePlaceholder')}
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
            />
          </div>
        </div>

        {/* Informal→formal stratigraphy link. Picking a DOV formal unit stores
            its code on the formation; the lens auto-name reads it. */}
        <div className="mb-3">
          <label
            htmlFor="formation-formal"
            className="block text-xs font-medium text-gray-600 mb-1"
          >
            {t('formation.formalStratigraphy')}{' '}
            <span className="text-gray-400">{t('formation.lensCodeHint')}</span>
          </label>
          {formalCode !== null && (
            <div
              className="flex items-center gap-2 mb-2 text-sm"
              data-testid="formation-formal-linked"
            >
              <span className="font-mono px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                {formalCode}
              </span>
              <span className="text-gray-700 truncate">{formalLinkedName ?? ''}</span>
              <button
                type="button"
                onClick={() => setFormalCode(null)}
                disabled={busy}
                data-testid="formation-formal-clear"
                className="ml-auto text-xs text-gray-400 hover:text-red-600"
              >
                {t('formation.clear')}
              </button>
            </div>
          )}
          <div className="relative">
            <input
              id="formation-formal"
              type="text"
              value={formalQuery}
              onChange={e => {
                setFormalQuery(e.target.value)
                setFormalOpen(true)
                setFormalActiveIndex(0)
              }}
              onFocus={() => setFormalOpen(true)}
              onBlur={() => setTimeout(() => setFormalOpen(false), 120)}
              onKeyDown={handleFormalKey}
              disabled={busy}
              placeholder={t('formation.searchFormal')}
              autoComplete="off"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={formalOpen && formalSuggestions.length > 0}
              aria-controls="formation-formal-suggestions"
              data-testid="formation-formal-input"
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
            />
            {formalOpen && formalSuggestions.length > 0 && (
              <ul
                id="formation-formal-suggestions"
                role="listbox"
                className="absolute left-0 right-0 top-full mt-1 z-10 max-h-72 overflow-y-auto bg-white border border-gray-200 rounded shadow-md"
              >
                {formalSuggestions.map((u, i) => (
                  <li
                    key={u.code}
                    role="option"
                    aria-selected={i === formalActiveIndex}
                    onMouseDown={e => {
                      e.preventDefault()
                      applyFormalSuggestion(u)
                    }}
                    onMouseEnter={() => setFormalActiveIndex(i)}
                    data-testid={`formation-formal-option-${u.code}`}
                    className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer ${
                      i === formalActiveIndex ? 'bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <span className="text-gray-800 truncate">{u.name_nl}</span>
                    <span className="ml-auto text-xs text-gray-400 font-mono">{u.code}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" size="md" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => void handleSubmit()}
            disabled={!name.trim() || busy}
            data-testid="create-formation-submit"
          >
            {isEdit ? t('common.save') : t('common.create')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

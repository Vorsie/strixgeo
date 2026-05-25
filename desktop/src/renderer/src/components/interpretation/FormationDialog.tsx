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
  G3Dv3UnitResponse,
  GeologicalFormationCreatePayload,
  GeologicalFormationResponse,
  GeologicalFormationUpdatePayload,
} from '../../api/client'
import { useG3Dv3Catalog } from '../../hooks/useG3Dv3Catalog'
import Button from '../ui/Button'
import Modal from '../ui/Modal'

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

export default function FormationDialog({
  open,
  initialValue,
  onSubmit,
  onCancel,
}: Props): JSX.Element | null {
  const [name, setName] = useState('')
  const [color, setColor] = useState(DEFAULT_COLOR)
  const [regionalRef, setRegionalRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const { units: catalogUnits } = useG3Dv3Catalog()

  // Reset + prefill on open. Without this the dialog leaks state
  // across cancel / re-open and edit / create cycles.
  useEffect(() => {
    if (!open) return
    setName(initialValue?.name ?? '')
    setColor(initialValue?.color ?? DEFAULT_COLOR)
    setRegionalRef(initialValue?.regional_ref ?? '')
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
      })
    } finally {
      setBusy(false)
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
          {isEdit ? 'Edit formation' : 'New formation'}
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          A formation is a substrate unit you reference in the
          geological model — e.g. <em>Boom Klei</em>, <em>Diest Zand</em>,
          <em> Quaternary deposits</em>.
        </p>

        <label
          htmlFor="formation-name"
          className="block text-xs font-medium text-gray-600 mb-1"
        >
          Name
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
            placeholder="e.g. Boom Klei"
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
              Colour
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
              Regional reference <span className="text-gray-400">(optional)</span>
            </label>
            <input
              id="formation-regional-ref"
              type="text"
              value={regionalRef}
              onChange={e => setRegionalRef(e.target.value)}
              disabled={busy}
              placeholder="e.g. stratigraphic chart code"
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" size="md" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => void handleSubmit()}
            disabled={!name.trim() || busy}
            data-testid="create-formation-submit"
          >
            {isEdit ? 'Save' : 'Create'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

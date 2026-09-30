// Inline editor for the manually-entered surface elevation (Z) on a CPT
// or borehole detail panel. Phase 3a UX requirement — DOV/GEF rows that
// arrive without a Z need a per-record manual-entry path before any
// cross-record correlation can run against them. The editor is shared
// between CPT (CptChart header) and borehole (BoreholeLog header) since
// the interaction shape is identical; the parent passes the current
// values + an async `onSave` that talks to the right backend endpoint.
//
// Behaviour summary:
//   * idle (Z known)         → "Z = 12.45 m TAW" + pencil icon
//   * idle (Z missing)       → amber "Set elevation" link (matches the
//                              "needs Z" badge in the sidebar)
//   * editing                → numeric input + ✓ Save / ✗ Cancel; Enter
//                              saves, Esc cancels
//   * editing (clear path)   → "Clear" link inside the editor returns
//                              the row to the "needs Z" state — supports
//                              undoing a typo per the reversible-action
//                              UX convention in CLAUDE.md
//
// The component is intentionally non-controlled: it owns its own draft
// state while editing, applies optimistic display only after the parent
// resolves `onSave` (so failures don't leave the UI showing a value
// that didn't persist).

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Pencil, X } from 'lucide-react'
import {
  DEFAULT_PICKER_EPSG,
  PICKABLE_VERTICAL_EPSGS,
  VCRS_LABEL_BY_EPSG,
  verticalDatumLabel,
} from '../utils/verticalDatum'
import { useT } from '../i18n/translate'

interface Props {
  elevationM: number | null
  zEpsg: number | null
  // Provenance of ``elevationM`` — ``"dov"`` / ``"gef"`` / ``"manual"``
  // / ``"none"`` (the API enum from debt #8). Rendered as a tiny
  // greyed tag next to the Z value so engineers can tell DOV-published
  // Z apart from their own corrections at a glance. Optional so
  // legacy callers that don't yet thread it just see the un-badged
  // version; new call sites should pass it.
  elevationSource?: string | null
  // Parent owns the API call so this component stays storage-agnostic
  // (CPT and borehole hit different endpoints). Resolves on success;
  // rejects with an Error whose message is surfaced to the user. The
  // ``zEpsg`` argument carries the user's pick from the datum dropdown
  // (defaults to mTAW for fresh entries) so the saved row always lands
  // with a known vertical CRS.
  onSave: (elevationM: number | null, zEpsg: number | null) => Promise<void>
}

// Short human label for the provenance tag — keeps the badge tight on
// the borelog / CPT header strip. The "none" case never renders (the
// row's elevation is null in that case and the editor shows the amber
// "Set elevation" link instead).
const SOURCE_LABEL: Record<string, string> = {
  dov: 'DOV',
  gef: 'GEF',
  pdf: 'PDF',
  manual: 'manual',
}

// Strip everything that isn't a digit, leading minus, or a single decimal
// separator (`.` or `,`). Keeps the first separator only and the minus only
// when leading. Same shape a spreadsheet's number cell enforces.
function cleanNumericInput(raw: string): string {
  let s = raw.replace(/[^\d.,\-]/g, '')
  const negative = s.startsWith('-')
  s = s.replace(/-/g, '')
  // Collapse multiple separators: keep the first, drop the rest.
  const firstSep = s.search(/[.,]/)
  if (firstSep !== -1) {
    const head = s.slice(0, firstSep + 1)
    const tail = s.slice(firstSep + 1).replace(/[.,]/g, '')
    s = head + tail
  }
  return (negative ? '-' : '') + s
}

export default function ElevationEditor({
  elevationM,
  zEpsg,
  elevationSource,
  onSave,
}: Props) {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string>('')
  // The picker's selected EPSG. Initialised at edit-mode entry from the
  // current row, falling back to mTAW for fresh entries. Held in local
  // state (not derived from props on every render) so the user can change
  // it mid-edit without it snapping back to whatever the row currently
  // shows.
  const [pickedZEpsg, setPickedZEpsg] = useState<number>(zEpsg ?? DEFAULT_PICKER_EPSG)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Idle-state datum label — uses whatever the row currently has stored.
  const idleDatumLabel = verticalDatumLabel(zEpsg)

  function start(): void {
    setDraft(elevationM != null ? elevationM.toFixed(2) : '')
    setPickedZEpsg(zEpsg ?? DEFAULT_PICKER_EPSG)
    setError(null)
    setEditing(true)
  }

  function cancel(): void {
    setEditing(false)
    setError(null)
  }

  async function commit(value: number | null): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      // When clearing the value, send zEpsg=null too — keeps the column
      // pair consistent and matches the backend's clear semantics.
      const z = value == null ? null : pickedZEpsg
      await onSave(value, z)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('elevation.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function save(): Promise<void> {
    const trimmed = draft.trim()
    if (trimmed === '') {
      // Empty input on Save means "clear" — same as the explicit Clear
      // link below. Keeps the keyboard path (Type + Enter on empty input)
      // working without forcing a mouse click.
      await commit(null)
      return
    }
    // Accept European-style comma decimals: `12,34` → `12.34`. The input
    // filter already guarantees at most one separator, so the first
    // replace handles every legal value.
    const normalized = trimmed.replace(',', '.')
    const parsed = Number(normalized)
    if (!Number.isFinite(parsed)) {
      setError(t('elevation.enterANumber'))
      return
    }
    // Mirror the backend range guard so the user gets feedback before
    // round-tripping to the server. The bounds match
    // ElevationPatchRequest's ge/le constraints.
    if (parsed < -500 || parsed > 9000) {
      setError(t('elevation.outOfRange'))
      return
    }
    await commit(parsed)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      void save()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    }
  }

  // Auto-focus + select-all when entering edit mode so the user can
  // type-replace the existing value immediately.
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  if (!editing) {
    if (elevationM == null) {
      return (
        <button
          onClick={start}
          className="inline-flex items-center gap-1 text-[11px] text-amber-700 hover:text-amber-800 hover:underline"
          title={t('elevation.addHint')}
        >
          <AlertTriangle size={11} />
          {t('elevation.set')}
        </button>
      )
    }
    // Provenance tag — small, greyed, only when a real source is set.
    // Goes between the datum label and the pencil so the user's eye
    // hits "Z = +12.45 m TAW (DOV)" → pencil-on-hover.
    // DOV / GEF are source acronyms kept verbatim; "manual" is plain copy.
    const sourceLabel = !elevationSource
      ? undefined
      : elevationSource === 'manual'
        ? t('elevation.sourceManual')
        : SOURCE_LABEL[elevationSource]
    return (
      <button
        onClick={start}
        className="group inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-800"
        title={t('elevation.edit')}
      >
        <span>
          Z = {elevationM.toFixed(2)} {idleDatumLabel}
        </span>
        {sourceLabel && (
          <span
            className="text-[10px] text-gray-400"
            title={t('elevation.sourceTitle', { source: elevationSource ?? '' })}
          >
            ({sourceLabel})
          </span>
        )}
        <Pencil size={10} className="opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
    )
  }

  return (
    <div className="inline-flex items-center gap-1 text-[11px]">
      <span className="text-gray-500">Z =</span>
      <input
        ref={inputRef}
        // type=text + inputMode=decimal: we filter the value on change so
        // letters never reach the field. Using <input type=number> would
        // hand off filtering to the browser, which then silently coerces
        // invalid input to '' — colliding with the empty-means-clear path.
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={e => setDraft(cleanNumericInput(e.target.value))}
        onKeyDown={onKeyDown}
        disabled={saving}
        className="w-20 px-1 py-0.5 border border-gray-300 rounded text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-300"
        placeholder="m"
      />
      {/* Datum picker — defaults to mTAW for fresh entries, retains the
          row's existing CRS otherwise. Today's options match
          ``PICKABLE_VERTICAL_EPSGS`` in ``utils/verticalDatum.ts``;
          adding a new datum is one entry there. The dropdown is always
          visible (even when only one option is selectable) so the user
          knows the choice exists — invisible defaults are surprising. */}
      <select
        value={pickedZEpsg}
        onChange={e => setPickedZEpsg(Number(e.target.value))}
        disabled={saving}
        title={t('elevation.verticalReference')}
        className="px-0.5 py-0.5 border border-gray-300 rounded bg-white text-[11px] text-gray-600 cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-300"
      >
        {PICKABLE_VERTICAL_EPSGS.map(epsg => (
          <option key={epsg} value={epsg}>
            {/* i18n-exempt: EPSG is the international CRS-registry code prefix, identical across locales */}
            {VCRS_LABEL_BY_EPSG[epsg] ?? `EPSG:${epsg}`}
          </option>
        ))}
      </select>
      <button
        onClick={() => void save()}
        disabled={saving}
        title={t('elevation.saveEnter')}
        className="p-0.5 rounded text-green-600 hover:bg-green-50 disabled:opacity-40"
      >
        <Check size={12} />
      </button>
      <button
        onClick={cancel}
        disabled={saving}
        title={t('elevation.cancelEsc')}
        className="p-0.5 rounded text-gray-500 hover:bg-gray-100 disabled:opacity-40"
      >
        <X size={12} />
      </button>
      {elevationM != null && (
        <button
          onClick={() => void commit(null)}
          disabled={saving}
          title={t('elevation.clearHint')}
          className="ml-1 text-[10px] text-gray-400 hover:text-red-600 hover:underline disabled:opacity-40"
        >
          {t('elevation.clear')}
        </button>
      )}
      {error && <span className="ml-1 text-[10px] text-red-600">{error}</span>}
    </div>
  )
}

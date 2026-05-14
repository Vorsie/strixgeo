/**
 * Virtuele Boring (DOV synthetic-borehole) overlay picker section.
 *
 * Two surfaces:
 *
 *   * Two dropdowns (Model A / Model B) — pick any of DOV's 12
 *     layered models per slot, with "Off" as the zero state. The
 *     selected pair drives the section view's ghost columns.
 *   * Per-investigation expandable list of predicted layers per
 *     active model. Read-only — engineers consult these to inform
 *     their manual contact picks.
 *
 * Stateful pieces owned here:
 *
 *   * The DOV model catalogue (fetched once on mount; failure renders
 *     a graceful "couldn't reach DOV" hint without crashing the pane).
 *   * Per-investigation list collapse state.
 *
 * Model selection + predictions data flow in from the parent — the
 * App owns persistence (view_state.virtuele_boring) and the cross-
 * component cache (the same prediction payload feeds the section
 * view's ghost columns).
 */

import { ChevronDown, ChevronRight, Database } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../api/client'
import type {
  VirtueleBoringInvestigationPrediction,
  VirtueleBoringLagenmodelEntry,
} from '../../api/client'
import { log } from '../../utils/log'

interface Props {
  /** Currently picked model in slot A (the first ghost column). */
  modelA: string | null
  /** Currently picked model in slot B (the second ghost column). */
  modelB: string | null
  /** Per-investigation prediction payload. Empty array = no fetch
   * dispatched yet OR no investigations in the project carry a
   * Lambert-72 coordinate. Loading state lives on
   * ``predictionsLoading``. */
  predictions: readonly VirtueleBoringInvestigationPrediction[]
  predictionsLoading: boolean
  /** Number of investigations whose CRS isn't Lambert 72 (or whose
   * coords are missing). Surfaced as a small badge so the user
   * knows about silent skips. */
  skippedCount: number
  /** Slot mutator — the App persists to ``project.view_state.virtuele_boring``
   * and (de)dispatches the predictions fetch on next render. */
  onChange: (next: { modelA: string | null; modelB: string | null }) => void
}

export default function VirtueleBoringSection({
  modelA,
  modelB,
  predictions,
  predictionsLoading,
  skippedCount,
  onChange,
}: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<VirtueleBoringLagenmodelEntry[] | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [expandedInvestigationId, setExpandedInvestigationId] = useState<string | null>(null)

  useEffect(() => {
    if (!open || catalog !== null) return
    let cancelled = false
    void (async () => {
      try {
        const result = await api.virtueleBoring.lagenmodellen()
        if (!cancelled) setCatalog(result)
      } catch (err) {
        log.warning('VirtueleBoringSection', `lagenmodellen fetch failed: ${String(err)}`)
        if (!cancelled) setCatalogError('Could not reach DOV — try again later.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, catalog])

  const activeModels: string[] = []
  if (modelA) activeModels.push(modelA)
  if (modelB && modelB !== modelA) activeModels.push(modelB)

  return (
    <div className="border-t border-gray-100 pt-3 mt-3">
      <button
        onClick={() => setOpen(prev => !prev)}
        className="flex items-center gap-1.5 w-full text-left text-gray-700 hover:text-gray-900"
        title="DOV Virtuele Boring overlays — informative reference for manual contact placement"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Database size={12} className="text-gray-500" />
        <span className="text-xs font-medium">DOV virtuele boring</span>
        {activeModels.length > 0 && (
          <span className="text-[10px] text-gray-400 tabular-nums ml-auto">
            {activeModels.length} active
          </span>
        )}
      </button>

      {open && (
        <div className="flex flex-col gap-2 mt-2 pl-1">
          {catalogError !== null && (
            <p className="text-[11px] text-amber-700">{catalogError}</p>
          )}

          <ModelSlotDropdown
            label="Model A"
            selected={modelA}
            catalog={catalog}
            onSelect={code => onChange({ modelA: code, modelB })}
          />
          <ModelSlotDropdown
            label="Model B"
            selected={modelB}
            catalog={catalog}
            onSelect={code => onChange({ modelA, modelB: code })}
          />

          {activeModels.length === 0 ? (
            <p className="text-[11px] text-gray-500 italic">
              Pick a model in either slot to overlay DOV predictions on the
              section view and list per-investigation layers here.
            </p>
          ) : (
            <PredictionsList
              predictions={predictions}
              loading={predictionsLoading}
              skippedCount={skippedCount}
              activeModels={activeModels}
              expandedId={expandedInvestigationId}
              onToggleExpanded={id =>
                setExpandedInvestigationId(prev => (prev === id ? null : id))
              }
            />
          )}
        </div>
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
  return (
    <label className="flex items-center gap-2 text-[11px] text-gray-700">
      <span className="w-12 shrink-0">{label}</span>
      <select
        value={selected ?? ''}
        onChange={e => onSelect(e.target.value === '' ? null : e.target.value)}
        className="flex-1 min-w-0 px-1.5 py-1 border border-gray-200 rounded text-[11px] bg-white"
        disabled={catalog === null}
      >
        <option value="">Off</option>
        {(catalog ?? []).map(entry => (
          <option key={entry.code} value={entry.code} title={entry.beschrijving}>
            {entry.beschrijving}
          </option>
        ))}
      </select>
    </label>
  )
}

function PredictionsList({
  predictions,
  loading,
  skippedCount,
  activeModels,
  expandedId,
  onToggleExpanded,
}: {
  predictions: readonly VirtueleBoringInvestigationPrediction[]
  loading: boolean
  skippedCount: number
  activeModels: readonly string[]
  expandedId: string | null
  onToggleExpanded: (id: string) => void
}): JSX.Element {
  if (loading) {
    return (
      <p className="text-[11px] text-gray-500 italic">Loading predictions…</p>
    )
  }
  if (predictions.length === 0) {
    return (
      <p className="text-[11px] text-gray-500 italic">
        No investigations with a Lambert-72 (EPSG:31370) coordinate found.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-1">
      {skippedCount > 0 && (
        <p className="text-[10px] text-gray-400 italic">
          {skippedCount} investigation{skippedCount === 1 ? '' : 's'} skipped
          (not in EPSG:31370).
        </p>
      )}
      <ul className="flex flex-col max-h-64 overflow-y-auto pr-1">
        {predictions.map(pred => (
          <PredictionRow
            key={pred.investigation_id}
            pred={pred}
            activeModels={activeModels}
            expanded={expandedId === pred.investigation_id}
            onToggleExpanded={() => onToggleExpanded(pred.investigation_id)}
          />
        ))}
      </ul>
    </div>
  )
}

function PredictionRow({
  pred,
  activeModels,
  expanded,
  onToggleExpanded,
}: {
  pred: VirtueleBoringInvestigationPrediction
  activeModels: readonly string[]
  expanded: boolean
  onToggleExpanded: () => void
}): JSX.Element {
  const hasAny = activeModels.some(m => (pred.predictions_by_model[m]?.length ?? 0) > 0)
  return (
    <li className="border-b border-gray-50 last:border-b-0">
      <button
        onClick={onToggleExpanded}
        className="flex items-center gap-1.5 w-full text-left px-1 py-1 text-[11px] text-gray-700 hover:bg-gray-50 rounded"
      >
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        <span className="truncate flex-1" title={pred.name}>
          {pred.name}
        </span>
        <span className="text-[10px] text-gray-400 uppercase">
          {pred.investigation_kind}
        </span>
        {!hasAny && (
          <span
            className="text-[10px] text-gray-400 italic"
            title="No predicted layers — DOV may not cover this point in the active model(s)."
          >
            no data
          </span>
        )}
      </button>
      {expanded && (
        <div className="pl-4 pr-1 pb-2 flex flex-col gap-2">
          {activeModels.map(modelCode => (
            <PredictionModelTable
              key={modelCode}
              modelCode={modelCode}
              layers={pred.predictions_by_model[modelCode] ?? []}
            />
          ))}
        </div>
      )}
    </li>
  )
}

function PredictionModelTable({
  modelCode,
  layers,
}: {
  modelCode: string
  layers: readonly { code: string; name: string; beschrijving: string; top_m_taw: number; base_m_taw: number; thickness_m: number; color_hex: string | null }[]
}): JSX.Element {
  return (
    <div>
      <p className="text-[10px] font-medium text-gray-500 mb-0.5">{modelCode}</p>
      {layers.length === 0 ? (
        <p className="text-[10px] text-gray-400 italic">
          No predicted layers at this point.
        </p>
      ) : (
        <ul className="flex flex-col">
          {layers.map(layer => (
            <li
              key={`${layer.code}-${layer.top_m_taw}`}
              className="flex items-center gap-1.5 text-[10px] text-gray-700 py-0.5"
              title={`${layer.name} (${layer.code})`}
            >
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm border border-gray-300 shrink-0"
                style={{ backgroundColor: layer.color_hex ?? '#9ca3af' }}
                aria-hidden
              />
              <span className="truncate flex-1">{layer.beschrijving || layer.name}</span>
              <span className="tabular-nums text-gray-500 whitespace-nowrap">
                {layer.top_m_taw.toFixed(2)} → {layer.base_m_taw.toFixed(2)} m
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Data stage inspector — investigation list (CPT + borehole tabs).
//
// Lifts the CPT and borehole list portions of Sidebar.tsx into the right
// inspector rail, sourcing all data from the ShellContext bus via useShell().
//
// Scope (per §4.5 and S4 boundary):
//   IN  — CPT tab: list, sort, search, multi-select, remove, restore, viewport
//          demotion, session-import amber markers.
//   IN  — Borehole tab: same capabilities.
//   OUT — Section list tab (X-sections): handled by SectionsInspector in S5.
//   OUT — Interpretation / geology tab: handled by GeologyStage inspector in S7.
//
// The project-name / dirty / close / edit-metadata header that was in
// Sidebar.tsx's top block moves to the StageToolbar right zone (committed in
// the next step). The inspector starts directly with the tab bar so the
// available vertical space goes to the list.
//
// Row components, sort helpers, and the hidden-separator are co-located here
// (copied from Sidebar.tsx and scoped to this file) so Sidebar.tsx is not
// deleted. Sidebar.tsx retains the section list + InterpretationPane content
// for S5/S7 consumption.

import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Drill,
  EyeOff,
  MapPin,
  Search,
  Trash2,
  X,
} from 'lucide-react'

import { useShell } from '../../ShellContext'
import { usePersistedJSON } from '../../../hooks/usePersistedJSON'
import DirtyAsterisk from '../../../components/ui/DirtyAsterisk'
import { isTypingTarget } from '../../../utils/keyboard'
import type { BoreholeAxis, BoreholeListItem, CptListItem } from '../../../api/client'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type InspectorTab = 'cpt' | 'borehole'

type SortKey = 'default' | 'name' | 'depth'
type SortDirection = 'asc' | 'desc'

interface SortState {
  key: SortKey
  direction: SortDirection
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const SORT_STORAGE_KEY = 'groundmodel.sidebar.sort'
const DEFAULT_SORT: SortState = { key: 'default', direction: 'asc' }

// Guard against corrupt localStorage entries (manual edits, migrations).
function parseSortState(raw: unknown): SortState {
  if (
    raw &&
    typeof raw === 'object' &&
    'key' in raw &&
    'direction' in raw &&
    typeof (raw as { key: unknown }).key === 'string' &&
    typeof (raw as { direction: unknown }).direction === 'string' &&
    ['default', 'name', 'depth'].includes((raw as { key: string }).key) &&
    ['asc', 'desc'].includes((raw as { direction: string }).direction)
  ) {
    return raw as SortState
  }
  return DEFAULT_SORT
}

// ---------------------------------------------------------------------------
// Natural-string collator (module-level — Intl.Collator construction is
// non-trivial; memoised once so per-render sort calls are cheap).
// ---------------------------------------------------------------------------

const NATURAL = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Right inspector content for the Data stage.
 *
 * Renders the CPT and borehole investigation lists with sort, search,
 * multi-select bulk-remove, viewport demotion, and session-import amber
 * markers.  All data is sourced from ``useShell()`` — no props required.
 *
 * Returns
 * -------
 * JSX.Element
 *     The inspector content element.
 */
export default function DataInspector(): JSX.Element {
  const {
    visibleCpts,
    visibleBoreholes,
    investigations: {
      removedCptIds,
      removedBoreholeIds,
      handleRemoveCpts,
      handleRemoveBoreholes,
      handleRestoreAllCpts,
      handleRestoreAllBoreholes,
    },
    // Coordinator owns: selection, view-mode, DXF export, viewport filter
    // sets, and the session-import sets (which span both the import flow
    // and the dirty-flag computation without belonging fully to either hook).
    coordinator: {
      selectedId,
      selectedBoreholeId,
      handleSelect,
      handleSelectBorehole,
      outOfViewportCptIds,
      outOfViewportBoreholeIds,
      sessionImportCptIds,
      sessionImportBoreholeIds,
    },
    mapState: {
      hiddenCptTypes,
      hiddenBoreholeValues,
      boreholeAxis,
    },
  } = useShell()

  const [activeTab, setActiveTab] = useState<InspectorTab>('cpt')

  // Sort — shared across tabs; persisted to localStorage at the same key
  // as the old Sidebar so the user's preference survives the migration.
  const [sort, setSort] = usePersistedJSON<SortState>(
    SORT_STORAGE_KEY,
    DEFAULT_SORT,
    parseSortState,
  )

  // Multi-select for bulk remove. Reset when the tab changes.
  const [selectedForRemoval, setSelectedForRemoval] = useState<Set<string>>(new Set())
  const [rangeAnchorId, setRangeAnchorId] = useState<string | null>(null)
  useEffect(() => {
    setSelectedForRemoval(new Set())
    setRangeAnchorId(null)
  }, [activeTab])

  // Substring search — ephemeral; resets on tab change.
  const [searchQuery, setSearchQuery] = useState('')
  useEffect(() => setSearchQuery(''), [activeTab])
  const searchLower = searchQuery.trim().toLowerCase()

  // Sorters — memoised so the per-row comparison is cheap.
  const cptSorter = useMemo(() => makeCptSorter(sort), [sort])
  const boreholeSorter = useMemo(
    () => makeBoreholeSorter(sort, boreholeAxis),
    [sort, boreholeAxis],
  )

  // Filtered + partitioned + sorted lists.
  const cptsAfterSearch = useMemo(
    () =>
      searchLower === ''
        ? visibleCpts
        : visibleCpts.filter(c => c.name.toLowerCase().includes(searchLower)),
    [visibleCpts, searchLower],
  )
  const boreholesAfterSearch = useMemo(
    () =>
      searchLower === ''
        ? visibleBoreholes
        : visibleBoreholes.filter(b => b.name.toLowerCase().includes(searchLower)),
    [visibleBoreholes, searchLower],
  )

  const cptVisible = useMemo(
    () =>
      cptsAfterSearch
        .filter(c => !hiddenCptTypes.has(c.cpt_type) && !outOfViewportCptIds.has(c.id))
        .sort(cptSorter),
    [cptsAfterSearch, hiddenCptTypes, outOfViewportCptIds, cptSorter],
  )
  const cptHidden = useMemo(
    () =>
      cptsAfterSearch
        .filter(c => hiddenCptTypes.has(c.cpt_type) || outOfViewportCptIds.has(c.id))
        .sort(cptSorter),
    [cptsAfterSearch, hiddenCptTypes, outOfViewportCptIds, cptSorter],
  )

  const bhVisible = useMemo(
    () =>
      boreholesAfterSearch
        .filter(b => {
          const filterValue =
            (boreholeAxis === 'drill_method' ? b.drill_method : b.borehole_type) || '—'
          return !hiddenBoreholeValues.has(filterValue) && !outOfViewportBoreholeIds.has(b.id)
        })
        .sort(boreholeSorter),
    [boreholesAfterSearch, hiddenBoreholeValues, outOfViewportBoreholeIds, boreholeAxis, boreholeSorter],
  )
  const bhHidden = useMemo(
    () =>
      boreholesAfterSearch
        .filter(b => {
          const filterValue =
            (boreholeAxis === 'drill_method' ? b.drill_method : b.borehole_type) || '—'
          return hiddenBoreholeValues.has(filterValue) || outOfViewportBoreholeIds.has(b.id)
        })
        .sort(boreholeSorter),
    [boreholesAfterSearch, hiddenBoreholeValues, outOfViewportBoreholeIds, boreholeAxis, boreholeSorter],
  )

  // Selection helpers — checkboxes for bulk remove.
  function toggleSelection(id: string): void {
    setSelectedForRemoval(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setRangeAnchorId(id)
  }

  function handleCheckboxClick(id: string, shiftKey: boolean): void {
    if (!shiftKey || rangeAnchorId === null || rangeAnchorId === id) {
      toggleSelection(id)
      return
    }
    const orderedIds =
      activeTab === 'cpt'
        ? [...cptVisible, ...cptHidden].map(c => c.id)
        : [...bhVisible, ...bhHidden].map(b => b.id)
    const anchorIdx = orderedIds.indexOf(rangeAnchorId)
    const targetIdx = orderedIds.indexOf(id)
    if (anchorIdx === -1 || targetIdx === -1) {
      toggleSelection(id)
      return
    }
    const [from, to] =
      anchorIdx <= targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx]
    setSelectedForRemoval(prev => {
      const next = new Set(prev)
      const mirrorChecked = prev.has(rangeAnchorId)
      for (let i = from; i <= to; i++) {
        const rid = orderedIds[i]
        if (mirrorChecked) next.add(rid)
        else next.delete(rid)
      }
      return next
    })
    // Anchor stays put — sequential shift-clicks pivot around it.
  }

  function clearSelection(): void {
    setSelectedForRemoval(new Set())
  }

  function selectAll(ids: string[]): void {
    setSelectedForRemoval(new Set(ids))
  }

  function bulkRemove(): void {
    const ids = [...selectedForRemoval]
    if (ids.length === 0) return
    if (activeTab === 'cpt') handleRemoveCpts(ids)
    else handleRemoveBoreholes(ids)
    setSelectedForRemoval(new Set())
  }

  const selectedCount = selectedForRemoval.size

  // Delete / Backspace shortcut — fires bulk-remove when ≥1 row is checked.
  useEffect(() => {
    if (selectedCount === 0) return
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (isTypingTarget(e.target)) return
      e.preventDefault()
      bulkRemove()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // reason: bulkRemove closes over activeTab + selectedForRemoval via
    // closure; including bulkRemove in deps re-binds the listener every
    // render without any behaviour change. The semantic deps (selectedCount
    // gates the handler, activeTab scopes the remove target) are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCount, activeTab])

  const activeVisibleIds =
    activeTab === 'cpt'
      ? [...cptVisible, ...cptHidden].map(c => c.id)
      : [...bhVisible, ...bhHidden].map(b => b.id)

  const removedCptCount = removedCptIds.size
  const removedBoreholeCount = removedBoreholeIds.size
  const removedCount = activeTab === 'cpt' ? removedCptCount : removedBoreholeCount
  const restoreAll = activeTab === 'cpt' ? handleRestoreAllCpts : handleRestoreAllBoreholes

  const hasList = visibleCpts.length > 0 || visibleBoreholes.length > 0

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tab bar — CPT / Borehole */}
      <div className="flex border-b border-gray-200 flex-shrink-0">
        <InspectorTab
          icon={<Activity size={13} />}
          label="CPT"
          active={activeTab === 'cpt'}
          onClick={() => setActiveTab('cpt')}
        />
        <InspectorTab
          icon={<Drill size={13} />}
          label="Borehole"
          active={activeTab === 'borehole'}
          onClick={() => setActiveTab('borehole')}
        />
      </div>

      {/* Search */}
      {hasList && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-gray-100 flex-shrink-0">
          <Search size={11} className="text-gray-400 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={activeTab === 'cpt' ? 'Search CPTs…' : 'Search boreholes…'}
            className="w-full bg-transparent text-xs text-gray-700 placeholder-gray-400 focus:outline-none"
          />
          {searchQuery !== '' && (
            <button
              onClick={() => setSearchQuery('')}
              title="Clear search"
              className="text-gray-400 hover:text-gray-700 shrink-0"
            >
              <X size={11} />
            </button>
          )}
        </div>
      )}

      {/* Bulk-action bar — visible when ≥1 checkbox is ticked */}
      {selectedCount > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 border-b border-blue-100 text-[11px] flex-shrink-0">
          <span className="text-blue-700 font-medium">{selectedCount} selected</span>
          <button
            onClick={bulkRemove}
            className="ml-auto px-2 py-0.5 rounded bg-red-600 text-white hover:bg-red-700 transition-colors text-[10px] font-semibold uppercase tracking-wide"
          >
            Remove
          </button>
          <button
            onClick={clearSelection}
            className="px-1.5 py-0.5 text-gray-500 hover:text-gray-700"
          >
            Clear
          </button>
        </div>
      )}

      {/* Sort + select-all row */}
      {hasList && (
        <div className="flex items-center gap-2 px-3 py-1 border-b border-gray-100 text-[10px] flex-shrink-0">
          <SortControl sort={sort} onChange={setSort} />
          <button
            onClick={() =>
              selectedCount === activeVisibleIds.length
                ? clearSelection()
                : selectAll(activeVisibleIds)
            }
            disabled={activeVisibleIds.length === 0}
            className="ml-auto text-gray-500 hover:text-gray-700 disabled:text-gray-300"
            title="Select all in this tab"
          >
            {selectedCount === activeVisibleIds.length && activeVisibleIds.length > 0
              ? 'Clear'
              : 'Select all'}
          </button>
        </div>
      )}

      {/* List — scrollable */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'cpt' &&
          (visibleCpts.length === 0 ? (
            <EmptyState
              label={removedCptCount > 0 ? 'All CPTs removed' : 'No CPTs imported yet'}
            />
          ) : cptVisible.length === 0 && cptHidden.length === 0 ? (
            <EmptyState
              label={searchLower !== '' ? 'No matches for this search' : 'No CPTs visible'}
            />
          ) : (
            <>
              {cptVisible.map(c => (
                <CptRow
                  key={c.id}
                  cpt={c}
                  selected={c.id === selectedId}
                  hidden={false}
                  unsaved={sessionImportCptIds?.has(c.id) ?? false}
                  checked={selectedForRemoval.has(c.id)}
                  onToggleCheck={shift => handleCheckboxClick(c.id, shift)}
                  onClick={() => void handleSelect(c.id)}
                  onRemove={() => handleRemoveCpts([c.id])}
                />
              ))}
              {cptHidden.length > 0 && <HiddenSeparator count={cptHidden.length} />}
              {cptHidden.map(c => (
                <CptRow
                  key={c.id}
                  cpt={c}
                  selected={c.id === selectedId}
                  hidden
                  unsaved={sessionImportCptIds?.has(c.id) ?? false}
                  checked={selectedForRemoval.has(c.id)}
                  onToggleCheck={shift => handleCheckboxClick(c.id, shift)}
                  onClick={() => void handleSelect(c.id)}
                  onRemove={() => handleRemoveCpts([c.id])}
                />
              ))}
            </>
          ))}

        {activeTab === 'borehole' &&
          (visibleBoreholes.length === 0 ? (
            <EmptyState
              label={
                removedBoreholeCount > 0 ? 'All boreholes removed' : 'No boreholes imported yet'
              }
            />
          ) : bhVisible.length === 0 && bhHidden.length === 0 ? (
            <EmptyState
              label={searchLower !== '' ? 'No matches for this search' : 'No boreholes visible'}
            />
          ) : (
            <>
              {bhVisible.map(b => (
                <BoreholeRow
                  key={b.id}
                  borehole={b}
                  selected={b.id === selectedBoreholeId}
                  hidden={false}
                  unsaved={sessionImportBoreholeIds?.has(b.id) ?? false}
                  checked={selectedForRemoval.has(b.id)}
                  onToggleCheck={shift => handleCheckboxClick(b.id, shift)}
                  onClick={() => void handleSelectBorehole(b.id)}
                  onRemove={() => handleRemoveBoreholes([b.id])}
                />
              ))}
              {bhHidden.length > 0 && <HiddenSeparator count={bhHidden.length} />}
              {bhHidden.map(b => (
                <BoreholeRow
                  key={b.id}
                  borehole={b}
                  selected={b.id === selectedBoreholeId}
                  hidden
                  unsaved={sessionImportBoreholeIds?.has(b.id) ?? false}
                  checked={selectedForRemoval.has(b.id)}
                  onToggleCheck={shift => handleCheckboxClick(b.id, shift)}
                  onClick={() => void handleSelectBorehole(b.id)}
                  onRemove={() => handleRemoveBoreholes([b.id])}
                />
              ))}
            </>
          ))}
      </div>

      {/* Footer — count + restore-removed link */}
      <div className="border-t border-gray-100 px-3 py-1.5 text-[10px] text-gray-400 flex items-center gap-2 flex-shrink-0">
        {activeTab === 'cpt' && (
          <span>{visibleCpts.length} CPT{visibleCpts.length !== 1 ? 's' : ''}</span>
        )}
        {activeTab === 'borehole' && (
          <span>
            {visibleBoreholes.length} borehole{visibleBoreholes.length !== 1 ? 's' : ''}
          </span>
        )}
        {removedCount > 0 && (
          <button
            onClick={restoreAll}
            className="ml-auto text-blue-600 hover:text-blue-800 hover:underline"
            title="Restore items removed from this project"
          >
            {removedCount} removed · restore all
          </button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab button
// ---------------------------------------------------------------------------

function InspectorTab({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'flex-1 flex flex-col items-center gap-0.5 py-1.5 text-[10px] font-medium transition-colors',
        active
          ? 'text-blue-600 border-b-2 border-blue-600'
          : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50',
      ].join(' ')}
    >
      {icon}
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Sort UI
// ---------------------------------------------------------------------------

function SortControl({
  sort,
  onChange,
}: {
  sort: SortState
  onChange: (next: SortState) => void
}) {
  const isDefault = sort.key === 'default'
  return (
    <div className="flex items-center gap-1 text-gray-500">
      <span className="text-gray-400">Sort:</span>
      <select
        value={sort.key}
        onChange={e => onChange({ ...sort, key: e.target.value as SortKey })}
        className="bg-transparent text-gray-700 cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-300 rounded"
      >
        <option value="default">Default</option>
        <option value="name">Name</option>
        <option value="depth">Depth</option>
      </select>
      <button
        onClick={() =>
          onChange({ ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' })
        }
        disabled={isDefault}
        className="text-gray-400 hover:text-gray-700 disabled:text-gray-200 disabled:cursor-not-allowed p-0.5"
        title={`Direction: ${sort.direction === 'asc' ? 'ascending' : 'descending'}`}
      >
        {sort.direction === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sorters
// ---------------------------------------------------------------------------

function makeCptSorter(sort: SortState): (a: CptListItem, b: CptListItem) => number {
  if (sort.key === 'default') return () => 0
  const sign = sort.direction === 'asc' ? 1 : -1
  if (sort.key === 'name') return (a, b) => sign * NATURAL.compare(a.name, b.name)
  // depth — null depths sort last regardless of direction.
  return (a, b) => {
    const da = a.max_depth_m
    const db = b.max_depth_m
    if (da == null && db == null) return 0
    if (da == null) return 1
    if (db == null) return -1
    return sign * (da - db)
  }
}

function makeBoreholeSorter(
  sort: SortState,
  _axis: BoreholeAxis,
): (a: BoreholeListItem, b: BoreholeListItem) => number {
  if (sort.key === 'default') return () => 0
  const sign = sort.direction === 'asc' ? 1 : -1
  if (sort.key === 'name') return (a, b) => sign * NATURAL.compare(a.name, b.name)
  return (a, b) => {
    const da = a.total_depth_m
    const db = b.total_depth_m
    if (da == null && db == null) return 0
    if (da == null) return 1
    if (db == null) return -1
    return sign * (da - db)
  }
}

// ---------------------------------------------------------------------------
// Hidden separator
// ---------------------------------------------------------------------------

function HiddenSeparator({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] uppercase tracking-wide text-gray-400 bg-gray-50 border-y border-gray-100">
      <EyeOff size={10} />
      <span>Hidden ({count})</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Row components (faithful copy from Sidebar.tsx, scoped to this file)
// ---------------------------------------------------------------------------

function cptBadgeColor(type: string) {
  switch (type) {
    case 'CPTU':
      return 'bg-blue-100 text-blue-700'
    case 'CPTE':
      return 'bg-green-100 text-green-700'
    case 'CPTM':
      return 'bg-orange-100 text-orange-700'
    default:
      return 'bg-gray-100 text-gray-500'
  }
}

function CptRow({
  cpt,
  selected,
  hidden,
  unsaved,
  checked,
  onToggleCheck,
  onClick,
  onRemove,
}: {
  cpt: CptListItem
  selected: boolean
  hidden: boolean
  unsaved: boolean
  checked: boolean
  onToggleCheck: (shiftKey: boolean) => void
  onClick: () => void
  onRemove: () => void
}) {
  function handleRemove(e: React.MouseEvent) {
    e.stopPropagation()
    onRemove()
  }

  return (
    <div
      className={[
        'group relative flex items-center border-b border-gray-100 transition-colors',
        unsaved ? 'border-l-4 border-l-amber-500' : 'border-l-2 border-l-transparent',
        selected
          ? 'bg-blue-50'
          : checked
          ? 'bg-blue-50/40'
          : unsaved
          ? 'bg-amber-100/70 hover:bg-amber-100/90'
          : 'hover:bg-gray-50',
        hidden ? 'opacity-40' : '',
      ].join(' ')}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={() => {}}
        onClick={e => {
          e.stopPropagation()
          onToggleCheck(e.shiftKey)
        }}
        className="ml-2 cursor-pointer"
      />
      <button onClick={onClick} className="flex-1 text-left px-2 py-2 pr-7 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <MapPin size={11} className={selected ? 'text-blue-500' : 'text-gray-400'} />
          <span className="text-xs font-medium text-gray-800 truncate">{cpt.name}</span>
          {unsaved && (
            <DirtyAsterisk title="Imported since last save — File → Save to commit" />
          )}
          {cpt.elevation_m == null && (
            <span title="No surface elevation — needs manual Z entry">
              <AlertTriangle size={10} className="text-amber-500 shrink-0" />
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 pl-4">
          <span className={`text-[10px] px-1 rounded font-mono ${cptBadgeColor(cpt.cpt_type)}`}>
            {cpt.cpt_type}
          </span>
          {cpt.max_depth_m != null && (
            <span className="text-[10px] text-gray-400">{cpt.max_depth_m.toFixed(1)} m</span>
          )}
        </div>
      </button>
      <button
        onClick={handleRemove}
        title="Remove from project"
        className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}

function BoreholeRow({
  borehole,
  selected,
  hidden,
  unsaved,
  checked,
  onToggleCheck,
  onClick,
  onRemove,
}: {
  borehole: BoreholeListItem
  selected: boolean
  hidden: boolean
  unsaved: boolean
  checked: boolean
  onToggleCheck: (shiftKey: boolean) => void
  onClick: () => void
  onRemove: () => void
}) {
  function handleRemove(e: React.MouseEvent) {
    e.stopPropagation()
    onRemove()
  }

  const noZ = borehole.elevation_m == null

  return (
    <div
      className={[
        'group relative flex items-center border-b border-gray-100 transition-colors',
        unsaved ? 'border-l-4 border-l-amber-500' : 'border-l-2 border-l-transparent',
        selected
          ? 'bg-blue-50'
          : checked
          ? 'bg-blue-50/40'
          : unsaved
          ? 'bg-amber-100/70 hover:bg-amber-100/90'
          : 'hover:bg-gray-50',
        hidden ? 'opacity-40' : '',
      ].join(' ')}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={() => {}}
        onClick={e => {
          e.stopPropagation()
          onToggleCheck(e.shiftKey)
        }}
        className="ml-2 cursor-pointer"
      />
      <button onClick={onClick} className="flex-1 text-left px-2 py-2 pr-7 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <Drill size={11} className={selected ? 'text-blue-500' : 'text-gray-400'} />
          <span className="text-xs font-medium text-gray-800 truncate">{borehole.name}</span>
          {unsaved && (
            <DirtyAsterisk title="Imported since last save — File → Save to commit" />
          )}
          {noZ && (
            <span title="No surface elevation — needs manual Z entry">
              <AlertTriangle size={10} className="text-amber-500 shrink-0" />
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 pl-4 text-[10px] text-gray-400">
          {borehole.total_depth_m != null && (
            <span>{borehole.total_depth_m.toFixed(1)} m</span>
          )}
          {borehole.drill_method && (
            <span className="truncate" title={borehole.drill_method}>
              · {borehole.drill_method}
            </span>
          )}
        </div>
      </button>
      <button
        onClick={handleRemove}
        title="Remove from project"
        className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center h-24 text-xs text-gray-400 px-4 text-center">
      {label}
    </div>
  )
}

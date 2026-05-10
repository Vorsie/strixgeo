import { useEffect, useMemo, useState } from 'react'
import { usePersistedJSON } from '../hooks/usePersistedJSON'
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Drill,
  EyeOff,
  Gauge,
  MapPin,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import type { BoreholeAxis, BoreholeListItem, CptListItem } from '../api/client'
import { isTypingTarget } from '../utils/keyboard'

type DataType = 'cpt' | 'borehole' | 'dmt'
type SortKey = 'default' | 'name' | 'depth'
type SortDirection = 'asc' | 'desc'

interface SortState {
  key: SortKey
  direction: SortDirection
}

interface Props {
  cpts: CptListItem[]
  boreholes: BoreholeListItem[]
  selectedCptId: string | null
  selectedBoreholeId: string | null
  onSelectCpt: (id: string) => void
  onSelectBorehole: (id: string) => void
  // Project-local removal — never touches the database. Bulk-capable so
  // the sidebar can wire a "Remove N" action straight through.
  onRemoveCpts: (ids: string[]) => void
  onRemoveBoreholes: (ids: string[]) => void
  removedCptCount: number
  removedBoreholeCount: number
  onRestoreAllCpts: () => void
  onRestoreAllBoreholes: () => void
  projectName: string
  // Path to the .gmproj file on disk; rendered as a tooltip on the
  // project name so the user can confirm which file is loaded without
  // leaving the sidebar. ``null`` when no project is open (currently
  // unreachable — Sidebar only mounts inside the loaded-project shell —
  // but kept optional so future surfaces can mount without a path).
  projectFilePath?: string | null
  // Click handler for the Close button next to the project name.
  // Mirrors the File-menu ``Close Project`` (Ctrl+W) for users who
  // navigate by mouse. Optional so test harnesses can mount the
  // sidebar without wiring close.
  onCloseProject?: () => void
  // Click handler for the project name itself. Opens the metadata
  // editor in the App shell. Optional for the same reason as the
  // others — test fixtures can omit it.
  onEditMetadata?: () => void
  // ``true`` when the live project state differs from the last-saved
  // snapshot. Renders an asterisk after the project name as a glance-
  // able dirty indicator (Word / Plaxis convention).
  projectDirty?: boolean
  // Map-layer visibility (kept from the previous turn) — still drives
  // the visible-first / hidden-bottom partitioning of each tab's list.
  hiddenCptTypes: Set<string>
  hiddenBoreholeValues: Set<string>
  boreholeAxis: BoreholeAxis
  // Viewport coupling (debt #14): records whose marker is currently
  // outside the map's visible bounds get demoted to the same hidden-
  // bottom section as the layer-control filter. Always-on — the
  // demotion is soft (opacity-40, still clickable, still counted in
  // the footer), so coupling never surprises the user by removing
  // things. The sets are computed in App from a Leaflet ``moveend``
  // listener; the Sidebar just unions them with ``hidden*`` for the
  // partition.
  outOfViewportCptIds: Set<string>
  outOfViewportBoreholeIds: Set<string>
}

const TABS: { id: DataType; label: string; icon: React.ReactNode; available: boolean }[] = [
  { id: 'cpt',      label: 'CPT',      icon: <Activity size={14} />,  available: true  },
  { id: 'borehole', label: 'Borehole', icon: <Drill size={14} />,     available: true  },
  { id: 'dmt',      label: 'DMT',      icon: <Gauge size={14} />,     available: false },
]

function cptBadgeColor(type: string) {
  switch (type) {
    case 'CPTU': return 'bg-blue-100 text-blue-700'
    case 'CPTE': return 'bg-green-100 text-green-700'
    case 'CPTM': return 'bg-orange-100 text-orange-700'
    default:     return 'bg-gray-100 text-gray-500'
  }
}

// Natural-string collator: sorts "B1, B2, B10, B20" instead of
// "B1, B10, B2, B20". Memoised at module level since Intl.Collator
// construction is non-trivial.
const NATURAL = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

const SORT_STORAGE_KEY = 'groundmodel.sidebar.sort'
const DEFAULT_SORT: SortState = { key: 'default', direction: 'asc' }

// Validator for the persisted sort state. Returns the default when the
// shape doesn't match — guards against corrupt localStorage entries
// (manual edits, schema migrations, etc.) without crashing on load.
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

export default function Sidebar({
  cpts,
  boreholes,
  selectedCptId,
  selectedBoreholeId,
  onSelectCpt,
  onSelectBorehole,
  onRemoveCpts,
  onRemoveBoreholes,
  removedCptCount,
  removedBoreholeCount,
  onRestoreAllCpts,
  onRestoreAllBoreholes,
  projectName,
  projectFilePath,
  onCloseProject,
  onEditMetadata,
  projectDirty,
  hiddenCptTypes,
  hiddenBoreholeValues,
  boreholeAxis,
  outOfViewportCptIds,
  outOfViewportBoreholeIds,
}: Props) {
  const [activeTab, setActiveTab] = useState<DataType>('cpt')

  // Sort selection persists across sessions so the user doesn't have to
  // re-pick after every restart. Single sort applies to whichever tab is
  // active; "default" maps back to insertion order (the order the API
  // returned). Same persistence semantics as the project-scoped
  // ``removed`` sets in App.tsx — different key shape (no project id)
  // because sort is a user-level preference, not project-level.
  const [sort, setSort] = usePersistedJSON<SortState>(
    SORT_STORAGE_KEY,
    DEFAULT_SORT,
    parseSortState,
  )

  // Multi-select state for bulk remove. Reset whenever the active tab
  // changes — the checkbox ids in one tab don't make sense in the
  // other, and keeping the set around just leads to "ghost" selections.
  const [selectedForRemoval, setSelectedForRemoval] = useState<Set<string>>(new Set())
  useEffect(() => setSelectedForRemoval(new Set()), [activeTab])

  // Substring search on row names. Ephemeral — resets when the user
  // switches tabs (CPT search and Borehole search are independent
  // contexts; carrying the query across is misleading). Lower-cased
  // once here so the per-row filter is just an ``includes`` check.
  const [searchQuery, setSearchQuery] = useState('')
  useEffect(() => setSearchQuery(''), [activeTab])
  const searchLower = searchQuery.trim().toLowerCase()

  // Sorted views — applied AFTER the visible/hidden partition computed
  // below so the partition is preserved (visible items still sort
  // ahead of hidden, and within each section the sort applies).
  const cptSorter = useMemo(() => makeCptSorter(sort), [sort])
  const boreholeSorter = useMemo(
    () => makeBoreholeSorter(sort, boreholeAxis),
    [sort, boreholeAxis],
  )

  // Search drops rows whose name doesn't contain the query (case-
  // insensitive substring). Empty query = pass everything through.
  // Applied BEFORE the visible/hidden partition so search results
  // still respect the map-filter / viewport partitioning.
  const matchesSearch = (name: string): boolean =>
    searchLower === '' || name.toLowerCase().includes(searchLower)
  const cptsAfterSearch = cpts.filter(c => matchesSearch(c.name))
  const boreholesAfterSearch = boreholes.filter(b => matchesSearch(b.name))

  // Partition each list into visible-first / hidden-bottom (driven by
  // the map's per-type filter AND the viewport filter when enabled),
  // then sort each partition independently. A row is "hidden" when its
  // type is filtered OR its marker is currently outside the map
  // viewport — both demote to the same greyed-out bottom section.
  const isCptHidden = (c: CptListItem): boolean =>
    hiddenCptTypes.has(c.cpt_type) || outOfViewportCptIds.has(c.id)
  const cptVisible = cptsAfterSearch.filter(c => !isCptHidden(c)).sort(cptSorter)
  const cptHidden = cptsAfterSearch.filter(isCptHidden).sort(cptSorter)

  const boreholeFilterValue = (b: BoreholeListItem): string =>
    (boreholeAxis === 'drill_method' ? b.drill_method : b.borehole_type) || '—'
  const isBoreholeHidden = (b: BoreholeListItem): boolean =>
    hiddenBoreholeValues.has(boreholeFilterValue(b)) ||
    outOfViewportBoreholeIds.has(b.id)
  const bhVisible = boreholesAfterSearch
    .filter(b => !isBoreholeHidden(b))
    .sort(boreholeSorter)
  const bhHidden = boreholesAfterSearch
    .filter(isBoreholeHidden)
    .sort(boreholeSorter)

  function toggleSelection(id: string): void {
    setSelectedForRemoval(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
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
    if (activeTab === 'cpt') onRemoveCpts(ids)
    else if (activeTab === 'borehole') onRemoveBoreholes(ids)
    setSelectedForRemoval(new Set())
  }

  // The action bar shows when ≥1 item is checked in the active tab.
  // Selecting items in the CPT tab and then switching to borehole
  // resets — see the useEffect above.
  const selectedCount = selectedForRemoval.size

  // Global Delete / Backspace shortcut: when ≥1 row is checked, fire
  // bulk-remove. Skipped when the focus is inside an input — Backspace
  // there means "delete a character" and stealing it would surprise.
  // ``Delete`` (forward-delete) is the standard on Windows; ``Backspace``
  // is the macOS equivalent — accept both.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCount, activeTab])

  // Visible IDs in the active tab (used by the "select all" link).
  const activeVisibleIds =
    activeTab === 'cpt'
      ? [...cptVisible, ...cptHidden].map(c => c.id)
      : [...bhVisible, ...bhHidden].map(b => b.id)

  // Per-tab removed-from-project counter for the footer.
  const removedCount =
    activeTab === 'cpt' ? removedCptCount : activeTab === 'borehole' ? removedBoreholeCount : 0
  const restoreAll = activeTab === 'cpt' ? onRestoreAllCpts : onRestoreAllBoreholes

  return (
    <aside className="flex flex-col w-56 shrink-0 border-r border-gray-200 bg-white overflow-hidden">
      {/* Project name + Close button. The name row is now clickable —
          opens the metadata editor in the App shell. The file path is
          a ``title`` tooltip so the user can confirm which .gmproj is
          loaded without leaving the sidebar. The Close button mirrors
          File-menu Ctrl+W for mouse users. */}
      <div className="group flex items-start gap-1 px-3 py-2 border-b border-gray-200 bg-gray-50">
        {onEditMetadata ? (
          <button
            onClick={onEditMetadata}
            title={
              projectFilePath
                ? `${projectFilePath} — click to edit project metadata`
                : 'Click to edit project metadata'
            }
            className="flex-1 min-w-0 text-left rounded -mx-1 px-1 py-0.5 hover:bg-gray-200 transition-colors"
          >
            <div className="text-[10px] text-gray-400 uppercase tracking-wide">Project</div>
            <div className="text-xs font-medium text-gray-700 truncate">
              {projectName}
              {projectDirty && (
                <span
                  className="text-amber-600 ml-1"
                  title="Unsaved changes — File → Save (Ctrl+S) to commit"
                >
                  *
                </span>
              )}
            </div>
          </button>
        ) : (
          <div
            className="flex-1 min-w-0"
            title={projectFilePath ?? undefined}
          >
            <div className="text-[10px] text-gray-400 uppercase tracking-wide">Project</div>
            <div className="text-xs font-medium text-gray-700 truncate">
              {projectName}
              {projectDirty && (
                <span
                  className="text-amber-600 ml-1"
                  title="Unsaved changes — File → Save (Ctrl+S) to commit"
                >
                  *
                </span>
              )}
            </div>
          </div>
        )}
        {onCloseProject && (
          <button
            // App owns the close UX — this button just signals intent.
            // App's ``attemptClose('sidebar')`` decides whether to show
            // the click-protection confirm or the save-on-close prompt
            // based on whether the metadata editor has unsaved drafts.
            onClick={onCloseProject}
            title="Close project — returns to the welcome screen. The .gmproj file and DB data are kept."
            className="p-0.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-gray-200">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => tab.available && setActiveTab(tab.id)}
            title={tab.available ? tab.label : `${tab.label} — Phase 3`}
            className={[
              'flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
              !tab.available
                ? 'text-gray-300 cursor-not-allowed'
                : activeTab === tab.id
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50',
            ].join(' ')}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search box. Substring filter on row name. Sits above the
          bulk-action / sort rows so the user can narrow the list
          first and the action bars stay attached to the (filtered)
          selection. Hidden on the DMT tab since there's nothing to
          search there yet. */}
      {activeTab !== 'dmt' && (cpts.length > 0 || boreholes.length > 0) && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-gray-100">
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

      {/* Bulk-action bar — only visible when ≥1 row is checked. Sits
          ABOVE the sort row so the "Remove N" action stays prominent
          regardless of how the list is ordered. */}
      {selectedCount > 0 && activeTab !== 'dmt' && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 border-b border-blue-100 text-[11px]">
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
      {activeTab !== 'dmt' && (cpts.length > 0 || boreholes.length > 0) && (
        <div className="flex items-center gap-2 px-3 py-1 border-b border-gray-100 text-[10px]">
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

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'cpt' &&
          (cpts.length === 0 ? (
            <EmptyState label={removedCptCount > 0 ? 'All CPTs removed' : 'No CPTs imported yet'} />
          ) : cptVisible.length === 0 && cptHidden.length === 0 ? (
            <EmptyState label={searchLower !== '' ? 'No matches for this search' : 'No CPTs visible'} />
          ) : (
            <>
              {cptVisible.map(c => (
                <CptRow
                  key={c.id}
                  cpt={c}
                  selected={c.id === selectedCptId}
                  hidden={false}
                  checked={selectedForRemoval.has(c.id)}
                  onToggleCheck={() => toggleSelection(c.id)}
                  onClick={() => onSelectCpt(c.id)}
                  onRemove={() => onRemoveCpts([c.id])}
                />
              ))}
              {cptHidden.length > 0 && <HiddenSeparator count={cptHidden.length} />}
              {cptHidden.map(c => (
                <CptRow
                  key={c.id}
                  cpt={c}
                  selected={c.id === selectedCptId}
                  hidden
                  checked={selectedForRemoval.has(c.id)}
                  onToggleCheck={() => toggleSelection(c.id)}
                  onClick={() => onSelectCpt(c.id)}
                  onRemove={() => onRemoveCpts([c.id])}
                />
              ))}
            </>
          ))}
        {activeTab === 'borehole' &&
          (boreholes.length === 0 ? (
            <EmptyState
              label={removedBoreholeCount > 0 ? 'All boreholes removed' : 'No boreholes imported yet'}
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
                  checked={selectedForRemoval.has(b.id)}
                  onToggleCheck={() => toggleSelection(b.id)}
                  onClick={() => onSelectBorehole(b.id)}
                  onRemove={() => onRemoveBoreholes([b.id])}
                />
              ))}
              {bhHidden.length > 0 && <HiddenSeparator count={bhHidden.length} />}
              {bhHidden.map(b => (
                <BoreholeRow
                  key={b.id}
                  borehole={b}
                  selected={b.id === selectedBoreholeId}
                  hidden
                  checked={selectedForRemoval.has(b.id)}
                  onToggleCheck={() => toggleSelection(b.id)}
                  onClick={() => onSelectBorehole(b.id)}
                  onRemove={() => onRemoveBoreholes([b.id])}
                />
              ))}
            </>
          ))}
        {activeTab === 'dmt' && <EmptyState label="Available in Phase 4" />}
      </div>

      {/* Footer */}
      <div className="border-t border-gray-100 px-3 py-1.5 text-[10px] text-gray-400 flex items-center gap-2">
        {activeTab === 'cpt' && (
          <span>{cpts.length} CPT{cpts.length !== 1 ? 's' : ''}</span>
        )}
        {activeTab === 'borehole' && (
          <span>
            {boreholes.length} borehole{boreholes.length !== 1 ? 's' : ''}
          </span>
        )}
        {activeTab === 'dmt' && <span>—</span>}
        {removedCount > 0 && activeTab !== 'dmt' && (
          <button
            onClick={restoreAll}
            className="ml-auto text-blue-600 hover:text-blue-800 hover:underline"
            title="Restore items removed from this project"
          >
            {removedCount} removed · restore all
          </button>
        )}
      </div>
    </aside>
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
        onClick={() => onChange({ ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' })}
        disabled={isDefault}
        className="text-gray-400 hover:text-gray-700 disabled:text-gray-200 disabled:cursor-not-allowed p-0.5"
        title={`Direction: ${sort.direction === 'asc' ? 'ascending' : 'descending'}`}
      >
        {sort.direction === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
      </button>
    </div>
  )
}

function makeCptSorter(sort: SortState): (a: CptListItem, b: CptListItem) => number {
  if (sort.key === 'default') return () => 0
  const sign = sort.direction === 'asc' ? 1 : -1
  if (sort.key === 'name') return (a, b) => sign * NATURAL.compare(a.name, b.name)
  // depth — null depths sort last regardless of direction; comparing nulls is
  // always ambiguous and putting them at the bottom matches user expectation.
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
// Row components
// ---------------------------------------------------------------------------

function HiddenSeparator({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] uppercase tracking-wide text-gray-400 bg-gray-50 border-y border-gray-100">
      <EyeOff size={10} />
      <span>Hidden ({count})</span>
    </div>
  )
}

function CptRow({
  cpt,
  selected,
  hidden,
  checked,
  onToggleCheck,
  onClick,
  onRemove,
}: {
  cpt: CptListItem
  selected: boolean
  hidden: boolean
  checked: boolean
  onToggleCheck: () => void
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
        selected ? 'bg-blue-50' : checked ? 'bg-blue-50/40' : 'hover:bg-gray-50',
        hidden ? 'opacity-40' : '',
      ].join(' ')}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggleCheck}
        onClick={e => e.stopPropagation()}
        className="ml-2 cursor-pointer"
      />
      <button onClick={onClick} className="flex-1 text-left px-2 py-2 pr-7 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <MapPin size={11} className={selected ? 'text-blue-500' : 'text-gray-400'} />
          <span className="text-xs font-medium text-gray-800 truncate">{cpt.name}</span>
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

      {/* Single-row remove (project-local). Visible on hover so the
          row body stays clean; the bulk action bar covers the multi-row
          flow when checkboxes drive the selection. */}
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
  checked,
  onToggleCheck,
  onClick,
  onRemove,
}: {
  borehole: BoreholeListItem
  selected: boolean
  hidden: boolean
  checked: boolean
  onToggleCheck: () => void
  onClick: () => void
  onRemove: () => void
}) {
  function handleRemove(e: React.MouseEvent) {
    e.stopPropagation()
    onRemove()
  }

  // Phase 3a UX requirement: surface NO_ELEVATION boreholes distinctly so
  // the user knows they need to add a Z manually (the inline editor lands
  // in a later PR; this row just flags the state).
  const noZ = borehole.elevation_m == null

  return (
    <div
      className={[
        'group relative flex items-center border-b border-gray-100 transition-colors',
        selected ? 'bg-blue-50' : checked ? 'bg-blue-50/40' : 'hover:bg-gray-50',
        hidden ? 'opacity-40' : '',
      ].join(' ')}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggleCheck}
        onClick={e => e.stopPropagation()}
        className="ml-2 cursor-pointer"
      />
      <button onClick={onClick} className="flex-1 text-left px-2 py-2 pr-7 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <Drill size={11} className={selected ? 'text-blue-500' : 'text-gray-400'} />
          <span className="text-xs font-medium text-gray-800 truncate">{borehole.name}</span>
          {noZ && (
            <span title="No surface elevation — needs manual Z entry">
              <AlertTriangle size={10} className="text-amber-500 shrink-0" />
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 pl-4 text-[10px] text-gray-400">
          {borehole.total_depth_m != null && <span>{borehole.total_depth_m.toFixed(1)} m</span>}
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



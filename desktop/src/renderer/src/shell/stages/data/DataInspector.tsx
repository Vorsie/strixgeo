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
  Calendar,
  Drill,
  EyeOff,
  Inbox,
  MapPin,
  Search,
  Trash2,
  X,
} from 'lucide-react'

import { useShell } from '../../ShellContext'
import { EmptyState as SharedEmptyState } from '../../EmptyState'
import { usePersistedJSON } from '../../../hooks/usePersistedJSON'
import DirtyAsterisk from '../../../components/ui/DirtyAsterisk'
import TabBar from '../../../components/ui/TabBar'
import { isTypingTarget } from '../../../utils/keyboard'
import { isWithinDateRange, parseInvestigationDate } from '../../../utils/investigationDate'
import type { BoreholeAxis, BoreholeListItem, CptListItem } from '../../../api/client'
import { useT } from '../../../i18n/translate'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Binary by design: the Data stage inspector only lists investigations.
// The old Sidebar had Tests/Visualisation/Interpretation tabs and needed a
// `: []` guard on its tab ternaries; here `activeTab` is strictly one of
// these two, so the `cpt ? … : borehole` ternaries below are exhaustive —
// a third `: []` branch would be unreachable dead code.
type InspectorTab = 'cpt' | 'borehole'

// 'date' sorts by start_date ascending/descending; null dates sort LAST in
// both directions so they never interleave with real dates (stable behaviour).
type SortKey = 'default' | 'name' | 'depth' | 'date'
type SortDirection = 'asc' | 'desc'

interface SortState {
  key: SortKey
  direction: SortDirection
}

// Per-tab date range filter. Stored as ISO YYYY-MM-DD strings matching the
// <input type="date"> value format — empty string means "no bound set".
// The tabs are kept independent (CPT and borehole have different date ranges).
interface DateRangeFilter {
  from: string
  to: string
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const SORT_STORAGE_KEY = 'groundmodel.sidebar.sort'
const DEFAULT_SORT: SortState = { key: 'default', direction: 'asc' }

// Date-range filter keys are per-tab so each investigation type persists its
// own date window independently (mirrors how multi-select is tab-scoped).
const DATE_FILTER_CPT_KEY = 'groundmodel.sidebar.datefilter.cpt'
const DATE_FILTER_BH_KEY = 'groundmodel.sidebar.datefilter.borehole'
const DEFAULT_DATE_FILTER: DateRangeFilter = { from: '', to: '' }

// Guard against corrupt localStorage entries (manual edits, migrations).
function parseSortState(raw: unknown): SortState {
  if (
    raw &&
    typeof raw === 'object' &&
    'key' in raw &&
    'direction' in raw &&
    typeof (raw as { key: unknown }).key === 'string' &&
    typeof (raw as { direction: unknown }).direction === 'string' &&
    ['default', 'name', 'depth', 'date'].includes((raw as { key: string }).key) &&
    ['asc', 'desc'].includes((raw as { direction: string }).direction)
  ) {
    return raw as SortState
  }
  return DEFAULT_SORT
}

function parseDateFilter(raw: unknown): DateRangeFilter {
  if (
    raw &&
    typeof raw === 'object' &&
    'from' in raw &&
    'to' in raw &&
    typeof (raw as { from: unknown }).from === 'string' &&
    typeof (raw as { to: unknown }).to === 'string'
  ) {
    return { from: (raw as DateRangeFilter).from, to: (raw as DateRangeFilter).to }
  }
  return DEFAULT_DATE_FILTER
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
  const t = useT()
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
      marqueeSelectedIds,
      setHoveredTestId,
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

  // Date range filter — per-tab; persisted independently so the user's CPT
  // date window is not clobbered when they switch to the borehole tab.
  const [cptDateFilter, setCptDateFilter] = usePersistedJSON<DateRangeFilter>(
    DATE_FILTER_CPT_KEY,
    DEFAULT_DATE_FILTER,
    parseDateFilter,
  )
  const [bhDateFilter, setBhDateFilter] = usePersistedJSON<DateRangeFilter>(
    DATE_FILTER_BH_KEY,
    DEFAULT_DATE_FILTER,
    parseDateFilter,
  )

  // Active filter for the current tab — aliased for cleaner template reads.
  const activeDateFilter = activeTab === 'cpt' ? cptDateFilter : bhDateFilter
  const setActiveDateFilter = activeTab === 'cpt' ? setCptDateFilter : setBhDateFilter

  // Multi-select for bulk remove. Reset when the tab changes.
  const [selectedForRemoval, setSelectedForRemoval] = useState<Set<string>>(new Set())
  const [rangeAnchorId, setRangeAnchorId] = useState<string | null>(null)
  useEffect(() => {
    setSelectedForRemoval(new Set())
    setRangeAnchorId(null)
  }, [activeTab])

  // Sync list checkboxes from the map marquee selection.
  //
  // When the user Shift-drags a rectangle on the map, the resulting set of
  // investigation IDs replaces selectedForRemoval so the list checkboxes
  // mirror what is highlighted on the map.  An empty marquee set (cleared by
  // a subsequent plain click or ESC) resets the list selection to nothing.
  // The effect only fires when marqueeSelectedIds actually changes identity —
  // Map referential equality ensures this is once per completed drag, not per
  // render.
  useEffect(() => {
    setSelectedForRemoval(new Set(marqueeSelectedIds))
    setRangeAnchorId(null)
    // reason: marqueeSelectedIds is a ReadonlySet coming from coordinator
    // state; its identity only changes when the marquee drag completes (map
    // fires setMarqueeSelectedIds).  Including setSelectedForRemoval /
    // setRangeAnchorId would require stable refs that are already stable in
    // practice but not guaranteed by TypeScript; the semantic dep is the
    // marquee set identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marqueeSelectedIds])

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

  // "Active" = at least one bound parses to a real date. Used only in the
  // footer JSX (NOT in any memo dep array) so re-creating these Date
  // objects per render is harmless here — the filter memos below depend
  // on the raw filter strings, not on parsed Date identity (S2).
  const cptDateActive =
    parseInvestigationDate(cptDateFilter.from || null) !== null ||
    parseInvestigationDate(cptDateFilter.to || null) !== null
  const bhDateActive =
    parseInvestigationDate(bhDateFilter.from || null) !== null ||
    parseInvestigationDate(bhDateFilter.to || null) !== null

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

  // Apply the date range filter after the name search.
  // An item with no parseable date is EXCLUDED while any bound is set, and
  // shown when no bound is set (items with no date sort last; they are not
  // hidden until the user sets a bound — that would be surprising).
  // Dep arrays carry only the stable primitive filter strings — the date
  // parsing happens inside isWithinDateRange, so the memo recomputes only
  // when a bound string actually changes, not on every render (S2). The
  // shared predicate keeps the CPT and Borehole filters provably identical.
  const cptsAfterDate = useMemo(
    () =>
      cptsAfterSearch.filter(c =>
        isWithinDateRange(c.start_date, cptDateFilter.from, cptDateFilter.to),
      ),
    [cptsAfterSearch, cptDateFilter.from, cptDateFilter.to],
  )

  const boreholesAfterDate = useMemo(
    () =>
      boreholesAfterSearch.filter(b =>
        isWithinDateRange(b.start_date, bhDateFilter.from, bhDateFilter.to),
      ),
    [boreholesAfterSearch, bhDateFilter.from, bhDateFilter.to],
  )

  const cptVisible = useMemo(
    () =>
      cptsAfterDate
        .filter(c => !hiddenCptTypes.has(c.cpt_type) && !outOfViewportCptIds.has(c.id))
        .sort(cptSorter),
    [cptsAfterDate, hiddenCptTypes, outOfViewportCptIds, cptSorter],
  )
  const cptHidden = useMemo(
    () =>
      cptsAfterDate
        .filter(c => hiddenCptTypes.has(c.cpt_type) || outOfViewportCptIds.has(c.id))
        .sort(cptSorter),
    [cptsAfterDate, hiddenCptTypes, outOfViewportCptIds, cptSorter],
  )

  const bhVisible = useMemo(
    () =>
      boreholesAfterDate
        .filter(b => {
          const filterValue =
            (boreholeAxis === 'drill_method' ? b.drill_method : b.borehole_type) || '—'
          // hiddenBoreholeValues is Record<BoreholeAxis, Set<string>> — index
          // by the active axis to get the Set (the old App did this inline
          // before passing the per-axis Set into Sidebar; the bus carries
          // the full Record so the indexing moves here).
          return (
            !hiddenBoreholeValues[boreholeAxis].has(filterValue) &&
            !outOfViewportBoreholeIds.has(b.id)
          )
        })
        .sort(boreholeSorter),
    [boreholesAfterDate, hiddenBoreholeValues, outOfViewportBoreholeIds, boreholeAxis, boreholeSorter],
  )
  const bhHidden = useMemo(
    () =>
      boreholesAfterDate
        .filter(b => {
          const filterValue =
            (boreholeAxis === 'drill_method' ? b.drill_method : b.borehole_type) || '—'
          return (
            hiddenBoreholeValues[boreholeAxis].has(filterValue) ||
            outOfViewportBoreholeIds.has(b.id)
          )
        })
        .sort(boreholeSorter),
    [boreholesAfterDate, hiddenBoreholeValues, outOfViewportBoreholeIds, boreholeAxis, boreholeSorter],
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
      {/* Tab bar — CPT / Borehole.
          TabBar provides role="tablist" + role="tab" + aria-selected +
          Arrow-Left/Right keyboard navigation. Active/inactive colours are
          applied via Tailwind's aria-selected: modifier so the component
          stays stateless (no duplicate active-tab prop). */}
      <TabBar
        tabs={[
          {
            id: 'cpt',
            label: 'CPT',
            icon: <Activity size={13} aria-hidden="true" />,
            // Tutorial anchor (Chapter 2: filter the list by test type).
            testid: 'data-filter-testtype-cpt',
          },
          {
            id: 'borehole',
            label: 'Borehole',
            icon: <Drill size={13} aria-hidden="true" />,
            testid: 'data-filter-testtype-borehole',
          },
        ]}
        activeId={activeTab}
        onActivate={id => setActiveTab(id as InspectorTab)}
        ariaLabel="Investigation type"
        layout="col"
        containerClassName="flex border-b border-[--color-border-subtle] flex-shrink-0"
        tabClassName="flex-1 py-1.5 text-[10px] font-medium transition-colors border-b-2 aria-selected:text-[--color-accent] aria-selected:border-[--color-accent] aria-[selected=false]:text-[--color-text-secondary] aria-[selected=false]:border-transparent aria-[selected=false]:hover:text-[--color-text-primary] aria-[selected=false]:hover:bg-[--color-surface-card]"
      />

      {/* Search */}
      {hasList && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-[--color-border-subtle] flex-shrink-0">
          <Search size={11} className="text-[--color-text-muted] shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={activeTab === 'cpt' ? t('data.inspector.searchCpts') : t('data.inspector.searchBoreholes')}
            className="w-full bg-transparent text-xs text-[--color-text-secondary] placeholder-[--color-text-muted] focus:outline-none"
          />
          {searchQuery !== '' && (
            <button
              onClick={() => setSearchQuery('')}
              title={t('data.inspector.clearSearch')}
              className="text-[--color-text-muted] hover:text-[--color-text-secondary] shrink-0"
            >
              <X size={11} />
            </button>
          )}
        </div>
      )}

      {/* Date-range filter */}
      {hasList && (
        <DateRangeControl
          filter={activeDateFilter}
          onChange={setActiveDateFilter}
        />
      )}

      {/* Bulk-action bar — visible when ≥1 checkbox is ticked */}
      {selectedCount > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 dark:bg-blue-950/30 border-b border-blue-100 dark:border-blue-900/40 text-[11px] flex-shrink-0">
          <span className="text-accent font-medium">{t('data.inspector.selectedCount', { n: selectedCount })}</span>
          <button
            onClick={bulkRemove}
            // Remove is a project-local hide — reversible — so it uses a
            // neutral secondary token, NOT bg-status-danger (which is
            // reserved for irreversible destructive actions per UX rule).
            className="ml-auto px-2 py-0.5 rounded bg-surface-page border border-border-default text-text-primary hover:bg-surface-card transition-colors text-[10px] font-semibold uppercase tracking-wide"
          >
            {t('common.remove')}
          </button>
          <button
            onClick={clearSelection}
            className="px-1.5 py-0.5 text-[--color-text-secondary] hover:text-[--color-text-primary]"
          >
            {t('data.inspector.clear')}
          </button>
        </div>
      )}

      {/* Sort + select-all row */}
      {hasList && (
        <div className="flex items-center gap-2 px-3 py-1 border-b border-[--color-border-subtle] text-[10px] flex-shrink-0">
          <SortControl sort={sort} onChange={setSort} />
          <button
            onClick={() =>
              selectedCount === activeVisibleIds.length
                ? clearSelection()
                : selectAll(activeVisibleIds)
            }
            disabled={activeVisibleIds.length === 0}
            className="ml-auto text-[--color-text-secondary] hover:text-[--color-text-primary] disabled:text-[--color-text-muted] disabled:cursor-not-allowed"
            title={t('data.inspector.selectAllInTab')}
          >
            {selectedCount === activeVisibleIds.length && activeVisibleIds.length > 0
              ? t('data.inspector.clear')
              : t('data.inspector.selectAll')}
          </button>
        </div>
      )}

      {/* List — scrollable */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'cpt' &&
          (visibleCpts.length === 0 ? (
            <EmptyState
              label={
                removedCptCount > 0
                  ? t('data.inspector.allCptsRemoved')
                  : t('data.inspector.noCptsImported')
              }
            />
          ) : cptVisible.length === 0 && cptHidden.length === 0 ? (
            <EmptyState
              isSearch={searchLower !== ''}
              label={
                searchLower !== ''
                  ? t('data.inspector.noMatches')
                  : t('data.inspector.noCptsVisible')
              }
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
                  onHover={h => setHoveredTestId(h ? c.id : null)}
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
                  onHover={h => setHoveredTestId(h ? c.id : null)}
                />
              ))}
            </>
          ))}

        {activeTab === 'borehole' &&
          (visibleBoreholes.length === 0 ? (
            <EmptyState
              label={
                removedBoreholeCount > 0
                  ? t('data.inspector.allBoreholesRemoved')
                  : t('data.inspector.noBoreholesImported')
              }
            />
          ) : bhVisible.length === 0 && bhHidden.length === 0 ? (
            <EmptyState
              isSearch={searchLower !== ''}
              label={
                searchLower !== ''
                  ? t('data.inspector.noMatches')
                  : t('data.inspector.noBoreholesVisible')
              }
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
                  onHover={h => setHoveredTestId(h ? b.id : null)}
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
                  onHover={h => setHoveredTestId(h ? b.id : null)}
                />
              ))}
            </>
          ))}
      </div>

      {/* Footer — count + restore-removed link */}
      <div className="border-t border-[--color-border-subtle] px-3 py-1.5 text-[10px] text-[--color-text-muted] flex items-center gap-2 flex-shrink-0">
        {activeTab === 'cpt' && (
          <span>
            {cptDateActive
              ? t('data.inspector.countOfTotal', {
                  shown: cptsAfterDate.length,
                  total: cptsAfterSearch.length,
                  noun: t(
                    cptsAfterSearch.length !== 1
                      ? 'data.inspector.cptWordMany'
                      : 'data.inspector.cptWordOne',
                  ),
                })
              : t('data.inspector.count', {
                  n: visibleCpts.length,
                  noun: t(
                    visibleCpts.length !== 1
                      ? 'data.inspector.cptWordMany'
                      : 'data.inspector.cptWordOne',
                  ),
                })}
          </span>
        )}
        {activeTab === 'borehole' && (
          <span>
            {bhDateActive
              ? t('data.inspector.countOfTotal', {
                  shown: boreholesAfterDate.length,
                  total: boreholesAfterSearch.length,
                  noun: t(
                    boreholesAfterSearch.length !== 1
                      ? 'geology.boreholeWordMany'
                      : 'geology.boreholeWordOne',
                  ),
                })
              : t('data.inspector.count', {
                  n: visibleBoreholes.length,
                  noun: t(
                    visibleBoreholes.length !== 1
                      ? 'geology.boreholeWordMany'
                      : 'geology.boreholeWordOne',
                  ),
                })}
          </span>
        )}
        {removedCount > 0 && (
          <button
            onClick={restoreAll}
            className="ml-auto text-[--color-accent] hover:underline"
            title={t('data.inspector.restoreRemovedTitle')}
          >
            {t('data.inspector.removedRestoreAll', { n: removedCount })}
          </button>
        )}
      </div>
    </div>
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
  const t = useT()
  const isDefault = sort.key === 'default'
  return (
    <div className="flex items-center gap-1 text-[--color-text-secondary]">
      <span className="text-[--color-text-muted]">{t('data.inspector.sortLabel')}</span>
      <select
        value={sort.key}
        onChange={e => onChange({ ...sort, key: e.target.value as SortKey })}
        className="bg-transparent text-[--color-text-secondary] cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent rounded"
      >
        <option value="default">{t('data.inspector.sortDefault')}</option>
        <option value="name">{t('common.name')}</option>
        <option value="depth">{t('common.depth')}</option>
        <option value="date">{t('data.inspector.sortDate')}</option>
      </select>
      <button
        onClick={() =>
          onChange({ ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' })
        }
        disabled={isDefault}
        className="text-[--color-text-muted] hover:text-[--color-text-primary] disabled:text-[--color-text-muted] disabled:opacity-40 disabled:cursor-not-allowed p-0.5"
        title={t(sort.direction === 'asc' ? 'data.inspector.directionAsc' : 'data.inspector.directionDesc')}
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
  if (sort.key === 'date') {
    // Null dates sort LAST in both directions (stable: never interleave with
    // real dates). The sort is by Date.getTime() so all parseInvestigationDate
    // tolerance (ISO, slash, year-only) is applied here.
    return (a, b) => {
      const da = parseInvestigationDate(a.start_date)
      const db = parseInvestigationDate(b.start_date)
      if (da === null && db === null) return 0
      if (da === null) return 1 // a has no date → always last
      if (db === null) return -1 // b has no date → always last
      return sign * (da.getTime() - db.getTime())
    }
  }
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
  if (sort.key === 'date') {
    // Null dates sort LAST in both directions.
    return (a, b) => {
      const da = parseInvestigationDate(a.start_date)
      const db = parseInvestigationDate(b.start_date)
      if (da === null && db === null) return 0
      if (da === null) return 1
      if (db === null) return -1
      return sign * (da.getTime() - db.getTime())
    }
  }
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
  const t = useT()
  return (
    <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] uppercase tracking-wide text-[--color-text-muted] bg-[--color-surface-card] border-y border-[--color-border-subtle]">
      <EyeOff size={10} />
      <span>{t('data.inspector.hiddenCount', { n: count })}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Row components (faithful copy from Sidebar.tsx, scoped to this file)
// ---------------------------------------------------------------------------

function cptBadgeColor(type: string) {
  switch (type) {
    case 'CPTU':
      return 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
    case 'CPTE':
      return 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
    case 'CPTM':
      return 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300'
    default:
      return 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-300'
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
  onHover,
}: {
  cpt: CptListItem
  selected: boolean
  hidden: boolean
  unsaved: boolean
  checked: boolean
  onToggleCheck: (shiftKey: boolean) => void
  onClick: () => void
  onRemove: () => void
  /** Row hover — highlights the matching map marker (if visible). */
  onHover?: (hovered: boolean) => void
}) {
  const t = useT()
  function handleRemove(e: React.MouseEvent) {
    e.stopPropagation()
    onRemove()
  }

  return (
    <div
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      className={[
        'group relative flex items-center border-b border-[--color-border-subtle] transition-colors',
        unsaved ? 'border-l-4 border-l-status-amber' : 'border-l-2 border-l-transparent',
        selected
          ? 'bg-blue-50 dark:bg-blue-950/30'
          : checked
          ? 'bg-blue-50/40 dark:bg-blue-950/20'
          : unsaved
          ? 'bg-amber-100/70 dark:bg-amber-950/30 hover:bg-amber-100/90 dark:hover:bg-amber-950/40'
          : 'hover:bg-[--color-surface-card]',
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
          <MapPin size={11} className={selected ? 'text-[--color-accent]' : 'text-[--color-text-muted]'} />
          {/* text-[--color-text-primary] is the semantic token for primary body text.
              Previously text-gray-800 (#1f2937) — invisible on dark inspector surface. */}
          <span className="text-xs font-medium text-[--color-text-primary] truncate">{cpt.name}</span>
          {unsaved && (
            <DirtyAsterisk title={t('data.inspector.importedSinceSave')} />
          )}
          {cpt.elevation_m == null && (
            <span title={t('data.inspector.noSurfaceElevation')}>
              <AlertTriangle size={10} className="text-status-amber shrink-0" />
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 pl-4">
          <span className={`text-[10px] px-1 rounded font-mono ${cptBadgeColor(cpt.cpt_type)}`}>
            {cpt.cpt_type}
          </span>
          {cpt.max_depth_m != null && (
            <span className="text-[10px] text-[--color-text-muted]">{cpt.max_depth_m.toFixed(1)} m</span>
          )}
        </div>
      </button>
      <button
        onClick={handleRemove}
        title={t('data.inspector.removeFromProject')}
        // Tutorial anchor (Chapter 2: hiding a test is a reversible, project-local
        data-testid="data-row-remove"
        className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded text-[--color-text-muted] hover:text-status-danger hover:bg-surface-app opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
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
  onHover,
}: {
  borehole: BoreholeListItem
  selected: boolean
  hidden: boolean
  unsaved: boolean
  checked: boolean
  onToggleCheck: (shiftKey: boolean) => void
  onClick: () => void
  onRemove: () => void
  /** Row hover — highlights the matching map marker (if visible). */
  onHover?: (hovered: boolean) => void
}) {
  const t = useT()
  function handleRemove(e: React.MouseEvent) {
    e.stopPropagation()
    onRemove()
  }

  const noZ = borehole.elevation_m == null

  return (
    <div
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      className={[
        'group relative flex items-center border-b border-[--color-border-subtle] transition-colors',
        unsaved ? 'border-l-4 border-l-status-amber' : 'border-l-2 border-l-transparent',
        selected
          ? 'bg-blue-50 dark:bg-blue-950/30'
          : checked
          ? 'bg-blue-50/40 dark:bg-blue-950/20'
          : unsaved
          ? 'bg-amber-100/70 dark:bg-amber-950/30 hover:bg-amber-100/90 dark:hover:bg-amber-950/40'
          : 'hover:bg-[--color-surface-card]',
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
          <Drill size={11} className={selected ? 'text-[--color-accent]' : 'text-[--color-text-muted]'} />
          {/* text-[--color-text-primary] is the semantic token for primary body text.
              Previously text-gray-800 (#1f2937) — invisible on dark inspector surface. */}
          <span className="text-xs font-medium text-[--color-text-primary] truncate">{borehole.name}</span>
          {unsaved && (
            <DirtyAsterisk title={t('data.inspector.importedSinceSave')} />
          )}
          {noZ && (
            <span title={t('data.inspector.noSurfaceElevation')}>
              <AlertTriangle size={10} className="text-status-amber shrink-0" />
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 pl-4 text-[10px] text-[--color-text-muted]">
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
        title={t('data.inspector.removeFromProject')}
        // Tutorial anchor (Chapter 2: hiding a test is a reversible, project-local
        data-testid="data-row-remove"
        className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded text-[--color-text-muted] hover:text-status-danger hover:bg-surface-app opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Date range filter control
// ---------------------------------------------------------------------------

/**
 * Date range filter bar rendered below the search box.
 *
 * Shows From / To date inputs (native ``<input type="date">`` — accessible,
 * keyboard-navigable, dark-mode-correct via Tailwind CSS variables) and a
 * clear affordance when either bound is set.  Either bound is optional
 * (open-ended range).
 *
 * The filter is reversible (fire immediately, no confirm required per the
 * UX rule).  The clear button resets both bounds to '' in one setState so
 * there is no intermediate half-cleared state.
 *
 * Parameters
 * ----------
 * filter
 *     Current from/to strings (ISO ``YYYY-MM-DD`` matching ``<input type="date">``).
 * onChange
 *     Setter for the filter state.
 *
 * Returns
 * -------
 * JSX.Element
 *     The filter row, or null when no investigations are loaded.
 */
function DateRangeControl({
  filter,
  onChange,
}: {
  filter: DateRangeFilter
  onChange: (next: DateRangeFilter) => void
}): JSX.Element {
  const t = useT()
  const active = filter.from !== '' || filter.to !== ''

  return (
    <div
      data-testid="data-filter-date"
      className="px-3 py-1.5 border-b border-[--color-border-subtle] flex-shrink-0"
    >
      <div className="flex items-center gap-1 mb-1">
        <Calendar size={11} className="text-[--color-text-muted] shrink-0" />
        <span className="text-[10px] text-[--color-text-muted]">{t('data.inspector.dateRange')}</span>
        {active && (
          <button
            onClick={() => onChange({ from: '', to: '' })}
            title={t('data.inspector.clearDateFilter')}
            className="ml-auto text-[10px] text-[--color-accent] hover:underline"
          >
            {t('data.inspector.clear')}
          </button>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {/* From bound. The native date picker is keyboard-navigable and
            announces itself properly to screen readers via the label. */}
        <label className="sr-only" htmlFor="date-filter-from">{t('data.inspector.fromDate')}</label>
        <input
          id="date-filter-from"
          type="date"
          value={filter.from}
          onChange={e => onChange({ ...filter, from: e.target.value })}
          className={[
            'flex-1 min-w-0 bg-transparent text-[10px] text-[--color-text-secondary]',
            'border border-[--color-border-subtle] rounded px-1 py-0.5',
            'focus:outline-none focus:ring-1 focus:ring-[--color-accent]',
            // Colourscheme for the native date picker chrome on dark/light.
            'dark:[color-scheme:dark]',
          ].join(' ')}
        />
        <span className="text-[10px] text-[--color-text-muted] shrink-0">–</span>
        <label className="sr-only" htmlFor="date-filter-to">{t('data.inspector.toDate')}</label>
        <input
          id="date-filter-to"
          type="date"
          value={filter.to}
          onChange={e => onChange({ ...filter, to: e.target.value })}
          className={[
            'flex-1 min-w-0 bg-transparent text-[10px] text-[--color-text-secondary]',
            'border border-[--color-border-subtle] rounded px-1 py-0.5',
            'focus:outline-none focus:ring-1 focus:ring-[--color-accent]',
            'dark:[color-scheme:dark]',
          ].join(' ')}
        />
      </div>
    </div>
  )
}

/**
 * Compact empty row for the CPT/borehole lists.
 *
 * Adopts the shared EmptyState primitive (debt #45) so the inspector
 * empties carry an icon instead of bare centred text — a "no results"
 * search uses the Search glyph, every other emptiness uses Inbox.
 *
 * Parameters
 * ----------
 * label
 *     The empty-state line.
 * isSearch
 *     True when this empty state is the "no search matches" case, which picks
 *     the Search glyph instead of Inbox. Passed explicitly rather than sniffed
 *     from the label text, because the label is now translated and a substring
 *     check ("match") would not survive translation.
 *
 * Returns
 * -------
 * JSX.Element
 *     The compact empty-state block.
 */
function EmptyState({ label, isSearch = false }: { label: string; isSearch?: boolean }): JSX.Element {
  return (
    <SharedEmptyState
      compact
      icon={isSearch ? <Search /> : <Inbox />}
      title={label}
    />
  )
}

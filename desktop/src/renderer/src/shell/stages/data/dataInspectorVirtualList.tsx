/**
 * Windowed row list for the Data inspector's CPT / borehole tabs (M7b).
 *
 * A project can hold thousands of CPTs; rendering one DOM row per test made the
 * inspector janky at ~5000. This wraps ``react-window``'s {@link List} so only
 * the rows in (and just around) the viewport are mounted — the rest are virtual.
 *
 * Extracted from ``DataInspector.tsx`` rather than added to it: that file is
 * already well past the 500-line god-component threshold (debt #201), and the
 * react-window wiring is the reusable part.
 *
 * The two visual groups a tab shows — VISIBLE rows, then a "N hidden" divider,
 * then HIDDEN rows — are flattened into one index space ({@link buildFlatRows})
 * so a single fixed-height {@link List} covers both. Row height is fixed
 * ({@link DATA_ROW_HEIGHT}); the divider renders inside a same-height slot.
 */
import { useCallback, useMemo, type ReactElement, type ReactNode } from 'react'
import { List, type RowComponentProps } from 'react-window'

/**
 * Fixed height of one inspector row, in pixels.
 *
 * The CptRow / BoreholeRow layout is a two-line card (name line + badge/depth
 * line) inside ``py-2`` with a bottom border — ~50px. Set slightly above the
 * natural height so rows never OVERLAP (which would clip the depth line);
 * a hair of surface between rows is invisible. Tune if the row layout changes.
 */
export const DATA_ROW_HEIGHT = 52

/**
 * Viewport height react-window assumes before it has measured the container.
 *
 * react-window fills its parent via a ResizeObserver at runtime; this only
 * governs the very first paint (and the jsdom test env, whose ResizeObserver is
 * a no-op stub — so the window it renders there is governed by this value).
 */
export const DATA_LIST_DEFAULT_HEIGHT = 600

/** One entry in the flattened index space: a data row, or the hidden divider. */
export type FlatVirtualRow<T> =
  | { kind: 'row'; item: T; hidden: boolean }
  | { kind: 'separator'; count: number }

/**
 * Flatten the visible + hidden groups into one index space.
 *
 * ``[...visible rows, (divider if any hidden), ...hidden rows]`` — the exact
 * order the non-virtualised list rendered, so the window looks identical.
 *
 * Parameters
 * ----------
 * visible : T[]
 *     Rows shown normally.
 * hidden : T[]
 *     Rows the user has project-locally hidden (rendered dimmed, below a divider).
 *
 * Returns
 * -------
 * FlatVirtualRow<T>[]
 *     The flattened rows, with a single ``separator`` entry inserted only when
 *     ``hidden`` is non-empty.
 */
export function buildFlatRows<T>(visible: T[], hidden: T[]): FlatVirtualRow<T>[] {
  const rows: FlatVirtualRow<T>[] = visible.map(item => ({ kind: 'row', item, hidden: false }))
  if (hidden.length > 0) {
    rows.push({ kind: 'separator', count: hidden.length })
    for (const item of hidden) rows.push({ kind: 'row', item, hidden: true })
  }
  return rows
}

/**
 * Row-props react-window threads to every rendered row. ``unknown`` here because
 * {@link List} cannot carry the caller's ``T`` through its own generics; the
 * public {@link VirtualRowList} restores type safety at its boundary.
 */
interface VirtualRowData {
  items: FlatVirtualRow<unknown>[]
  renderRow: (item: unknown, hidden: boolean) => ReactNode
  renderSeparator: (count: number) => ReactNode
}

/**
 * One windowed slot. react-window owns ``style`` (absolute position + height)
 * and ``ariaAttributes`` (listitem role + set position); we own the content.
 */
function VirtualRow({
  index,
  style,
  ariaAttributes,
  items,
  renderRow,
  renderSeparator,
}: RowComponentProps<VirtualRowData>): ReactElement {
  const row = items[index]
  return (
    <div style={style} {...ariaAttributes}>
      {row.kind === 'separator' ? renderSeparator(row.count) : renderRow(row.item, row.hidden)}
    </div>
  )
}

/** Props for {@link VirtualRowList}. */
export interface VirtualRowListProps<T> {
  /** Rows shown normally (top of the list). */
  visible: T[]
  /** Rows the user hid — rendered dimmed below the divider. */
  hidden: T[]
  /** Stable key for a row item (its id) — used as the react-window row key. */
  rowKey: (item: T) => string
  /** Render one data row; ``hidden`` says which visual group it is in. */
  renderRow: (item: T, hidden: boolean) => ReactNode
  /** Render the "N hidden" divider. */
  renderSeparator: (count: number) => ReactNode
}

/**
 * Virtualised CPT / borehole list — only the visible window of rows is mounted.
 *
 * Fills its parent's height (give the parent a definite height, e.g. a flex
 * child with ``min-h-0``). Keyboard selection, testids and the row's hover
 * callback all live in the caller's ``renderRow`` output, so they are unchanged
 * by virtualisation.
 */
export function VirtualRowList<T>({
  visible,
  hidden,
  rowKey,
  renderRow,
  renderSeparator,
}: VirtualRowListProps<T>): ReactNode {
  const items = useMemo(() => buildFlatRows(visible, hidden), [visible, hidden])

  // react-window calls rowKey during render, so it must be a stable reference.
  const keyForIndex = useCallback(
    (index: number): string => {
      const row = items[index]
      return row.kind === 'separator' ? 'hidden-separator' : rowKey(row.item)
    },
    [items, rowKey],
  )

  const rowProps: VirtualRowData = {
    items: items as FlatVirtualRow<unknown>[],
    renderRow: renderRow as (item: unknown, hidden: boolean) => ReactNode,
    renderSeparator,
  }

  return (
    <List
      // 100% fills the flex parent's height; react-window measures the real
      // pixel height at runtime (the % is not read as a fixed size, so its own
      // ResizeObserver drives the row window).
      style={{ height: '100%' }}
      defaultHeight={DATA_LIST_DEFAULT_HEIGHT}
      rowCount={items.length}
      rowHeight={DATA_ROW_HEIGHT}
      overscanCount={8}
      rowProps={rowProps}
      rowComponent={VirtualRow}
      rowKey={keyForIndex}
    />
  )
}

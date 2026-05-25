// Shared tab bar primitive with proper ARIA + keyboard navigation.
//
// Used by: ParametersCanvas (inline icon+label, border-bottom indicator),
// DataInspector (stacked icon+label, bottom-border indicator).
//
// Arrow-Left / Arrow-Right cycle through tabs; Home / End jump to the
// first / last tab. This matches the ARIA Authoring Practices Guide
// "Tabs" pattern (https://www.w3.org/WAI/ARIA/apg/patterns/tabs/).

import { useCallback, useRef } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TabSpec {
  id: string
  label: string
  /** Optional lucide-react icon element to render inside the tab. */
  icon?: React.ReactNode
  /** Optional hint text rendered as the button ``title`` attribute. */
  hint?: string
  /** Optional ``data-testid`` for targeted test assertions. */
  testid?: string
}

export interface TabBarProps {
  /** Ordered list of tabs to render. */
  tabs: ReadonlyArray<TabSpec>
  /** The ``id`` of the currently-active tab. */
  activeId: string
  /** Called when the user activates a tab (click or keyboard). */
  onActivate: (id: string) => void
  /**
   * Accessible label for the ``role="tablist"`` container.
   * Defaults to "Tabs" — callers should provide a descriptive label.
   */
  ariaLabel?: string
  /**
   * Layout direction of the icon + label inside each tab button.
   * ``'row'`` = icon left of label (default; use for toolbar tabs).
   * ``'col'`` = icon above label (use for narrow inspector tabs).
   */
  layout?: 'row' | 'col'
  /**
   * Extra className applied to the ``role="tablist"`` container, e.g.
   * ``"border-b border-border-subtle bg-surface-sunken"`` for the
   * Parameters canvas header bar.
   */
  containerClassName?: string
  /**
   * Extra className applied to each tab button, e.g. font size or
   * padding overrides.  The active/inactive state classes are always
   * applied; this allows the caller to augment spacing or size without
   * forking the component.
   */
  tabClassName?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Accessible tab bar with arrow-key navigation.
 *
 * Renders a ``role="tablist"`` container with one ``role="tab"`` button
 * per entry in ``tabs``.  Arrow-Left / Arrow-Right cycle activation;
 * Home / End jump to the first / last tab.  Each tab button receives
 * ``aria-selected`` and ``aria-controls`` pointing at the panel id
 * ``"tab-panel-<id>"`` — callers must wire the panel ``id`` themselves.
 *
 * Parameters
 * ----------
 * tabs
 *     Ordered list of tab specs (id, label, optional icon / hint / testid).
 * activeId
 *     The currently-active tab id; drives ``aria-selected`` and active
 *     styling.
 * onActivate
 *     Callback fired when the user selects a tab via click or keyboard.
 * ariaLabel
 *     Accessible label for the tablist container.  Defaults to
 *     ``"Tabs"``.
 * layout
 *     ``'row'`` (icon left, default) or ``'col'`` (icon above label).
 * containerClassName
 *     Extra class names on the tablist container.
 * tabClassName
 *     Extra class names on each tab button.
 *
 * Returns
 * -------
 * JSX.Element
 *     The rendered tablist.
 */
export default function TabBar({
  tabs,
  activeId,
  onActivate,
  ariaLabel = 'Tabs',
  layout = 'row',
  containerClassName = '',
  tabClassName = '',
}: TabBarProps): JSX.Element {
  const listRef = useRef<HTMLDivElement>(null)

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
      let nextIndex: number | null = null
      if (e.key === 'ArrowRight') {
        nextIndex = (currentIndex + 1) % tabs.length
      } else if (e.key === 'ArrowLeft') {
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
      } else if (e.key === 'Home') {
        nextIndex = 0
      } else if (e.key === 'End') {
        nextIndex = tabs.length - 1
      } else {
        return
      }
      e.preventDefault()
      const nextId = tabs[nextIndex].id
      onActivate(nextId)
      // Move DOM focus to the newly-activated tab button.
      const list = listRef.current
      if (list) {
        const btn = list.querySelector<HTMLButtonElement>(
          `[data-tabid="${nextId}"]`,
        )
        btn?.focus()
      }
    },
    [tabs, onActivate],
  )

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      className={containerClassName}
    >
      {tabs.map((spec, index) => {
        const active = spec.id === activeId
        return (
          <button
            key={spec.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`tab-panel-${spec.id}`}
            data-tabid={spec.id}
            data-testid={spec.testid}
            title={spec.hint}
            tabIndex={active ? 0 : -1}
            onClick={() => onActivate(spec.id)}
            onKeyDown={e => handleKeyDown(e, index)}
            className={[
              layout === 'col'
                ? 'flex flex-col items-center gap-0.5'
                : 'flex items-center gap-1.5',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              tabClassName,
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {spec.icon}
            <span>{spec.label}</span>
          </button>
        )
      })}
    </div>
  )
}

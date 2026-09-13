/**
 * In-app single-select dropdown (listbox pattern).
 *
 * Why this exists — installer #35 (owner): the native ``<select>`` popup does
 * not open when clicked inside the composition-editor modal in the packaged
 * Electron window (keyboard navigation on the focused element still worked, so
 * the value could only be changed with the arrow keys). Probing the real app
 * showed nothing in JS prevents the pointer default and focus does land on the
 * control, so the native OS popup itself is the failure. This component replaces
 * the native ``<select>`` with a self-rendered listbox that paints inside the
 * modal card (above the scrim) and never relies on an OS popup.
 *
 * It is a general ``components/ui`` primitive so other dialogs that still use a
 * native ``<select>`` (SettingsDialog, ProjectMetadataDialog, …) can adopt it
 * later.
 *
 * Accessibility / behaviour (WAI-ARIA listbox):
 *   * a ``<button>`` trigger with ``aria-haspopup="listbox"`` + ``aria-expanded``;
 *   * the visible label is the selected option's label;
 *   * opening moves focus into the ``role="listbox"``, closing returns it to the
 *     trigger;
 *   * ArrowUp / ArrowDown move the active option, Home / End jump to the ends,
 *     Enter / Space commit the active option, Escape closes WITHOUT changing,
 *     single printable characters typeahead to the next matching label;
 *   * clicking an option commits it; clicking outside closes without change.
 *
 * The key handler is a NATIVE listener on the listbox node (not React
 * ``onKeyDown``): it ``stopPropagation``s the keys it handles so the shared
 * ``Modal``'s document-level Escape / Tab handlers do not also fire while the
 * listbox is open. That is deterministic regardless of React's portal event
 * delegation (the listbox lives inside a body-portaled modal).
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

/** One row in a {@link Select}. The ``value`` is the raw domain code; the
 *  ``label`` is what the user reads; ``title`` is an optional tooltip (e.g. the
 *  raw DOV token behind a translated label). */
export interface SelectOption {
  value: string
  label: string
  title?: string
}

export interface SelectProps {
  /** Currently-selected value (matched against ``options[].value``). */
  value: string
  /** The selectable options, in display order. */
  options: readonly SelectOption[]
  /** Called with the newly-chosen value. Not called on Escape / outside-click. */
  onChange: (value: string) => void
  /** Disable the control (renders muted, does not open). */
  disabled?: boolean
  /** ``id`` for the trigger button — lets an external ``<label htmlFor>`` point
   *  at it, and gives tests a stable handle. */
  id?: string
  /** ``aria-label`` when there is no visible ``<label>`` element. */
  ariaLabel?: string
  /** id(s) of the element(s) that name the control (an external ``<label>``). */
  ariaLabelledBy?: string
  /** Classes for the trigger button (maps 1:1 to the old ``<select className>``). */
  className?: string
  /** Classes for the outer wrapper (layout, e.g. ``flex-1 min-w-0``). */
  wrapperClassName?: string
  /** ``data-testid`` for the trigger; the listbox is ``${testid}-listbox``. */
  testid?: string
}

/**
 * A single-select dropdown that renders its own option list (no native popup).
 *
 * @param props - see {@link SelectProps}.
 * @returns the trigger button plus, while open, the listbox.
 */
export default function Select({
  value,
  options,
  onChange,
  disabled = false,
  id,
  ariaLabel,
  ariaLabelledBy,
  className = '',
  wrapperClassName = '',
  testid,
}: SelectProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  // Mirror of activeIndex for the native keydown listener to read without a
  // stale closure (and without a side-effect inside a state updater).
  const activeIndexRef = useRef(0)
  useEffect(() => {
    activeIndexRef.current = activeIndex
  }, [activeIndex])
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  // Typeahead buffer + a timer to clear it after a pause between keystrokes.
  const typeaheadRef = useRef<{ buffer: string; at: number }>({ buffer: '', at: 0 })

  const baseId = useId()
  const optionId = useCallback((i: number): string => `${baseId}-opt-${i}`, [baseId])

  const selectedIndex = useMemo(
    () => options.findIndex(o => o.value === value),
    [options, value],
  )
  const selectedLabel =
    selectedIndex >= 0 ? options[selectedIndex].label : (value || '')

  const close = useCallback((returnFocus: boolean): void => {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }, [])

  const commit = useCallback(
    (index: number): void => {
      const opt = options[index]
      if (opt) onChange(opt.value)
      close(true)
    },
    [options, onChange, close],
  )

  // Opening seeds the active option to the current selection (or the first row)
  // and moves focus into the listbox so the arrow keys drive it immediately.
  useEffect(() => {
    if (!open) return
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
    // Focus after paint so the just-mounted listbox node exists.
    const raf = requestAnimationFrame(() => listRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [open, selectedIndex])

  // Keep the active option scrolled into view during keyboard navigation.
  useEffect(() => {
    if (!open) return
    const node = listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    // Optional call: jsdom does not always implement scrollIntoView.
    node?.scrollIntoView?.({ block: 'nearest' })
  }, [open, activeIndex])

  // Close on any outside pointer press. Left un-stopped so a backdrop click can
  // still reach the Modal (which closes the whole dialog).
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent): void {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Native keydown handler on the listbox node. stopPropagation on the keys we
  // own keeps the Modal's document-level Escape / Tab handlers quiet while open.
  useEffect(() => {
    if (!open) return
    const list = listRef.current
    if (!list) return

    function onKeyDown(e: KeyboardEvent): void {
      const last = options.length - 1
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          e.stopPropagation()
          setActiveIndex(i => Math.min(last, i + 1))
          return
        case 'ArrowUp':
          e.preventDefault()
          e.stopPropagation()
          setActiveIndex(i => Math.max(0, i - 1))
          return
        case 'Home':
          e.preventDefault()
          e.stopPropagation()
          setActiveIndex(0)
          return
        case 'End':
          e.preventDefault()
          e.stopPropagation()
          setActiveIndex(last)
          return
        case 'Enter':
        case ' ':
          e.preventDefault()
          e.stopPropagation()
          commit(activeIndexRef.current)
          return
        case 'Escape':
          // Close WITHOUT changing; stop the Modal's own Escape from firing.
          e.preventDefault()
          e.stopPropagation()
          close(true)
          return
        case 'Tab':
          // Let the Modal's focus trap continue from the trigger.
          close(true)
          return
        default:
          break
      }
      // Typeahead: a single printable character jumps to the next matching
      // label (a bonus over the native control). Multi-char within 600 ms
      // extends the buffer for "gr" → Gravel style matching.
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        e.stopPropagation()
        const now = Date.now()
        const ta = typeaheadRef.current
        ta.buffer = now - ta.at > 600 ? e.key : ta.buffer + e.key
        ta.at = now
        const needle = ta.buffer.toLowerCase()
        // Search from the row after the active one so repeated first letters
        // cycle; fall back to a full scan from the top.
        const from = activeIndexRef.current
        const order = [...options.slice(from + 1), ...options.slice(0, from + 1)]
        const hit = order.find(o => o.label.toLowerCase().startsWith(needle))
        if (hit) setActiveIndex(options.indexOf(hit))
      }
    }

    list.addEventListener('keydown', onKeyDown)
    return () => list.removeEventListener('keydown', onKeyDown)
  }, [open, options, commit, close])

  return (
    <div ref={wrapperRef} className={`relative ${wrapperClassName}`}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        data-testid={testid}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        onClick={() => !disabled && setOpen(o => !o)}
        className={`flex items-center justify-between gap-1 ${className}`}
      >
        <span className="min-w-0 truncate text-left">{selectedLabel}</span>
        <ChevronDown size={14} className="shrink-0 opacity-60" aria-hidden />
      </button>
      {open && (
        <ul
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          aria-activedescendant={optionId(activeIndex)}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          data-testid={testid ? `${testid}-listbox` : undefined}
          className="absolute left-0 right-0 z-10 mt-1 max-h-60 overflow-auto rounded border border-border-default bg-surface-overlay py-1 shadow-lg focus:outline-none"
        >
          {options.map((opt, i) => {
            const isActive = i === activeIndex
            const isSelected = opt.value === value
            return (
              <li
                key={opt.value}
                id={optionId(i)}
                role="option"
                aria-selected={isSelected}
                data-active={isActive}
                title={opt.title}
                // preventDefault on mousedown keeps focus on the listbox (a
                // non-focusable <li> would otherwise flick focus to <body>) and,
                // because the press is INSIDE the wrapper, the outside-press
                // listener leaves the menu open; the click then commits.
                onMouseDown={e => e.preventDefault()}
                onClick={() => commit(i)}
                onMouseEnter={() => setActiveIndex(i)}
                className={`cursor-pointer px-2 py-1 text-xs ${
                  isActive
                    ? 'bg-accent text-white'
                    : isSelected
                      ? 'bg-surface-sunken text-text-primary'
                      : 'text-text-primary'
                }`}
              >
                {opt.label}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

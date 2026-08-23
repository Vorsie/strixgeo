// Locale-tolerant numeric input — accepts both `.` and `,` as decimal
// separator regardless of OS locale.
//
// Why a custom primitive instead of ``<input type="number">``:
//   * Browser `type=number` locale handling is inconsistent: Chromium
//     accepts `,` only when the OS locale uses it, accepts `.` only
//     when it doesn't — so a Belgian engineer who picks up his US
//     colleague's machine cannot type `0,3` into his own setting.
//   * `e.target.value` from `type=number` returns `""` when the input
//     is between valid states (typing `1,` shows `1,` but reads as
//     empty string), making controlled inputs misbehave mid-typing.
//   * Spinner UI is visually inconsistent across browsers and adds
//     no value next to the slider sibling that already covers coarse
//     adjustment.
//
// Behaviour
// ---------
// * Display via ``Intl.NumberFormat`` so a Belgian user sees ``0,3``
//   and a US user sees ``0.3``. Underlying number stays a plain
//   number — the .gmproj round-trips cleanly across locales.
// * Input accepts EITHER separator. Internal "draft" string preserves
//   the user's typing through invalid intermediate states (``"0,"``).
// * ``onKeyDown`` blocks letters, symbols, multiple separators,
//   scientific notation; ``onChange`` re-validates the resulting
//   string (paste safety).
// * Negatives are OPT-IN via ``allowNegative`` — a field whose quantity
//   cannot go below its datum keeps refusing a minus by default.
// * Draft state is focus-gated so an external ``value`` change while
//   the field is NOT focused syncs the display; while focused, the
//   user's mid-typed value wins.

import { useState, type InputHTMLAttributes } from 'react'

// Detect the OS locale's decimal separator once at module load. Used
// only for DISPLAY formatting — both separators are always accepted as
// input. Falls back to `.` when Intl.NumberFormat doesn't expose a
// decimal part (defensive; this shouldn't happen with a number arg).
const OS_DECIMAL_SEPARATOR: ',' | '.' =
  new Intl.NumberFormat().formatToParts(1.1).find(p => p.type === 'decimal')
    ?.value === ','
    ? ','
    : '.'

/**
 * Format a number for display using the OS locale's decimal separator,
 * no thousands grouping, up to ``maxFractionDigits`` precision. Returns
 * the empty string for NaN / Infinity so the field doesn't show
 * "NaN" on a malformed external value.
 */
export function formatNumericForDisplay(
  value: number,
  maxFractionDigits = 6,
): string {
  if (!Number.isFinite(value)) return ''
  return new Intl.NumberFormat(undefined, {
    useGrouping: false,
    maximumFractionDigits: maxFractionDigits,
  }).format(value)
}

/** Options shared by the parser and the component. */
export interface NumericParseOptions {
  /**
   * Accept a leading minus. OFF by default, so a field that is
   * physically non-negative (a ratio, a depth below its own collar)
   * keeps refusing one without having to say so.
   *
   * Turn it ON for any quantity measured from a datum the value can sit
   * on the other side of — an elevation below the datum, or a water
   * table above the ground surface it is measured down from (owner
   * ruling 2026-08-23: *"waterdepth can be negative too, offshore for
   * example"* — over a seabed the water stands above the collar).
   */
  allowNegative?: boolean
}

/**
 * Parse a string drafted by the user into a number. Returns ``null``
 * when the draft is empty, malformed, or contains both separators
 * (``"1.2,3"`` is unambiguously garbage, not a locale ambiguity).
 *
 * Accepts intermediate edits: ``"0,"`` parses to ``0`` so the parent
 * value updates as the user types past the separator. ``"0"`` and
 * ``"0."`` both parse to ``0``.
 *
 * A minus is refused unless ``allowNegative`` is set, and even then only
 * as the LEADING character — ``"3-4"`` stays unparseable. Position is
 * enforced here rather than in the keystroke filter, exactly as the
 * decimal separator's is.
 */
export function tryParseNumeric(
  draft: string,
  { allowNegative = false }: NumericParseOptions = {},
): number | null {
  const trimmed = draft.trim()
  if (trimmed === '') return null
  // Reject if BOTH separators appear — that's not a locale problem,
  // it's a typo / paste from a thousands-grouped source.
  if (trimmed.includes(',') && trimmed.includes('.')) return null
  const normalized = trimmed.replace(',', '.')
  // Strict shape: optional leading `-` (opt-in only), optional leading
  // digits, optional single `.`, optional trailing digits. Blocks
  // scientific notation, hex, plus signs, percent signs, currency,
  // anything pasted from elsewhere.
  const shape = allowNegative ? /^-?\d*\.?\d*$/ : /^\d*\.?\d*$/
  if (!shape.test(normalized)) return null
  // No digit anywhere means this is not a number YET — covers "", ".",
  // and (when negatives are allowed) "-" and "-." alike. The draft keeps
  // showing it; the parent's value must not move to meet it.
  if (!/\d/.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

// Keys allowed to pass through even though they aren't digits or
// separators — navigation, deletion, modifier-free clipboard, etc.
const ALLOWED_NAV_KEYS = new Set([
  'Backspace',
  'Delete',
  'Tab',
  'Enter',
  'Escape',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
])

interface Props
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'value' | 'onChange' | 'type' | 'inputMode'
  > {
  /** Committed value (parent owns). The draft mid-edit may differ. */
  value: number
  /** Fires whenever the draft becomes a parseable number. Out-of-range
   *  numbers still fire — parent decides validity via the matching
   *  ``invalid`` prop. */
  onChange: (next: number) => void
  /** Caller-controlled visual invalid state (out-of-range styling).
   *  The primitive itself doesn't enforce min/max; it parses and emits
   *  whatever the user typed. */
  invalid?: boolean
  /** See ``NumericParseOptions.allowNegative``. Off by default. */
  allowNegative?: boolean
}

export default function NumericInput({
  value,
  onChange,
  invalid,
  // Destructured OUT of ``rest`` deliberately: it is our own prop, and
  // spreading it onto the <input> would emit an unknown DOM attribute.
  allowNegative = false,
  onFocus,
  onBlur,
  ...rest
}: Props): JSX.Element {
  // ``draft`` is null when no edit is in flight — display is derived
  // from the committed ``value``. While focused, draft holds the user's
  // exact typed string (including mid-edit ``"0,"``). Sync from value
  // happens on focus + blur, not via useEffect — eliminates the
  // value↔draft feedback-loop class of bug.
  const [draft, setDraft] = useState<string | null>(null)

  const displayValue = draft ?? formatNumericForDisplay(value)

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    // Let modifier combos through untouched (Ctrl+A/C/V/X/Z, Meta+...).
    if (e.ctrlKey || e.metaKey) return
    if (ALLOWED_NAV_KEYS.has(e.key)) return
    // Digits always allowed.
    if (/^\d$/.test(e.key)) return
    // Decimal separator — only the FIRST one allowed (block the
    // second). Both `,` and `.` count as "the separator".
    if (e.key === ',' || e.key === '.') {
      const current = draft ?? displayValue
      if (current.includes(',') || current.includes('.')) {
        e.preventDefault()
      }
      return
    }
    // Minus — same rule as the separator: at most ONE, and only when the
    // caller opted in. WHERE it landed is the parser's business (see
    // tryParseNumeric), so a misplaced one is typeable but never commits.
    if (e.key === '-') {
      if (!allowNegative) {
        e.preventDefault()
        return
      }
      const current = draft ?? displayValue
      if (current.includes('-')) e.preventDefault()
      return
    }
    // Everything else (letters, symbols, `+`, `e`, space) blocked.
    e.preventDefault()
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const next = e.target.value
    setDraft(next)
    const parsed = tryParseNumeric(next, { allowNegative })
    if (parsed !== null) {
      onChange(parsed)
    }
  }

  function handleFocus(e: React.FocusEvent<HTMLInputElement>): void {
    // Seed the draft with the current formatted value so the user
    // can edit from where the display was. If the underlying value
    // is NaN / Infinity, start empty so the field is editable.
    setDraft(formatNumericForDisplay(value))
    onFocus?.(e)
  }

  function handleBlur(e: React.FocusEvent<HTMLInputElement>): void {
    // Drop the draft so the next render derives display from value
    // — re-formats to the canonical separator and trims any trailing
    // separator the user left dangling.
    setDraft(null)
    onBlur?.(e)
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      // Hint Chromium not to auto-correct or auto-capitalise the field
      // (mostly redundant on desktop but harmless and matches mobile
      // Electron / WebView surfaces if they ever appear).
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      value={displayValue}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
      aria-invalid={invalid}
      {...rest}
    />
  )
}

// Re-export the detected separator so callers can render it in
// placeholder text or hints ("e.g. 0,3" vs "e.g. 0.3") if useful.
// Not used in SettingsDialog today; available for future surfaces.
export { OS_DECIMAL_SEPARATOR }

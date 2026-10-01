/**
 * A native ``<select>`` over a DOV codelist (owner 2026-09-29: "with the dov
 * codelist ofc").
 *
 * The option VALUE is the raw DOV token the domain stores; the visible text is
 * the token with its translated meaning next to it ("FZ — fine sand"). A value
 * that is not in the list (a legacy token of an imported row) is kept as its
 * own option, marked "not in the DOV codelist", so opening the editor never
 * silently rewrites imported data. Native select = full keyboard support
 * (type-ahead on the code, arrow keys) for free.
 */
import type { CodeOption } from '../../../utils/dovTrackCodelists'
import { optionText } from '../../../utils/dovTrackCodelists'
import { useT } from '../../../i18n/translate'

interface Props {
  /** Current raw token ('' = nothing picked). */
  value: string
  options: readonly CodeOption[]
  /** Accessible name, e.g. "Main soil, row 2". */
  ariaLabel: string
  onChange: (token: string) => void
  /** Text of the empty choice; omit to force a pick ("Pick…"). */
  emptyLabel?: string
  /** Red outline when the cell carries an error. */
  invalid?: boolean
  className?: string
  /** Width cap (a Tailwind ``max-w-*`` class); the select shrinks to its
   *  longest option up to this. Defaults to 14rem. */
  maxWidthClass?: string
}

/**
 * Codelist picker for one editor cell.
 *
 * @returns The select element.
 */
export default function CodelistPicker({
  value,
  options,
  ariaLabel,
  onChange,
  emptyLabel,
  invalid = false,
  className = '',
  maxWidthClass = 'max-w-[14rem]',
}: Props): JSX.Element {
  const t = useT()
  const known = options.some(o => o.code === value)
  return (
    <select
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      value={value}
      onChange={e => onChange(e.target.value)}
      title={value || undefined}
      className={[
        'h-7 px-1 rounded border text-xs bg-surface-card text-text-primary',
        maxWidthClass,
        invalid ? 'border-red-500' : 'border-border-subtle',
        className,
      ].join(' ')}
    >
      <option value="">{emptyLabel ?? t('tracks.editor.pick')}</option>
      {value !== '' && !known && (
        <option value={value}>{t('tracks.editor.notInCodelist', { token: value })}</option>
      )}
      {options
        .filter(o => o.code !== '')
        .map(o => (
          <option key={o.code} value={o.code} title={o.code}>
            {optionText(o)}
          </option>
        ))}
    </select>
  )
}

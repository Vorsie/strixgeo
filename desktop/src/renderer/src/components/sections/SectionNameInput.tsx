// The text field of the shared section-name editor (``useSectionNameEditor``).
// Each site styles it; the behaviour (value, commit on blur, Enter / Escape,
// auto-select on open) lives once here.
import type { SectionNameEditor } from './useSectionNameEditor'

interface Props {
  editor: SectionNameEditor
  className: string
  ariaLabel: string
  testId?: string
}

/**
 * Render the open name field bound to a ``SectionNameEditor``.
 *
 * @param props - The editor, the site's classes, the accessible label and an optional test id.
 * @returns The input element.
 */
export default function SectionNameInput({ editor, className, ariaLabel, testId }: Props): JSX.Element {
  return (
    <input
      ref={editor.inputRef}
      type="text"
      value={editor.draft}
      onChange={e => editor.setDraft(e.target.value)}
      onBlur={editor.commit}
      onKeyDown={editor.onKeyDown}
      className={className}
      aria-label={ariaLabel}
      data-testid={testId}
    />
  )
}

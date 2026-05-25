// Small amber asterisk used to signal "unsaved changes" alongside a
// label. Single source of truth for the dirty-marker visual — used by
// the sidebar header (project name), the per-row CPT/borehole lists,
// and any future surface that wants to reuse the same convention.
//
// Color is amber on purpose, not red — red signals validation errors
// in form contexts. The whole project's dirty visual language uses
// amber consistently (sidebar asterisks, window-title asterisk,
// metadata-editor field borders).

interface Props {
  // Tooltip explaining what the asterisk means. Required because the
  // glyph alone is ambiguous; every consumer should pass a context-
  // appropriate string ("Imported since last save…", "Unsaved metadata
  // changes…", etc.).
  title: string
  // Optional Tailwind class additions if a particular consumer needs to
  // tweak spacing or sizing. Defaults are tuned for inline-after-name
  // usage.
  className?: string
  // Optional testid for e2e harness assertion on the dirty marker.
  'data-testid'?: string
}

export default function DirtyAsterisk({ title, className = '', 'data-testid': testid }: Props) {
  return (
    <span
      className={`text-amber-600 shrink-0 ${className}`.trim()}
      title={title}
      data-testid={testid}
    >
      *
    </span>
  )
}

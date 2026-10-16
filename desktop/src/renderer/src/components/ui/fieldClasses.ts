// The theme classes every text / number field and native select carries.
//
// Owner dogfeed 2026-10-04 ("i can type but the text is white on white"): a
// field without an explicit background + text token takes the browser's white
// background while the dark theme paints the text near-white. These are the
// classes the dialogs already use (SettingsDialog, NewProjectDialog), lifted
// into one constant so a new field picks the theme up by importing it rather
// than by copying a class string. Sizing and padding stay at the call site.

/** Theme background, text, border, grey placeholder and focus ring for a field. */
export const FIELD_CLASS =
  'rounded border border-border-default bg-surface-overlay text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent'

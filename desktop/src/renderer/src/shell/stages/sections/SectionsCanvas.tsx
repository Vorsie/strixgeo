// Sections stage canvas placeholder.
//
// S3/S4 register the slot; the full canvas (SectionPanel + map fallback
// when no section is selected) migrates here in S5. Shows a placeholder
// rather than returning null so the stage doesn't *look* broken when the
// user lands on it before S5 — mirrors GeologyCanvas's "coming soon".

/** Placeholder canvas for the Sections stage (built in S5). */
export default function SectionsCanvas(): JSX.Element {
  return (
    <div className="flex items-center justify-center h-full text-text-muted text-sm">
      Section view — coming soon
    </div>
  )
}

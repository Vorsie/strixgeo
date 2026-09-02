import type { SheetField } from './sheetPayload'

/** The four-field title block (spec "The sheet"). Labels are the engineer's own. */
export function TitleBlock({ fields, heightMm }: { fields: readonly SheetField[]; heightMm: number }): JSX.Element {
  return (
    <div
      data-testid="sheet-title-block"
      style={{ height: `${heightMm}mm`, border: '0.3pt solid #1f2933', display: 'grid', gridTemplateRows: 'repeat(4, 1fr)', fontSize: '9pt', lineHeight: 1.15 }}
    >
      {fields.map((f, i) => (
        <div key={i} style={{ padding: '1mm 1.5mm', borderBottom: i < 3 ? '0.3pt solid #1f2933' : 'none', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', overflow: 'hidden' }}>
          <span style={{ fontSize: '6pt', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8a9098' }}>{f.label}</span>
          <span style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.value}</span>
        </div>
      ))}
    </div>
  )
}

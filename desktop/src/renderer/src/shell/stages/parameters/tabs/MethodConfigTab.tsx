// Methods tab — HARD-SEPARATED parameter-source picker.
//
// Owner directive 2026-05-21: correlation formulas and Excel lookups
// are TWO DIFFERENT METHODS — never blend them in one cell. The
// engineer picks ONE source path per (parameter, unit) pair so the
// downstream design tool's input is unambiguous.
//
// Three columns of structural surfaces (Phase 5 fills in the actual
// pickers + bookkeeping):
//
//   1. Correlations — formula-driven derivations (Robertson 1986,
//      Mayne 2007, Kulhawy 2014, Uzielli 2013, ...). Each card holds
//      the formula, its reference, its input-parameter requirements,
//      its applicability (NAD class range, soil type range), and a
//      "set as default for parameter X" toggle.
//
//   2. Excel lookups — table-driven values from the NAD-NEN xlsx
//      (38 × 313) plus any project-specific xlsx the engineer imports.
//      Each card holds the table source, the lookup keys (NAD class +
//      parameter), the column it pulls from, and an "import xlsx"
//      action.
//
//   3. Probabilistic + ML hooks — distribution wiring (deterministic
//      vs μ ± σ, distribution type for downstream probabilistic
//      design), plus the ML/AI suggestion surface (audit-required
//      per owner directive on ML rigour; the prediction surfaces as a
//      side-by-side comparison, never auto-applies).
//
// Why structural skeleton today: the actual correlation library is
// Phase-5 work (full Robertson/Mayne port + the 38×313 NAD-NEN table
// ingestion + the probabilistic schema). Opening the SURFACE now
// keeps the architecture decisions visible — engineers and reviewers
// see the three-pillar shape and can push back on it before the
// Phase-5 implementation budget commits.

import { BookOpen, BrainCircuit, FileSpreadsheet, FunctionSquare } from 'lucide-react'

interface MethodCardSpec {
  title: string
  reference: string
  appliesTo: string
  status: 'Phase 5 placeholder'
}

const CORRELATION_CARDS: readonly MethodCardSpec[] = [
  {
    title: 'Robertson & Wride 1986',
    reference: 'φ′ from Qtn — Robertson, P.K. & Wride, C.E. (1998)',
    appliesTo: 'Sand units (Ic < 2.6); inputs qc, fs',
    status: 'Phase 5 placeholder',
  },
  {
    title: 'Mayne 2007',
    reference: 'φ′ from Qtn — Mayne, P.W. (2007)',
    appliesTo: 'Sand units; inputs qc, σ′v',
    status: 'Phase 5 placeholder',
  },
  {
    title: 'Kulhawy & Mayne 2014',
    reference: 'OCR from Qt — Kulhawy & Mayne (2014)',
    appliesTo: 'Clay units (Ic > 2.6); inputs qc, σv, σ′v',
    status: 'Phase 5 placeholder',
  },
  {
    title: 'Uzielli 2013',
    reference: 'φ′ probabilistic — Uzielli (2013)',
    appliesTo: 'Sand units; emits μ + σ rather than a scalar',
    status: 'Phase 5 placeholder',
  },
  {
    title: 'Robertson 2015 / 2009',
    reference: 'SBT zone + Ic — Robertson (2015), zone map (2009)',
    appliesTo: 'All units; segmenter already uses this path (port complete)',
    status: 'Phase 5 placeholder',
  },
] as const

const XLSX_CARDS: readonly MethodCardSpec[] = [
  {
    title: 'NAD-NEN table (38 × 313)',
    reference: 'Owner-curated; per NAD class × parameter lookup',
    appliesTo: 'Sand + fines NAD classes 1–31; primary v1.0 lookup source',
    status: 'Phase 5 placeholder',
  },
  {
    title: 'Project-specific xlsx import',
    reference: 'User-provided; loaded once per project',
    appliesTo: 'Overrides the NAD-NEN defaults when the engineer ships their own table',
    status: 'Phase 5 placeholder',
  },
] as const

const FUTURE_CARDS: readonly MethodCardSpec[] = [
  {
    title: 'Probabilistic distributions',
    reference: 'Per-parameter μ ± σ + distribution type (Normal / Lognormal / Beta)',
    appliesTo: 'Downstream probabilistic design (D-Stability Probabilistic Toolkit, Plaxis statistics export)',
    status: 'Phase 5 placeholder',
  },
  {
    title: 'ML / AI suggestion',
    reference: 'Audit-required surface (never auto-applies — owner directive)',
    appliesTo: 'Side-by-side comparison vs correlation / xlsx choice; flagged when the prediction diverges',
    status: 'Phase 5 placeholder',
  },
] as const

export default function MethodConfigTab(): JSX.Element {
  return (
    <div className="h-full overflow-auto p-4 space-y-6">
      <PillarHeader
        icon={<FunctionSquare size={14} />}
        title="Correlations"
        subtitle="Formula-driven derivations from in-situ measurements. Pick one method per (parameter, unit)."
      />
      <CardGrid cards={CORRELATION_CARDS} />

      <div className="border-t border-border-subtle" />

      <PillarHeader
        icon={<FileSpreadsheet size={14} />}
        title="Excel lookups"
        subtitle="Table-driven values from owner-curated or project-imported spreadsheets. Hard-separated from correlations — the engineer picks ONE path per cell."
      />
      <CardGrid cards={XLSX_CARDS} />

      <div className="border-t border-border-subtle" />

      <PillarHeader
        icon={<BrainCircuit size={14} />}
        title="Probabilistic + ML"
        subtitle="Distribution wiring for probabilistic design tools, plus an audit-required ML suggestion surface."
      />
      <CardGrid cards={FUTURE_CARDS} />

      <div className="text-[10px] text-text-muted leading-snug border-t border-border-subtle pt-3">
        <BookOpen size={11} className="inline mr-1" aria-hidden="true" />
        Status: all cards above are <strong>structural skeletons</strong>{' '}
        for Phase 5. Surfacing the three-pillar architecture today
        keeps the design decisions visible — push back on the shape
        (which methods, which xlsx sources, the hard-separation rule)
        BEFORE the Phase-5 implementation budget commits.
      </div>
    </div>
  )
}

interface PillarHeaderProps {
  icon: JSX.Element
  title: string
  subtitle: string
}

function PillarHeader({ icon, title, subtitle }: PillarHeaderProps): JSX.Element {
  return (
    <div>
      <div className="flex items-center gap-2 text-text-primary font-semibold text-[13px]">
        <span className="text-text-secondary">{icon}</span>
        {title}
      </div>
      <div className="text-[11px] text-text-secondary leading-snug mt-1">{subtitle}</div>
    </div>
  )
}

function CardGrid({ cards }: { cards: readonly MethodCardSpec[] }): JSX.Element {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
      {cards.map(card => (
        <MethodCard key={card.title} card={card} />
      ))}
    </div>
  )
}

function MethodCard({ card }: { card: MethodCardSpec }): JSX.Element {
  return (
    <div
      className="rounded border border-border-subtle bg-surface-sunken/60 p-2.5 text-[11px]"
      data-testid={`method-card-${card.title}`}
    >
      <div className="font-medium text-text-primary">{card.title}</div>
      <div className="text-text-secondary mt-1">{card.reference}</div>
      <div className="text-text-muted mt-1">{card.appliesTo}</div>
      <div className="mt-2 inline-block rounded bg-surface-app border border-border-subtle px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-text-muted">
        {card.status}
      </div>
    </div>
  )
}

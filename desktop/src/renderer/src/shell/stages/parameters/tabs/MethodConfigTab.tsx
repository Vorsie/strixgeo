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

import { useT } from '../../../../i18n/translate'
import type { MessageKey } from '../../../../i18n/locales/en'

interface MethodCardSpec {
  titleKey: MessageKey
  referenceKey: MessageKey
  appliesToKey: MessageKey
  statusKey: MessageKey
  /** Stable English id for the data-testid — kept out of the catalogue so the
   *  e2e selectors do not move with the locale. */
  testId: string
}

const CORRELATION_CARDS: readonly MethodCardSpec[] = [
  {
    titleKey: 'params.methodRobertsonWride',
    referenceKey: 'params.methodRefRobertsonWride',
    appliesToKey: 'params.methodAppliesRobertsonWride',
    statusKey: 'params.phase5Placeholder',
    testId: 'Robertson & Wride 1986',
  },
  {
    titleKey: 'params.methodMayne',
    referenceKey: 'params.methodRefMayne',
    appliesToKey: 'params.methodAppliesMayne',
    statusKey: 'params.phase5Placeholder',
    testId: 'Mayne 2007',
  },
  {
    titleKey: 'params.methodKulhawyMayne',
    referenceKey: 'params.methodRefKulhawyMayne',
    appliesToKey: 'params.methodAppliesKulhawyMayne',
    statusKey: 'params.phase5Placeholder',
    testId: 'Kulhawy & Mayne 2014',
  },
  {
    titleKey: 'params.methodUzielli',
    referenceKey: 'params.methodRefUzielli',
    appliesToKey: 'params.methodAppliesUzielli',
    statusKey: 'params.phase5Placeholder',
    testId: 'Uzielli 2013',
  },
  {
    titleKey: 'params.methodRobertson2015',
    referenceKey: 'params.methodRefRobertson2015',
    appliesToKey: 'params.methodAppliesRobertson2015',
    statusKey: 'params.phase5Placeholder',
    testId: 'Robertson 2015 / 2009',
  },
]

const XLSX_CARDS: readonly MethodCardSpec[] = [
  {
    titleKey: 'params.nadNenTable',
    referenceKey: 'params.methodRefNadNen',
    appliesToKey: 'params.methodAppliesNadNen',
    statusKey: 'params.phase5Placeholder',
    testId: 'NAD-NEN table (38 × 313)',
  },
  {
    titleKey: 'params.projectXlsxImport',
    referenceKey: 'params.methodRefXlsx',
    appliesToKey: 'params.methodAppliesXlsx',
    statusKey: 'params.phase5Placeholder',
    testId: 'Project-specific xlsx import',
  },
]

const FUTURE_CARDS: readonly MethodCardSpec[] = [
  {
    titleKey: 'params.probabilisticDistributions',
    referenceKey: 'params.methodRefProbabilistic',
    appliesToKey: 'params.methodAppliesProbabilistic',
    statusKey: 'params.phase5Placeholder',
    testId: 'Probabilistic distributions',
  },
  {
    titleKey: 'params.mlSuggestion',
    referenceKey: 'params.methodRefMl',
    appliesToKey: 'params.methodAppliesMl',
    statusKey: 'params.phase5Placeholder',
    testId: 'ML / AI suggestion',
  },
]

export default function MethodConfigTab(): JSX.Element {
  const t = useT()
  return (
    <div className="h-full overflow-auto p-4 space-y-6">
      <PillarHeader
        icon={<FunctionSquare size={14} />}
        title={t('params.correlations')}
        subtitle={t('params.correlationsBlurb')}
      />
      <CardGrid cards={CORRELATION_CARDS} />

      <div className="border-t border-border-subtle" />

      <PillarHeader
        icon={<FileSpreadsheet size={14} />}
        title={t('params.excelLookups')}
        subtitle={t('params.excelLookupsSubtitle')}
      />
      <CardGrid cards={XLSX_CARDS} />

      <div className="border-t border-border-subtle" />

      <PillarHeader
        icon={<BrainCircuit size={14} />}
        title={t('params.probabilisticMl')}
        subtitle={t('params.probabilisticMlBlurb')}
      />
      <CardGrid cards={FUTURE_CARDS} />

      <div className="text-[10px] text-text-muted leading-snug border-t border-border-subtle pt-3">
        <BookOpen size={11} className="inline mr-1" aria-hidden="true" />
        {t('params.methodsStatusPre')}
        <strong>{t('params.methodsStatusBold')}</strong>
        {t('params.methodsStatusPost')}
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
        <MethodCard key={card.testId} card={card} />
      ))}
    </div>
  )
}

function MethodCard({ card }: { card: MethodCardSpec }): JSX.Element {
  const t = useT()
  return (
    <div
      className="rounded border border-border-subtle bg-surface-sunken/60 p-2.5 text-[11px]"
      data-testid={`method-card-${card.testId}`}
    >
      <div className="font-medium text-text-primary">{t(card.titleKey)}</div>
      <div className="text-text-secondary mt-1">{t(card.referenceKey)}</div>
      <div className="text-text-muted mt-1">{t(card.appliesToKey)}</div>
      <div className="mt-2 inline-block rounded bg-surface-app border border-border-subtle px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-text-muted">
        {t(card.statusKey)}
      </div>
    </div>
  )
}

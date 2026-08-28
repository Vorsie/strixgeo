/**
 * The gapless build report — the model-trust readout on the Geotechnical stage.
 *
 * Owner constraint, 2026-08-26: *"I can't have gaps or fallbacks in the model
 * unless users make mistakes."* Seven clauses measure that promise on every
 * build (see ``utils/gaplessGate/types.ts``); this is where the verdict is read.
 *
 * Design decisions, and why:
 *
 * * **It reports, it does not block.** The gate fails the REPORT, never the
 *   build — the solids are written either way. So this is a corner panel, not a
 *   modal and not an overlay: the engineer looks at the model and the verdict at
 *   the same time, which is the only way to act on "Tie-section 7, gap 12".
 * * **A kept promise is worth showing.** The clean state is not silence. An
 *   engineer who is about to put this model in front of a client wants to see
 *   the seven guarantees listed, not merely the absence of a complaint — that is
 *   the whole point of a trust column.
 * * **Unmeasured is never green.** ``incomplete`` gets its own amber word
 *   ("not checked"), because a clause nobody could evaluate is an unkept promise
 *   until it is evaluated, and reporting it as a pass is the exact lie the
 *   owner's constraint cannot afford.
 * * **Colour is never the only signal.** Each verdict carries its own word and
 *   its own glyph (WCAG 2.2 AA, docs/ux.md).
 * * **A spot is one press away only when there is somewhere to go.** Entries
 *   standing on a section get a visit button; entries that name a grid column in
 *   open space do not — the same passive-unless-it-can-act contract
 *   ``ToolbarNoticeChip`` set.
 *
 * Positioned ``bottom-2 right-2``: the canvas already spends ``top-2 left-2``
 * (Layers legend), ``top-2 right-2`` (BasemapPanel), ``bottom-2 left-2``
 * (view-mode pills) and its top centre (the fence empty-hint).
 *
 * @module shell/stages/geotechnical/GeotechBuildReportBanner
 */

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, HelpCircle } from 'lucide-react'

import type {
  GaplessBuildReport,
  GaplessClause,
  GaplessClauseEntry,
  GaplessVerdict,
} from '../../../utils/gaplessGate/types'

/** Props: the verdict to show, and how to walk to a spot it names. */
export interface Props {
  /**
   * The last build's report, or ``null`` when there is no verdict.
   *
   * ``null`` renders NOTHING. A model that has never been built, or was last
   * built by a version older than the gate, has nothing to say — and a
   * permanent grey "no verdict" strip on every pre-gate project would be noise
   * that trains the engineer to stop reading this corner.
   */
  report: GaplessBuildReport | null
  /**
   * Walk to a spot the report names — the section, and the gap within it.
   *
   * The second argument is the gap's own two columns, BY NAME, exactly as the
   * clause resolved them against the litho frame (see ``gap_investigation_ids``
   * in ``utils/gaplessGate/types.ts``). Empty when the finding cannot name
   * them, which the receiver must read as "open the section and centre
   * nothing" — the banner never invents a target.
   *
   * The gap INDEX deliberately does not travel. It indexes the litho frame's
   * column list and is a different gap on the geotech axis's own
   * ``visibleColumns``; passing it across a surface boundary is what already
   * centred the wrong gap once (``PartitionFillOverlay.onJumpToConflictGap``).
   */
  onVisitSpot: (sectionId: string, gapInvestigationIds: readonly string[]) => void
}

/** How each verdict presents itself — word, glyph and colour, never colour alone. */
const VERDICT_STYLE: Readonly<
  Record<GaplessVerdict, { tone: string; border: string; Icon: typeof CheckCircle2 }>
> = {
  pass: {
    tone: 'text-status-success',
    border: 'border-status-success/50',
    Icon: CheckCircle2,
  },
  fail: {
    tone: 'text-status-danger',
    border: 'border-status-danger/60',
    Icon: AlertTriangle,
  },
  incomplete: {
    tone: 'text-status-amber',
    border: 'border-status-amber/50',
    Icon: HelpCircle,
  },
}

/**
 * The one-line summary, in the engineer's words.
 *
 * Parameters
 * ----------
 * report : GaplessBuildReport
 *     The verdict being summarised.
 *
 * Returns
 * -------
 * string
 *     A sentence naming what held and what did not. ``"no gaps"`` appears only
 *     on a clean, fully measured report — the tests pin that, because it is the
 *     phrase the owner will read as the guarantee.
 */
function summaryOf(report: GaplessBuildReport): string {
  const total = report.clauses.length
  const failed = report.clauses.filter(c => c.status === 'fail').length
  const unmeasured = report.clauses.filter(c => c.status === 'not-evaluated').length

  if (report.verdict === 'fail') {
    const tail = unmeasured > 0 ? `, ${unmeasured} not checked` : ''
    return `${failed} of ${total} model guarantees broken${tail}`
  }
  if (report.verdict === 'incomplete') {
    return `${total - unmeasured} of ${total} model guarantees held, ${unmeasured} not checked`
  }
  return `no gaps — all ${total} model guarantees held`
}

/** One named spot, with a press only where the spot is somewhere. */
function EntryRow({
  entry,
  onVisitSpot,
}: {
  entry: GaplessClauseEntry
  onVisitSpot: (sectionId: string, gapInvestigationIds: readonly string[]) => void
}): JSX.Element {
  // Truthiness, not ``!== undefined``: the backend sends an absent locator as
  // an explicit ``null`` (Pydantic), and an id that is the empty string is no
  // id either. Testing the slot instead of the value put a "Show me" button on
  // findings that stand nowhere — see the note in ``gaplessGate/types.ts``.
  const sectionId = entry.section_id ? entry.section_id : null
  // Same rule for the gap's columns: absent is ``null`` inbound and omitted
  // outbound, and an empty list is exactly as unusable as no list at all.
  const gapInvestigationIds = entry.gap_investigation_ids ?? []
  return (
    <li className="flex items-start gap-1.5 pl-4 py-0.5 text-text-secondary">
      <span aria-hidden="true" className="text-text-muted select-none">
        ·
      </span>
      <span className="flex-1">{entry.label}</span>
      {sectionId !== null && (
        <button
          type="button"
          data-testid="geotech-build-report-visit"
          onClick={() => onVisitSpot(sectionId, gapInvestigationIds)}
          className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold text-accent
                     border border-accent/40 hover:bg-accent/10
                     focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          title={`Open ${entry.section_name ?? 'the section'} at this spot`}
          aria-label={`Open ${entry.section_name ?? 'the section'} at this spot`}
        >
          Show me
        </button>
      )}
    </li>
  )
}

/** One clause in the disclosure list: its promise, whether it held, its spots. */
function ClauseRow({
  clause,
  onVisitSpot,
}: {
  clause: GaplessClause
  onVisitSpot: (sectionId: string, gapInvestigationIds: readonly string[]) => void
}): JSX.Element {
  const mark =
    clause.status === 'pass' ? '✓' : clause.status === 'fail' ? '✗' : '?'
  const tone =
    clause.status === 'pass'
      ? 'text-status-success'
      : clause.status === 'fail'
        ? 'text-status-danger'
        : 'text-status-amber'

  return (
    <li>
      <div className="flex items-start gap-1.5">
        <span aria-hidden="true" className={`${tone} font-semibold select-none`}>
          {mark}
        </span>
        <span className="text-text-muted tabular-nums select-none">{clause.number}.</span>
        <span className="flex-1 text-text-primary">{clause.title}</span>
      </div>
      {clause.status === 'not-evaluated' && Boolean(clause.not_evaluated_reason) && (
        <p className="pl-4 py-0.5 text-text-muted italic">
          Not checked — {clause.not_evaluated_reason}.
        </p>
      )}
      {clause.entries.length > 0 && (
        <ul>
          {clause.entries.map((entry, i) => (
            <EntryRow
              // The entries of one clause have no id of their own; their order
              // within the clause is the engine's and is stable for a build.
              key={`${clause.key}-${i}`}
              entry={entry}
              onVisitSpot={onVisitSpot}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

/**
 * Render the gapless build-report banner, or nothing when there is no verdict.
 *
 * Parameters
 * ----------
 * report : GaplessBuildReport or null
 *     The last build's seven-clause verdict; ``null`` renders nothing.
 * onVisitSpot : (sectionId: string, gapInvestigationIds: readonly string[]) => void
 *     Opens a cross-section AND, when the finding named them, the two columns
 *     its gap stands between — so a named spot is one press away and the press
 *     lands on the spot rather than merely on the section.
 *
 * Returns
 * -------
 * JSX.Element | null
 *     The corner panel, or ``null`` when there is no report.
 */
export default function GeotechBuildReportBanner({
  report,
  onVisitSpot,
}: Props): JSX.Element | null {
  // Above the early return — the hook order must not depend on whether a
  // verdict exists (the project's hook-order rule).
  const [open, setOpen] = useState(false)

  if (report === null) return null

  const { tone, border, Icon } = VERDICT_STYLE[report.verdict]
  const broken = report.clauses.filter(c => c.status === 'fail')

  return (
    <div
      className={`absolute bottom-2 right-2 z-20 max-w-[min(90vw,32rem)]
                  bg-surface-overlay border ${border} rounded shadow-lg text-[11px]`}
      // A status, not an alert: it appears after an action the engineer just
      // took and never interrupts. An assertive live region would talk over
      // whatever they are reading.
      role="status"
      data-testid="geotech-build-report-banner"
    >
      <div className="flex items-start gap-2 px-3 py-1.5">
        <Icon size={13} className={`${tone} shrink-0 mt-px`} aria-hidden="true" />
        <div className="flex-1">
          <span className={`font-semibold ${tone}`}>Model check</span>{' '}
          <span className="text-text-primary">{summaryOf(report)}</span>
          {/* The broken promises are named WITHOUT opening anything: the whole
              value of the report is that the engineer does not have to hunt. */}
          {broken.length > 0 && (
            <ul className="mt-0.5 text-text-primary">
              {broken.map(c => (
                <li key={c.key}>
                  <span aria-hidden="true" className="text-status-danger font-semibold">
                    ✗{' '}
                  </span>
                  {c.title}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          data-testid="geotech-build-report-disclosure"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          aria-controls="geotech-build-report-detail"
          className="shrink-0 flex items-center gap-0.5 px-1 py-0.5 rounded text-text-secondary
                     hover:text-text-primary hover:bg-surface-sunken
                     focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          title={open ? 'Hide the detail' : 'Show every guarantee and where it stands'}
        >
          {open ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          <span>{open ? 'Less' : 'Detail'}</span>
        </button>
      </div>

      {open && (
        <ul
          id="geotech-build-report-detail"
          className="border-t border-border-subtle px-3 py-1.5 space-y-1
                     max-h-64 overflow-y-auto"
        >
          {report.clauses.map(c => (
            <ClauseRow key={c.key} clause={c} onVisitSpot={onVisitSpot} />
          ))}
        </ul>
      )}
    </div>
  )
}

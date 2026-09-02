// Per-unit distribution panel — box + strip of qc, fs and Rf over one geotech
// unit (owner ballot 2026-08-26).
//
// WHY BOX + STRIP RATHER THAN A RAINCLOUD. The ballot allowed either. A
// raincloud's half-violin is a kernel density estimate, and a KDE carries a
// bandwidth — a smoothing choice that invents or hides a mode depending on how
// it is set. On a unit pooling two sand bodies the engineer would be reading a
// shape the smoother chose. A box says only what the order statistics say, and
// the strip behind it draws the measurements themselves, so nothing about the
// spread is asserted that the samples do not carry. For a panel whose whole
// point is that it makes NO interpretive claim, that is the honest form.
//
// WHY HORIZONTAL, WHEN THE SIBLING DEPTH PANELS ARE TALL. The owner's 2026-08-03
// ruling ("all horizontal and squished") was about a DEPTH series, which reads
// tall because depth is its axis. A distribution has no depth axis — it is a
// spread along one measurement axis — so it reads wide, and three of them stack
// into the same 420 px inspector without squeezing anything.
//
// WHY EACH ROW IS ITS OWN CHART. qc (MPa), fs (MPa) and Rf (%) have different
// units and ranges. One shared axis would be the dual-axis mistake; three rows
// with their own scales are small multiples, and each row's title names its
// single series so no legend is needed.
//
// The row itself (axis, box, strip, readouts) lives in
// ``UnitDistributionChannelRow.tsx`` — split when the second-dogfeed rulings
// (fit toggle S1, off-axis notifier S2, tick labels S3 — owner 2026-08-27)
// pushed this file past the 500-line gate (debt #201).
//
// CHARACTERISATION ONLY — see ``unitStatistics.ts`` and the on-screen note.

import { memo, useState } from 'react'
import { BarChart3 } from 'lucide-react'

import { EmptyState } from '../../EmptyState'
import ChannelRow from './UnitDistributionChannelRow'
import type { UnitStatistics } from './unitStatistics'

interface Props {
  /** The unit's pooled measurements + summaries. */
  statistics: UnitStatistics
  /** Unit name for the heading — already resolved by the caller. */
  unitLabel: string
  /**
   * CPTs of this unit that contributed NO series, if any.
   *
   * Named so a partial answer cannot read as the whole unit. It deliberately
   * does not distinguish "still arriving" from "has no series at all" — the
   * batch endpoint drops ids it cannot answer for rather than failing, so both
   * look the same from here, and the honest wording covers both.
   */
  pendingCptCount?: number
  /**
   * One line stating the POPULATION the pool was drawn from (owner ruling R6,
   * 2026-08-27 — "Only cpt's on the sections should be in the pooling"):
   * n over how many CPTs on how many sections, exclusions named. Composed by
   * the caller, which is what knows the sections.
   */
  populationNote?: string
  /**
   * How many accepted bands the SCOPE owns in total (the pane row's count,
   * both anchors). When the pooled subset is smaller — member/anchor filters
   * — the header reads "X of Y bands" so a partial pool cannot read as the
   * whole row (audit F7). Omitted keeps the plain count.
   */
  totalBandCount?: number
  /**
   * True when a single resolver BODY is scoped: the empty state then blames
   * the body, not the unit — "this unit has no bands on a CPT" is false
   * under a body scope (audit F7).
   */
  bodyScoped?: boolean
  /**
   * D2 provenance (debt #278, owner ruling 2026-09-02): the source litho body
   * each group member sits under, one label per member. Present only for a
   * grouped scope — renders a small heading + bullet list under the title so the
   * group's provenance ("which litho bodies") shows. Undefined → no list.
   */
  provenanceBodies?: readonly string[]
  /** The heading above the provenance bullets (localised by the caller). */
  provenanceHeading?: string
}

/**
 * Distribution panel for one geotech unit.
 *
 * Parameters
 * ----------
 * props : Props
 *     The computed statistics plus the unit's display name.
 *
 * Returns
 * -------
 * JSX.Element
 *     A heading, one box+strip row per channel, and the characterisation note.
 */
function UnitDistributionPanels({
  statistics,
  unitLabel,
  pendingCptCount = 0,
  populationNote,
  totalBandCount,
  bodyScoped = false,
  provenanceBodies,
  provenanceHeading,
}: Props): JSX.Element {
  const totalSamples = statistics.channels.reduce((sum, c) => sum + c.summary.n, 0)
  // S1 (owner 2026-08-27): "make a button on the 3 cpt statistics, to rescale
  // x-axis to better fit the data. 0 stays minimum and ofcourse the button has
  // to revert too." ONE toggle for the whole section, plain state, no
  // persistence — reverting restores the exact fixed axes.
  const [fitAxes, setFitAxes] = useState(false)

  return (
    <div className="flex flex-col min-h-0 overflow-auto" data-testid="unit-stats-panel">
      {/* Heading — what ground these numbers describe. */}
      <div className="px-3 py-2 border-b border-border-subtle shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div
            className="text-xs font-semibold text-text-primary truncate"
            data-testid="unit-stats-title"
            title={unitLabel}
          >
            {unitLabel}
          </div>
          {/* The label states the mode the press switches TO. Offered only
              when there is something to scale (no-affordance rule). */}
          {totalSamples > 0 && (
            <button
              type="button"
              data-testid="unit-stats-fit-toggle"
              aria-pressed={fitAxes}
              onClick={() => setFitAxes(f => !f)}
              className="shrink-0 px-1.5 py-0.5 rounded border border-border-default text-[10px] text-text-secondary hover:text-text-primary hover:bg-surface-app"
            >
              {fitAxes ? 'Standard CPT axes' : 'Fit axes to data'}
            </button>
          )}
        </div>
        <div className="text-[10px] text-text-muted tabular-nums" data-testid="unit-stats-bandline">
          {/* "X of Y" when the pool covers fewer bands than the scope owns
              (F7) — the plain count when they agree. */}
          {totalBandCount !== undefined && totalBandCount > statistics.bandCount
            ? `${statistics.bandCount} of ${totalBandCount} bands`
            : `${statistics.bandCount} band${statistics.bandCount === 1 ? '' : 's'}`}{' '}
          on {statistics.cptCount} CPT{statistics.cptCount === 1 ? '' : 's'}
          {statistics.coveredThicknessM > 0
            ? ` · ${statistics.coveredThicknessM.toFixed(1)} m of ground`
            : ''}
          {pendingCptCount > 0
            ? ` · ${pendingCptCount} without series`
            : ''}
        </div>
        {populationNote !== undefined && (
          <div
            className="text-[10px] text-text-muted tabular-nums"
            data-testid="unit-stats-population"
          >
            {populationNote}
          </div>
        )}
        {/* D2 provenance: which source litho bodies the grouped members came
            from ("that way we have provenance"). */}
        {provenanceBodies !== undefined && provenanceBodies.length > 0 && (
          <div className="mt-1" data-testid="unit-stats-provenance">
            {provenanceHeading !== undefined && (
              <div className="text-[10px] uppercase tracking-wide text-text-muted">
                {provenanceHeading}
              </div>
            )}
            <ul className="mt-0.5 flex flex-col gap-0.5">
              {provenanceBodies.map((label, i) => (
                <li
                  key={`${label}-${i}`}
                  className="flex items-start gap-1 text-[10px] text-text-secondary"
                >
                  <span aria-hidden="true" className="text-text-muted">
                    •
                  </span>
                  <span className="truncate" data-testid="unit-stats-provenance-item">
                    {label}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {totalSamples === 0 ? (
        // Wrapped so the state is addressable — ``EmptyState`` takes no
        // testid, the same reason ``ParametersInspector`` wraps its
        // ``LoadingState``.
        <div data-testid="unit-stats-empty">
          <EmptyState
            icon={<BarChart3 />}
            title={bodyScoped ? 'No cone measurements in this body' : 'No cone measurements in this unit'}
            hint={
              statistics.bandCount === 0
                ? bodyScoped
                  ? // F7: under a body scope the UNIT may have plenty of cone
                    // bands — the scoped BODY is what has none.
                    'This body has no bands on a CPT — a borehole-only body carries no cone resistance to summarise.'
                  : 'This unit has no bands on a CPT — a borehole-only unit carries no cone resistance to summarise.'
                : 'The bands are there, but no CPT series covers them yet.'
            }
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          {statistics.channels.map(channel => (
            <ChannelRow key={channel.channel} channel={channel} fit={fitAxes} />
          ))}
        </div>
      )}

      {/* The liability line. Every number above describes measurements that
          were taken; none of them is a design-ready parameter. */}
      <div
        className="px-3 py-2 text-[10px] text-text-muted border-t border-border-subtle shrink-0"
        data-testid="unit-stats-characterisation-note"
      >
        Characterisation only — the spread of the measurements inside this
        unit&apos;s bands. These are not design parameters; φ′, c′, cu, E50, OCR
        and Vs are not derived here.
      </div>
    </div>
  )
}

export default memo(UnitDistributionPanels)

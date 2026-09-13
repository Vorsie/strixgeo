/**
 * COMPOSE THE MODEL-CHECK PANEL'S PROSE IN THE VIEWER'S LANGUAGE.
 *
 * The backend and the renderer both emit a clause as a KEY plus structured
 * numbers (``params``); the English ``title`` / ``label`` they also carry are
 * only a fallback for a report written before this composer existed. Everything
 * an engineer reads in the model-check panel — the seven promise titles, one
 * "what this means" line and one "what to do" line per clause, and every detail
 * sentence — is composed HERE from the key and the numbers, so the panel reads
 * in the interface language instead of backend English (owner finding, installer
 * #35: "the panel reads English inside my Dutch interface").
 *
 * Every clause has a title/meaning/action; the numbers vary per clause, so the
 * detail sentence is composed per key from ``entry.params``. A clause the
 * composer has no template for, or an entry with no ``params`` (an old report),
 * falls back to the backend's own ``title`` / ``label``.
 *
 * @module utils/gaplessGate/modelCheckText
 */

import type { MessageKey } from '../../i18n/locales/en'
import type { Translator } from '../../i18n/translate'
import type { GaplessClause, GaplessClauseEntry, GaplessClauseKey } from './types'

/** The title/meaning/action message keys for one clause. */
interface ClauseTextKeys {
  title: MessageKey
  meaning: MessageKey
  action: MessageKey
}

/**
 * The message keys per clause, written out as literals so ``tsc`` verifies each
 * one exists in the catalogue (a constructed ``geotech.clause.${key}.title``
 * would defeat the typed-key guard).
 */
const CLAUSE_KEYS: Record<GaplessClauseKey, ClauseTextKeys> = {
  'area-conservation': {
    title: 'geotech.clause.area-conservation.title',
    meaning: 'geotech.clause.area-conservation.meaning',
    action: 'geotech.clause.area-conservation.action',
  },
  'edge-reach': {
    title: 'geotech.clause.edge-reach.title',
    meaning: 'geotech.clause.edge-reach.meaning',
    action: 'geotech.clause.edge-reach.action',
  },
  'cause-closure': {
    title: 'geotech.clause.cause-closure.title',
    meaning: 'geotech.clause.cause-closure.meaning',
    action: 'geotech.clause.cause-closure.action',
  },
  'section-closure': {
    title: 'geotech.clause.section-closure.title',
    meaning: 'geotech.clause.section-closure.meaning',
    action: 'geotech.clause.section-closure.action',
  },
  'column-totality': {
    title: 'geotech.clause.column-totality.title',
    meaning: 'geotech.clause.column-totality.meaning',
    action: 'geotech.clause.column-totality.action',
  },
  'stack-voids': {
    title: 'geotech.clause.stack-voids.title',
    meaning: 'geotech.clause.stack-voids.meaning',
    action: 'geotech.clause.stack-voids.action',
  },
  'section-reconciliation': {
    title: 'geotech.clause.section-reconciliation.title',
    meaning: 'geotech.clause.section-reconciliation.meaning',
    action: 'geotech.clause.section-reconciliation.action',
  },
}

/** Round a number to at most two decimals and drop trailing zeros ("3.4", "0"). */
function num(value: unknown, decimals = 2): string {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return '?'
  return Number(n.toFixed(decimals)).toString()
}

/** The clause's promise title, in the viewer's language (backend title fallback). */
export function clauseTitle(t: Translator, clause: GaplessClause): string {
  const keys = CLAUSE_KEYS[clause.key]
  return keys ? t(keys.title) : clause.title
}

/** One "what this means" line for the clause; empty when none is defined. */
export function clauseMeaning(t: Translator, key: GaplessClauseKey): string {
  const keys = CLAUSE_KEYS[key]
  return keys ? t(keys.meaning) : ''
}

/** One "what to do" line for the clause; empty when none is defined. */
export function clauseAction(t: Translator, key: GaplessClauseKey): string {
  const keys = CLAUSE_KEYS[key]
  return keys ? t(keys.action) : ''
}

/**
 * One detail line for a clause entry, composed from its ``params`` in the
 * viewer's language. Falls back to the backend-authored ``entry.label`` when the
 * entry carries no params (an old report) or the clause has no composer.
 */
export function clauseEntryText(
  t: Translator,
  key: GaplessClauseKey,
  entry: GaplessClauseEntry,
): string {
  const p = entry.params
  if (!p) return entry.label
  const section = entry.section_name ?? t('geotech.reportSectionFallback')
  switch (key) {
    case 'area-conservation':
      return t('geotech.clause.area-conservation.entry', {
        section,
        gap: String(p.gap_index ?? entry.gap_index ?? ''),
        diff: num(p.difference_m2),
        geotech: num(p.geotech_m2),
        litho: num(p.litho_m2),
      })
    case 'edge-reach':
      return t('geotech.clause.edge-reach.entry', {
        section,
        gap: String(p.gap_index ?? ''),
        side: t(p.edge === 0 ? 'geotech.clause.edgeLeft' : 'geotech.clause.edgeRight'),
        cover: num(p.cover_m),
      })
    case 'cause-closure':
      return t('geotech.clause.cause-closure.entry', {
        section,
        gap: String(p.gap_index ?? ''),
        area: num(p.area_m2),
        loops: String(p.faces ?? ''),
      })
    case 'section-closure':
      return t('geotech.clause.section-closure.entry', {
        section: String(p.section_name ?? section),
      })
    case 'column-totality':
      return t('geotech.clause.column-totality.entry', {
        empty: String(p.empty_count ?? ''),
        total: String(p.in_footprint_count ?? ''),
      })
    case 'stack-voids':
      return p.note === true
        ? t('geotech.clause.stack-voids.entryNote', {
            worst: num(p.worst_mm, 1),
            threshold: num(p.action_threshold_mm, 0),
            residue: String(p.residue_count ?? ''),
          })
        : t('geotech.clause.stack-voids.entry', {
            count: String(p.actionable_count ?? ''),
            worst: num(p.worst_mm, 1),
            threshold: num(p.action_threshold_mm, 0),
          })
    case 'section-reconciliation': {
      const where =
        p.worst_sample_along_m === null || p.worst_sample_along_m === undefined
          ? t('geotech.clause.section-reconciliation.noSample')
          : t('geotech.clause.section-reconciliation.worstAt', {
              mm: num(p.worst_sample_divergence_mm, 0),
              along: num(p.worst_sample_along_m, 1),
            })
      const outside =
        typeof p.samples_outside_footprint === 'number' && p.samples_outside_footprint > 0
          ? t('geotech.clause.section-reconciliation.outsideNote', {
              n: String(p.samples_outside_footprint),
            })
          : ''
      return t('geotech.clause.section-reconciliation.entry', {
        index: String(p.section_index ?? ''),
        sx: num(p.start_x, 1),
        sy: num(p.start_y, 1),
        ex: num(p.end_x, 1),
        ey: num(p.end_y, 1),
        held: num(p.swept_3d_m2),
        classed: num(p.swept_2d_m2),
        allowance: num(p.allowance_m2),
        where,
        outside,
      })
    }
    default:
      return entry.label
  }
}

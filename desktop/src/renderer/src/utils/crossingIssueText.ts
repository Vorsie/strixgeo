// The surface-crossing warning, said in the app language and pointing at the
// test where it happens.
//
// The backend's ``GapIssueResponse.detail`` is an English sentence built server
// side ("Younger formation 'X' sits below older 'Y' by up to 0.29 m — violates
// stratigraphic superposition."). The owner's Dutch panel showed it raw, and it
// named no location, so "Toon me" could only say "no section contains that
// contact" without saying where to draw one (dogfeed 2026-09-22). The issue
// carries the structured facts — ``formation_ids`` as ``(older, younger)``,
// ``depth_m`` the worst gap, ``contact_ids`` the offending contacts — so the
// sentence is rendered here at the presentation boundary, and the offending
// contacts are resolved to the tests they sit on.
import type {
  FormationContactResponse,
  GapIssueResponse,
  GeologicalFormationResponse,
} from '../api/client'
import type { Translator } from '../i18n/translate'

/** A test (borehole or CPT) an offending contact sits on, with its location. */
export interface CrossingTest {
  id: string
  name: string
  kind: 'borehole' | 'cpt'
  x: number
  y: number
}

/** The subset of a borehole / CPT list item this module reads. */
export interface NamedAnchor {
  id: string
  name: string
  location_x: number | null
  location_y: number | null
}

/**
 * Resolve an issue's offending contacts to the tests they sit on.
 *
 * @param issue - The crossing issue.
 * @param contacts - The model's contacts (to map contact id → test id).
 * @param boreholes - The project's boreholes.
 * @param cpts - The project's CPTs.
 * @returns The distinct tests, in contact order; tests without a location are skipped.
 */
export function crossingIssueTests(
  issue: Pick<GapIssueResponse, 'contact_ids'>,
  contacts: readonly Pick<FormationContactResponse, 'id' | 'borehole_id' | 'cpt_id'>[],
  boreholes: readonly NamedAnchor[],
  cpts: readonly NamedAnchor[],
): CrossingTest[] {
  const out: CrossingTest[] = []
  const seen = new Set<string>()
  for (const contactId of issue.contact_ids) {
    const contact = contacts.find(c => c.id === contactId)
    if (!contact) continue
    const kind: CrossingTest['kind'] = contact.borehole_id ? 'borehole' : 'cpt'
    const anchorId = contact.borehole_id ?? contact.cpt_id
    if (!anchorId || seen.has(anchorId)) continue
    const anchor = (kind === 'borehole' ? boreholes : cpts).find(a => a.id === anchorId)
    if (!anchor || anchor.location_x === null || anchor.location_y === null) continue
    seen.add(anchorId)
    out.push({ id: anchor.id, name: anchor.name, kind, x: anchor.location_x, y: anchor.location_y })
  }
  return out
}

/**
 * The warning sentence for a crossing issue, in the app language.
 *
 * Falls back to the backend's English ``detail`` when the issue is not a
 * formation crossing with two known formations.
 *
 * @param issue - The crossing issue.
 * @param formations - The model's formations (to name the pair).
 * @param tests - The tests the offending contacts sit on (``crossingIssueTests``).
 * @param t - The active-language translator.
 * @returns The sentence, ending with the test names when any are known.
 */
export function describeCrossingIssue(
  issue: Pick<GapIssueResponse, 'kind' | 'detail' | 'depth_m' | 'formation_ids'>,
  formations: readonly Pick<GeologicalFormationResponse, 'id' | 'name'>[],
  tests: readonly CrossingTest[],
  t: Translator,
): string {
  if (issue.kind !== 'formation_crossing' || issue.formation_ids.length < 2) return issue.detail
  const older = formations.find(f => f.id === issue.formation_ids[0])
  const younger = formations.find(f => f.id === issue.formation_ids[1])
  if (!older || !younger) return issue.detail
  const delta = issue.depth_m === null ? '?' : issue.depth_m.toFixed(2)
  const head = t('geology.crossing.text', { younger: younger.name, older: older.name, delta })
  if (tests.length === 0) return head
  return head + t('geology.crossing.at', { tests: tests.map(x => x.name).join(', ') })
}

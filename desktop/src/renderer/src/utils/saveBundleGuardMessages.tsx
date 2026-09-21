// User-facing copy for the empty-bundle overwrite question (debt #225).
//
// The pre-write save guard (``useProject.guardEmptyBundle``) re-fetches once and,
// when a guarded collection STILL reads 0 while the last save held rows, asks
// before overwriting the file rather than silently writing the empty version.
// This module renders that dialog's body: a lead sentence plus one line per
// suspicious collection reading "last save N, now 0", so the engineer sees
// exactly what would be lost before deciding. Kept out of ``App.tsx`` so the
// label mapping and the list layout can be unit-tested and the god-component
// (debt #201) does not grow.

import type { ReactNode } from 'react'

import { t } from '../i18n/translate'
import type { MessageKey } from '../i18n/locales/en'
import type { EmptyCollectionFinding, GuardedCollection } from './saveBundleGuard'

/**
 * User-facing label key per guarded collection.
 *
 * The raw collection names carry schema words (``geological_formations``,
 * ``litho_contact_correlation_edges``) that are neither translated nor allowed
 * in a message value (the locale-parity LP7 gate bans "geological" /
 * "lithostratigraphic" from any catalogue string), so each collection maps to a
 * friendly, translated label instead.
 */
const COLLECTION_LABEL_KEY: Record<GuardedCollection, MessageKey> = {
  litho_contact_correlation_edges: 'project.emptyBundleCollection.correlations',
  litho_layers: 'project.emptyBundleCollection.lithoLayers',
  formation_contacts: 'project.emptyBundleCollection.formationContacts',
  bodies: 'project.emptyBundleCollection.bodies',
  cpts: 'project.emptyBundleCollection.cpts',
  boreholes: 'project.emptyBundleCollection.boreholes',
  geological_formations: 'project.emptyBundleCollection.formations',
  cross_sections: 'project.emptyBundleCollection.crossSections',
}

/**
 * Body for the empty-bundle overwrite confirmation dialog.
 *
 * Reads the active language at call time (module-level ``t``) so it never
 * disagrees with the rest of the dialog. Renders nothing but a lead paragraph
 * when ``findings`` is empty (the dialog is never opened in that state, so the
 * guard is defensive).
 *
 * Parameters
 * ----------
 * findings : EmptyCollectionFinding[]
 *     The collections that came back empty on the re-fetch — each rendered as
 *     "{label}: last save {expected}, now {now}".
 *
 * Returns
 * -------
 * ReactNode
 *     The dialog body: a lead sentence and the per-collection loss list.
 */
export function emptyBundleOverwriteBody(findings: EmptyCollectionFinding[]): ReactNode {
  return (
    <div>
      <p className="mb-2">{t('project.saveEmptyBundleAskBody')}</p>
      <ul className="list-disc space-y-0.5 pl-4" data-testid="save-empty-bundle-list">
        {findings.map((f) => (
          <li key={f.collection}>
            {t('project.saveEmptyBundleRow', {
              label: t(COLLECTION_LABEL_KEY[f.collection]),
              expected: f.expected,
              now: f.fetched,
            })}
          </li>
        ))}
      </ul>
    </div>
  )
}

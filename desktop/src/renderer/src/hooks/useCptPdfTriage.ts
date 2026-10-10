/**
 * Run a PDF CPT report's triage job and surface its progress.
 *
 * The shared PDF triage path (``pdfTriageRegistry.ts``: upload, job, SSE
 * stream, spawn-or-attach, StrictMode-safe registry) bound to the
 * ``/cpt/pdf/*`` client. Lifecycle and the dogfeed history behind the
 * registry are documented there.
 */

import { cptPdfClient, type CptPdfDigest } from '../api/clients/cptPdf'
import {
  createPdfTriage,
  type PdfTriagePhase,
  type PdfTriageState,
  type UsePdfTriageResult,
} from './pdfTriageRegistry'

/** The triage's two phases, in order. */
export type CptPdfTriagePhase = PdfTriagePhase

/** Where the triage stands. */
export type CptPdfTriageState = PdfTriageState<CptPdfDigest>

/** What {@link useCptPdfTriage} returns. */
export type UseCptPdfTriageResult = UsePdfTriageResult<CptPdfDigest>

const cptTriage = createPdfTriage<CptPdfDigest>({
  tag: 'cpt-pdf',
  // Lazy: the tests replace the client's calls after this module loaded.
  startTriage: (filePath, projectId) => cptPdfClient.startTriage(filePath, projectId),
  streamUrl: jobId => cptPdfClient.streamUrl(jobId),
  describe: digest =>
    `${digest.campaign.length} campaign soundings, ${digest.dropped.length} set aside`,
})

/**
 * Manage one report triage.
 *
 * @returns ``{ state, start, reset }``.
 */
export const useCptPdfTriage: () => UseCptPdfTriageResult = cptTriage.useTriage

/** Abort every registered triage and empty the registry. Test-only. */
export const _clearCptPdfTriageRegistry: () => void = cptTriage.clearRegistry

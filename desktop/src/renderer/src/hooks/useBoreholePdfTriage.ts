/**
 * Run a PDF borehole-log report's triage job and surface its progress.
 *
 * The shared PDF triage path (``pdfTriageRegistry.ts``: upload, job, SSE
 * stream, spawn-or-attach, StrictMode-safe registry) bound to the
 * ``/borehole/pdf/*`` client: the CPT digitiser's user path for borehole logs
 * (owner 2026-10-10).
 */

import { boreholePdfClient, type BoreholePdfDigest } from '../api/clients/boreholePdf'
import { createPdfTriage, type UsePdfTriageResult } from './pdfTriageRegistry'

const boreholeTriage = createPdfTriage<BoreholePdfDigest>({
  tag: 'borehole-pdf',
  // Lazy: tests replace the client's calls after this module loaded.
  startTriage: (filePath, projectId) => boreholePdfClient.startTriage(filePath, projectId),
  streamUrl: jobId => boreholePdfClient.streamUrl(jobId),
  describe: digest =>
    `${digest.boreholes.length} borehole(s), ${digest.dropped.length} repeat print(s) left out`,
})

/**
 * Manage one borehole report triage.
 *
 * @returns ``{ state, start, reset }``.
 */
export const useBoreholePdfTriage: () => UsePdfTriageResult<BoreholePdfDigest> =
  boreholeTriage.useTriage

/** Abort every registered triage and empty the registry. Test-only. */
export const _clearBoreholePdfTriageRegistry: () => void = boreholeTriage.clearRegistry

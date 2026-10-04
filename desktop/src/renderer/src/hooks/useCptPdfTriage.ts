/**
 * Run a PDF report's triage job and surface its progress.
 *
 * Lifecycle: ``idle`` → ``uploading`` (the report streams to the backend) →
 * ``running`` (classify every page, then digitise the offered sheets; each
 * tick carries ``phase / done / total``) → ``done`` (the digest the dialog
 * lists) or ``error``. Same job + SSE pattern as the DOV import
 * (``useDovImportStream``), through the shared ``readSseEvents`` reader.
 *
 * Spawn or attach: the backend keys a triage job on the project and the
 * report's SHA-256, so a second upload of a report whose triage still runs is
 * refused ``409`` naming the running job. That job IS this report's triage, so
 * the hook attaches to its stream instead of failing (owner's dogfeed
 * 2026-10-04: a StrictMode double effect aborted the first stream and the
 * second upload's 409 left the dialog on "already running" with no list).
 * ``start`` is also idempotent per (report, project) while a triage is in
 * flight, so a repeated call does not upload the report again.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { messageForApiCode, messageForDetail } from '../api/clients/apiCodeMessages'
import { cptPdfClient, runningTriageJobId, type CptPdfDigest } from '../api/clients/cptPdf'
import { log } from '../utils/log'
import { readSseEvents } from '../utils/sseEvents'

/** The triage's two phases, in order. */
export type CptPdfTriagePhase = 'classify' | 'digitise'

/** Where the triage stands. */
export type CptPdfTriageState =
  | { status: 'idle' }
  | { status: 'uploading' }
  | { status: 'running'; phase: CptPdfTriagePhase | null; done: number; total: number }
  | { status: 'done'; digest: CptPdfDigest }
  | { status: 'error'; message: string }

/** What {@link useCptPdfTriage} returns. */
export interface UseCptPdfTriageResult {
  state: CptPdfTriageState
  /** Upload ``filePath`` into ``projectId`` and triage it. */
  start: (filePath: string, projectId: string) => void
  /** Abort a running triage and go back to idle. */
  reset: () => void
}

/**
 * Read one triage job's SSE stream to its terminal event.
 *
 * @param jobId - The triage job to follow.
 * @param signal - Aborts the stream (a superseded or reset triage).
 * @param onProgress - Called with every ``running`` tick.
 * @returns The terminal state: ``done`` with the digest, or ``error``.
 * @throws AbortError when ``signal`` aborts; any network failure.
 */
async function drainTriageStream(
  jobId: string,
  signal: AbortSignal,
  onProgress: (state: CptPdfTriageState) => void,
): Promise<CptPdfTriageState> {
  onProgress({ status: 'running', phase: null, done: 0, total: 0 })
  const res = await fetch(cptPdfClient.streamUrl(jobId), { signal })
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}))
    const msg = messageForDetail((body as { detail?: unknown }).detail, `HTTP ${res.status}`)
    log.error('cpt-pdf', `triage stream for job ${jobId} failed: ${msg}`)
    return { status: 'error', message: msg }
  }
  for await (const event of readSseEvents(res.body, raw =>
    log.warn('cpt-pdf', `unparseable SSE frame: ${raw}`),
  )) {
    if (event.type === 'done') {
      const digest = event.result as CptPdfDigest
      log.success(
        'cpt-pdf',
        `triage done: ${digest.campaign.length} campaign soundings, ${digest.dropped.length} set aside`,
      )
      return { status: 'done', digest }
    }
    if (event.type === 'error') {
      const msg =
        messageForApiCode(event.code as string | undefined) ??
        (event.message as string | undefined) ??
        'Triage failed'
      log.error('cpt-pdf', `triage error: ${msg}`)
      return { status: 'error', message: msg }
    }
    if (typeof event.phase === 'string') {
      onProgress({
        status: 'running',
        phase: event.phase as CptPdfTriagePhase,
        done: (event.done as number) ?? 0,
        total: (event.total as number) ?? 0,
      })
    }
  }
  log.warn('cpt-pdf', `triage stream for job ${jobId} closed without a terminal event`)
  return { status: 'error', message: 'Triage stream closed unexpectedly' }
}

/**
 * Spawn the report's triage job, or name the one already running for it.
 *
 * @param filePath - The report on disk.
 * @param projectId - The project the triage belongs to.
 * @returns The job id to follow.
 * @throws Any upload failure other than the 409 that names a running job.
 */
async function spawnOrAttachTriage(filePath: string, projectId: string): Promise<string> {
  try {
    const { job_id } = await cptPdfClient.startTriage(filePath, projectId)
    log.info('cpt-pdf', `triage job ${job_id} spawned`)
    return job_id
  } catch (err) {
    const running = runningTriageJobId(err)
    if (running === null) throw err
    log.info('cpt-pdf', `triage already running as job ${running}, attaching`)
    return running
  }
}

/**
 * Manage one report triage.
 *
 * @returns ``{ state, start, reset }``.
 */
export function useCptPdfTriage(): UseCptPdfTriageResult {
  const [state, setState] = useState<CptPdfTriageState>({ status: 'idle' })
  const abortRef = useRef<AbortController | null>(null)
  // The (project, report) whose triage is uploading or running; a repeated
  // ``start`` for it is a no-op. Cleared on a terminal state, reset and unmount.
  const inFlightKeyRef = useRef<string | null>(null)

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    inFlightKeyRef.current = null
    setState({ status: 'idle' })
  }, [])

  // Abort the stream when the dialog unmounts mid-triage. The key goes too: a
  // StrictMode remount then starts again, and its upload attaches to the job
  // the first upload spawned (the 409 path) instead of hanging on a dead stream.
  useEffect(
    () => () => {
      abortRef.current?.abort()
      abortRef.current = null
      inFlightKeyRef.current = null
    },
    [],
  )

  const start = useCallback((filePath: string, projectId: string) => {
    const key = `${projectId}|${filePath}`
    if (inFlightKeyRef.current === key) {
      log.debug('cpt-pdf', `triage of ${filePath} already in flight; start ignored`)
      return
    }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    inFlightKeyRef.current = key
    setState({ status: 'uploading' })
    // Only the current triage may write state: a superseded one stays silent.
    const update = (next: CptPdfTriageState): void => {
      if (!controller.signal.aborted) setState(next)
    }
    void (async () => {
      try {
        const jobId = await spawnOrAttachTriage(filePath, projectId)
        if (controller.signal.aborted) {
          log.debug('cpt-pdf', `triage job ${jobId} superseded before its stream opened`)
          return
        }
        update(await drainTriageStream(jobId, controller.signal, update))
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          log.info('cpt-pdf', 'triage stream aborted by client')
          return
        }
        const msg = err instanceof Error ? err.message : 'Unknown triage error'
        log.error('cpt-pdf', `triage failed: ${msg}`, err)
        update({ status: 'error', message: msg })
      } finally {
        if (abortRef.current === controller) inFlightKeyRef.current = null
      }
    })()
  }, [])

  return { state, start, reset }
}

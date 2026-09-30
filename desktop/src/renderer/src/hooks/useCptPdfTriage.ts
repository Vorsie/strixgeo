/**
 * Run a PDF report's triage job and surface its progress.
 *
 * Lifecycle: ``idle`` → ``uploading`` (the report streams to the backend) →
 * ``running`` (classify every page, then digitise the offered sheets; each
 * tick carries ``phase / done / total``) → ``done`` (the digest the dialog
 * lists) or ``error``. Same job + SSE pattern as the DOV import
 * (``useDovImportStream``), through the shared ``readSseEvents`` reader.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { messageForApiCode, messageForDetail } from '../api/clients/apiCodeMessages'
import { cptPdfClient, type CptPdfDigest } from '../api/clients/cptPdf'
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
 * Manage one report triage.
 *
 * @returns ``{ state, start, reset }``.
 */
export function useCptPdfTriage(): UseCptPdfTriageResult {
  const [state, setState] = useState<CptPdfTriageState>({ status: 'idle' })
  const abortRef = useRef<AbortController | null>(null)

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setState({ status: 'idle' })
  }, [])

  // Abort the stream when the dialog unmounts mid-triage.
  useEffect(() => () => abortRef.current?.abort(), [])

  const start = useCallback((filePath: string, projectId: string) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setState({ status: 'uploading' })
    void (async () => {
      try {
        const { job_id } = await cptPdfClient.startTriage(filePath, projectId)
        log.info('cpt-pdf', `triage job ${job_id} spawned`)
        setState({ status: 'running', phase: null, done: 0, total: 0 })
        const res = await fetch(cptPdfClient.streamUrl(job_id), { signal: controller.signal })
        if (!res.ok || !res.body) {
          const body = await res.json().catch(() => ({}))
          const msg = messageForDetail((body as { detail?: unknown }).detail, `HTTP ${res.status}`)
          log.error('cpt-pdf', `triage stream failed: ${msg}`)
          setState({ status: 'error', message: msg })
          return
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
            setState({ status: 'done', digest })
            return
          }
          if (event.type === 'error') {
            const msg =
              messageForApiCode(event.code as string | undefined) ??
              (event.message as string | undefined) ??
              'Triage failed'
            log.error('cpt-pdf', `triage error: ${msg}`)
            setState({ status: 'error', message: msg })
            return
          }
          if (typeof event.phase === 'string') {
            setState({
              status: 'running',
              phase: event.phase as CptPdfTriagePhase,
              done: (event.done as number) ?? 0,
              total: (event.total as number) ?? 0,
            })
          }
        }
        log.warn('cpt-pdf', 'triage stream closed without a terminal event')
        setState(prev =>
          prev.status === 'running' ? { status: 'error', message: 'Triage stream closed unexpectedly' } : prev,
        )
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          log.info('cpt-pdf', 'triage stream aborted by client')
          return
        }
        const msg = err instanceof Error ? err.message : 'Unknown triage error'
        log.error('cpt-pdf', `triage failed: ${msg}`, err)
        setState({ status: 'error', message: msg })
      }
    })()
  }, [])

  return { state, start, reset }
}

// A PDF page thumbnail for the triage list, shown from a blob: object URL.
//
// The renderer's Content-Security-Policy (main/security.ts) allows images only
// from 'self', data:, blob: and https:, so an <img> pointed straight at the
// local http backend is blocked and the row showed its alt text instead (owner
// dogfeed 2026-10-04). The CSP stays as it is: the PNG is fetched through the
// API client (``cptPdfClient.pageBlob`` -> ``fetchTracked``) and shown from an
// object URL.
//
// Scrolling the 75-row list must not refetch a page, so loaded Blobs live in a
// small module-level cache keyed on (report sha, page) and a load in flight is
// shared by every row asking for the same page. Each mounted row makes its own
// object URL from the cached Blob and revokes it when the row unmounts or
// shows another page, so a URL never outlives the row that uses it.
import { useEffect, useState } from 'react'

import { boreholePdfClient } from '../api/clients/boreholePdf'
import { cptPdfClient } from '../api/clients/cptPdf'
import { log } from '../utils/log'

/** Which import's report store holds the page: the CPT and the borehole PDF
 *  imports keep their reports apart (``/cpt/pdf`` vs ``/borehole/pdf``). */
export type PdfPageSource = 'cpt' | 'borehole'

/** Pages kept in memory. An 80-dpi page PNG is ~20-60 kB, so 120 pages stay
 *  well under 10 MB and hold every sheet of a large report's list. */
export const PDF_THUMBNAIL_CACHE_SIZE = 120

/** Loaded pages, oldest first (Map keeps insertion order; a hit re-inserts). */
const cache = new Map<string, Blob>()
/** Loads in flight, shared by every row asking for the same page. */
const inFlight = new Map<string, Promise<Blob>>()

function cacheKey(fileSha: string, page: number, source: PdfPageSource): string {
  return `${source}:${fileSha}#${page}`
}

/** Store a loaded page, dropping the oldest once the cache is full. */
function remember(key: string, blob: Blob): void {
  cache.delete(key)
  cache.set(key, blob)
  while (cache.size > PDF_THUMBNAIL_CACHE_SIZE) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

/** The page's Blob: from the cache, from a load already running, or fetched. */
function loadPage(fileSha: string, page: number, projectId: string, source: PdfPageSource): Promise<Blob> {
  const key = cacheKey(fileSha, page, source)
  const hit = cache.get(key)
  if (hit) {
    remember(key, hit)
    return Promise.resolve(hit)
  }
  const running = inFlight.get(key)
  if (running) return running
  const client = source === 'borehole' ? boreholePdfClient : cptPdfClient
  const load = client
    .pageBlob(fileSha, page, projectId)
    .then(blob => {
      remember(key, blob)
      return blob
    })
    .finally(() => inFlight.delete(key))
  inFlight.set(key, load)
  return load
}

/** Forget every cached page (tests; a new report never reuses a sha). */
export function clearPdfPageThumbnailCache(): void {
  cache.clear()
  inFlight.clear()
}

/** What a row renders: the object URL once loaded, or a placeholder. */
export interface PdfPageThumbnail {
  /** ``blob:`` URL of the page PNG; null while loading or after a failure. */
  url: string | null
  /** True when the page could not be fetched. */
  error: boolean
}

/**
 * React hook: one report page as a ``blob:`` URL the CSP allows.
 *
 * @param fileSha - SHA-256 of the triaged report.
 * @param page - 1-based page number.
 * @param projectId - The open project (the endpoint is project-scoped).
 * @param source - Which import's store holds the report (default ``cpt``).
 * @returns ``{ url, error }``; ``url`` is null while loading and on failure.
 */
export function usePdfPageThumbnail(
  fileSha: string,
  page: number,
  projectId: string,
  source: PdfPageSource = 'cpt',
): PdfPageThumbnail {
  const [state, setState] = useState<PdfPageThumbnail>({ url: null, error: false })

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    setState({ url: null, error: false })
    loadPage(fileSha, page, projectId, source).then(
      blob => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setState({ url: objectUrl, error: false })
      },
      (err: unknown) => {
        if (cancelled) return
        log.warn('cptPdf', `page ${page} thumbnail not loaded: ${err instanceof Error ? err.message : String(err)}`)
        setState({ url: null, error: true })
      },
    )
    return () => {
      cancelled = true
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl)
    }
  }, [fileSha, page, projectId, source])

  return state
}

// The triage list's page thumbnails (owner dogfeed 2026-10-04): every row showed
// its alt text "Pagina 172 van het rapport" instead of the page, because the
// renderer's Content-Security-Policy allows images only from 'self', data:,
// blob: and https:, and the thumbnail pointed an <img> straight at the local
// http backend. The CSP stays as it is; the PNG is fetched through the API
// client and shown from a blob: object URL. Scrolling a 75-row list must not
// fetch a page twice, and an object URL is released when its row goes away.
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const pageBlob = vi.fn()
vi.mock('../api/clients/cptPdf', async () => {
  const actual = await vi.importActual<typeof import('../api/clients/cptPdf')>('../api/clients/cptPdf')
  return {
    ...actual,
    cptPdfClient: { ...actual.cptPdfClient, pageBlob: (...a: unknown[]) => pageBlob(...a) },
  }
})

import {
  clearPdfPageThumbnailCache,
  PDF_THUMBNAIL_CACHE_SIZE,
  usePdfPageThumbnail,
} from './usePdfPageThumbnail'

const SHA = 'a'.repeat(64)
let urlCount = 0
const createObjectURL = vi.fn(() => `blob:thumb-${++urlCount}`)
const revokeObjectURL = vi.fn()
const realCreate = URL.createObjectURL
const realRevoke = URL.revokeObjectURL

beforeEach(() => {
  clearPdfPageThumbnailCache()
  pageBlob.mockReset()
  pageBlob.mockImplementation(async () => new Blob(['png'], { type: 'image/png' }))
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
  URL.createObjectURL = createObjectURL
  URL.revokeObjectURL = revokeObjectURL
})

afterEach(() => {
  URL.createObjectURL = realCreate
  URL.revokeObjectURL = realRevoke
})

describe('usePdfPageThumbnail', () => {
  it('T1: shows the page from a blob: URL fetched through the API client', async () => {
    const { result } = renderHook(() => usePdfPageThumbnail(SHA, 172, 'p1'))
    expect(result.current).toEqual({ url: null, error: false })
    await waitFor(() => expect(result.current.url).toMatch(/^blob:/))
    expect(pageBlob).toHaveBeenCalledWith(SHA, 172, 'p1')
  })

  it('T2: two rows asking for the same page at once fetch it once', async () => {
    const a = renderHook(() => usePdfPageThumbnail(SHA, 5, 'p1'))
    const b = renderHook(() => usePdfPageThumbnail(SHA, 5, 'p1'))
    await waitFor(() => expect(a.result.current.url).not.toBeNull())
    await waitFor(() => expect(b.result.current.url).not.toBeNull())
    expect(pageBlob).toHaveBeenCalledTimes(1)
  })

  it('T3: a row scrolled back into view does not fetch its page again', async () => {
    const first = renderHook(() => usePdfPageThumbnail(SHA, 9, 'p1'))
    await waitFor(() => expect(first.result.current.url).not.toBeNull())
    first.unmount()
    const again = renderHook(() => usePdfPageThumbnail(SHA, 9, 'p1'))
    await waitFor(() => expect(again.result.current.url).not.toBeNull())
    expect(pageBlob).toHaveBeenCalledTimes(1)
  })

  it('T4: the object URL is released when the row goes away or shows another page', async () => {
    const { result, rerender, unmount } = renderHook(
      ({ page }: { page: number }) => usePdfPageThumbnail(SHA, page, 'p1'),
      { initialProps: { page: 1 } },
    )
    await waitFor(() => expect(result.current.url).not.toBeNull())
    const firstUrl = result.current.url
    rerender({ page: 2 })
    expect(revokeObjectURL).toHaveBeenCalledWith(firstUrl)
    await waitFor(() => expect(result.current.url).not.toBe(firstUrl))
    await waitFor(() => expect(result.current.url).not.toBeNull())
    const secondUrl = result.current.url
    unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith(secondUrl)
  })

  it('T5: a failed fetch reports an error and no URL (the row shows its placeholder)', async () => {
    pageBlob.mockRejectedValueOnce(new Error('404'))
    const { result } = renderHook(() => usePdfPageThumbnail(SHA, 404, 'p1'))
    await waitFor(() => expect(result.current.error).toBe(true))
    expect(result.current.url).toBeNull()
  })

  it('T6: the cache is bounded: the oldest page is fetched again once it is pushed out', async () => {
    for (let page = 1; page <= PDF_THUMBNAIL_CACHE_SIZE + 1; page++) {
      const h = renderHook(() => usePdfPageThumbnail(SHA, page, 'p1'))
      // One macrotask settles the mocked fetch (a waitFor per page polls at
      // 50 ms and would take seconds over 121 pages).
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
      })
      expect(h.result.current.url).not.toBeNull()
      h.unmount()
    }
    expect(pageBlob).toHaveBeenCalledTimes(PDF_THUMBNAIL_CACHE_SIZE + 1)
    const back = renderHook(() => usePdfPageThumbnail(SHA, 1, 'p1'))
    await waitFor(() => expect(back.result.current.url).not.toBeNull())
    expect(pageBlob).toHaveBeenCalledTimes(PDF_THUMBNAIL_CACHE_SIZE + 2)
  })
})

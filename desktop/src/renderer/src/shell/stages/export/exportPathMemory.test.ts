// The Export hub remembers each card's last save path per project — a
// per-viewer convenience, so every access must survive a throwing / empty store.

import { describe, it, expect, beforeEach, vi } from 'vitest'

import { rememberExportPath, recallExportPath } from './exportPathMemory'

beforeEach(() => {
  localStorage.clear()
})

describe('exportPathMemory', () => {
  it('round-trips a path per project + card', () => {
    rememberExportPath('proj-1', 'litho-dstability', 'C:/out/a.stix')
    expect(recallExportPath('proj-1', 'litho-dstability')).toBe('C:/out/a.stix')
  })

  it('keeps cards and projects separate', () => {
    rememberExportPath('proj-1', 'litho-dstability', 'C:/out/a.stix')
    rememberExportPath('proj-1', 'geotech-dsheet', 'C:/out/b.shi')
    rememberExportPath('proj-2', 'litho-dstability', 'C:/out/c.stix')
    expect(recallExportPath('proj-1', 'geotech-dsheet')).toBe('C:/out/b.shi')
    expect(recallExportPath('proj-2', 'litho-dstability')).toBe('C:/out/c.stix')
  })

  it('returns null for an unknown card', () => {
    expect(recallExportPath('proj-1', 'never-saved')).toBeNull()
  })

  it('never throws when storage itself throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    expect(recallExportPath('proj-1', 'litho-dstability')).toBeNull()
    spy.mockRestore()
  })
})

import { describe, expect, it } from 'vitest'
import { splitInvestigationName } from './investigationName'

describe('splitInvestigationName — short code and project key from a DOV/GEF name', () => {
  it('a DOV name: the code is the token after the last dash, the project is the rest', () => {
    expect(splitInvestigationName('GEO-16/095-S7')).toEqual({ projectKey: 'GEO-16/095', code: 'S7' })
    expect(splitInvestigationName('GEO-16/095-B4')).toEqual({ projectKey: 'GEO-16/095', code: 'B4' })
  })
  it('a numeric last token after a single letter keeps the letter', () => {
    expect(splitInvestigationName('B-4')).toEqual({ projectKey: '', code: 'B4' })
    expect(splitInvestigationName('GEO-19/022-S-12')).toEqual({ projectKey: 'GEO-19/022', code: 'S12' })
  })
  it('a name without a dash is its own code and has no project', () => {
    expect(splitInvestigationName('Sondering 12')).toEqual({ projectKey: '', code: 'Sondering 12' })
  })
  it('trims whitespace and never returns an empty code', () => {
    expect(splitInvestigationName('  GEO-1/2-  ')).toEqual({ projectKey: 'GEO-1/2', code: 'GEO-1/2' })
  })
})

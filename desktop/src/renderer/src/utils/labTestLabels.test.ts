import { describe, expect, it } from 'vitest'

import {
  astmDescription,
  isAstmClassification,
  labelForParameter,
  labelForParameterGroup,
} from './labTestLabels'

describe('labelForParameterGroup', () => {
  it('translates known parametergroep tokens, including DOV trailing-space variants', () => {
    expect(labelForParameterGroup('Onderkenningsproeven-korrelverdeling ')).toBe('Grain-size analysis')
    expect(labelForParameterGroup('Bodem_chemisch')).toBe('Soil chemistry')
  })

  it('falls back to the trimmed source string for unknown groups', () => {
    expect(labelForParameterGroup('  Some_new_group  ')).toBe('Some_new_group')
  })

  it('returns an em-dash for empty input rather than a blank label', () => {
    expect(labelForParameterGroup('')).toBe('—')
  })
})

describe('labelForParameter', () => {
  it('strips the doubled-token DOV tail before lookup', () => {
    expect(labelForParameter('Korrelvolumemassa (korrelvolumemassa)')).toBe('Grain density')
  })

  it('falls back to the trimmed parameter when unknown', () => {
    expect(labelForParameter('Brand new test (brand new test)')).toBe('Brand new test')
  })
})

describe('astmDescription', () => {
  it('resolves known D2487 codes case-insensitively', () => {
    expect(astmDescription('CL')).toBe('Clay (lean, low plasticity)')
    expect(astmDescription('cl')).toBe('Clay (lean, low plasticity)')
  })

  it('returns null for null, undefined, or unknown codes', () => {
    expect(astmDescription(null)).toBeNull()
    expect(astmDescription(undefined)).toBeNull()
    expect(astmDescription('zz')).toBeNull()
  })
})

describe('isAstmClassification', () => {
  it('identifies ASTM-classification parameter strings', () => {
    expect(isAstmClassification('Grondsoort volgens ASTM, de code')).toBe(true)
    expect(isAstmClassification('Grondsoort volgens ASTM, de beschrijving')).toBe(true)
  })

  it('rejects non-ASTM parameters', () => {
    expect(isAstmClassification('Korrelvolumemassa')).toBe(false)
    expect(isAstmClassification('')).toBe(false)
  })
})

// A GEF that declares a pre-drill its depth column was not shifted by comes back
// with PRE_DRILL_NOT_APPLIED; the import summary names the CPT, the declared
// pre-drill and the first depth, in the UI language (camz-001 soundings 39/42:
// 0.35 m declared, data from 0.02 m).

import { describe, expect, it } from 'vitest'

import { translate } from '../i18n/translate'
import { preDrillImportWarning } from './preDrillImportWarning'

const EN = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
  translate('en', key, params)
const NL = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
  translate('nl', key, params)

const ISSUE = {
  level: 'warning',
  code: 'PRE_DRILL_NOT_APPLIED',
  message: 'Pre-drill of 0.35 m declared (MEASUREMENTVAR 13) but the depth column starts at 0.02 m',
  rows: [],
  details: { pre_drill_m: 0.35, first_depth_m: 0.02 },
}

describe('preDrillImportWarning', () => {
  it('names the CPT, the declared pre-drill and the first depth (EN)', () => {
    const line = preDrillImportWarning([ISSUE], '23.15-002_39', EN)
    expect(line).toContain('23.15-002_39')
    expect(line).toContain('0.35 m')
    expect(line).toContain('0.02 m')
  })

  it('says it in Dutch when the UI is Dutch', () => {
    const line = preDrillImportWarning([ISSUE], '23.15-002_39', NL)
    expect(line).toContain('voorboring van 0.35 m')
    expect(line).toContain('0.02 m')
  })

  it('falls back to the backend wording when the finding carries no numbers', () => {
    const { details: _omit, ...bare } = ISSUE
    expect(preDrillImportWarning([bare], 'X', EN)).toBe(`X: ${ISSUE.message}`)
  })

  it('is null for a CPT without the finding', () => {
    const other = { ...ISSUE, code: 'PRE_DRILL', details: undefined }
    expect(preDrillImportWarning([other], 'X', EN)).toBeNull()
    expect(preDrillImportWarning([], 'X', EN)).toBeNull()
  })
})

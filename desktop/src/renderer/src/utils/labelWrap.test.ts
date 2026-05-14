import { describe, expect, it } from 'vitest'
import { maxCharsForWidth, maxLinesForHeight, wrapLabelToLines } from './labelWrap'

describe('wrapLabelToLines', () => {
  it('returns an empty array for empty / whitespace input', () => {
    expect(wrapLabelToLines('', 10, 3)).toEqual([])
    expect(wrapLabelToLines('   ', 10, 3)).toEqual([])
  })

  it('returns a single-line array when the label fits in one line', () => {
    expect(wrapLabelToLines('Fm Gent', 10, 3)).toEqual(['Fm Gent'])
  })

  it('wraps on whitespace boundaries', () => {
    // "Formatie van Boom" — 18 chars total, 6 per line forces three
    // lines (one word per line because each word is ≤ 6 chars).
    expect(wrapLabelToLines('Formatie van Boom', 8, 3)).toEqual([
      'Formatie',
      'van Boom',
    ])
  })

  it('splits oversized words at the line boundary', () => {
    // "Quartaire" is 9 chars — wider than the line cap.
    expect(wrapLabelToLines('Quartaire Aquifersystemen', 8, 4)).toEqual([
      'Quartair',
      'e',
      'Aquifers',
      'ystemen',
    ])
  })

  it('ellipses the last line when content overflows the line cap', () => {
    expect(wrapLabelToLines('Quartaire Aquifersystemen complex', 8, 2)).toEqual([
      'Quartair',
      'e Aquif…',
    ])
  })

  it('caps at maxLines = 1 with an ellipsis', () => {
    expect(wrapLabelToLines('Antropogeen Quartair', 10, 1)).toEqual([
      'Antropoge…',
    ])
  })

  it('returns empty when maxLines is 0 — caller should fall back to tooltip', () => {
    expect(wrapLabelToLines('anything', 10, 0)).toEqual([])
  })

  it('returns empty when maxCharsPerLine is 0', () => {
    expect(wrapLabelToLines('Fm Boom', 0, 3)).toEqual([])
  })
})

describe('maxLinesForHeight', () => {
  it('returns 0 when the rect is too short for even one line', () => {
    expect(maxLinesForHeight(4, 9)).toBe(0)
  })

  it('returns 1 for a rect just tall enough', () => {
    // 9 * 1.15 = 10.35; rect 16 px - 4 px inset = 12 usable → 1 line.
    expect(maxLinesForHeight(16, 9)).toBe(1)
  })

  it('returns multiple lines for tall rects', () => {
    // 50 px - 4 inset = 46 usable. line height 9 * 1.15 = 10.35.
    // 46 / 10.35 ≈ 4.44 → 4 lines.
    expect(maxLinesForHeight(50, 9)).toBe(4)
  })
})

describe('maxCharsForWidth', () => {
  it('returns at least 1 even for tiny widths', () => {
    expect(maxCharsForWidth(4, 9)).toBe(1)
  })

  it('scales sanely with width', () => {
    // 44 px column - 4 inset = 40 usable. 9 * 0.55 ≈ 4.95 px / char.
    // 40 / 4.95 ≈ 8.08 → floor → 8 chars per line.
    expect(maxCharsForWidth(44, 9)).toBe(8)
    // 50 px column → 9 chars.
    expect(maxCharsForWidth(50, 9)).toBe(9)
  })
})

/**
 * Pins for the pure half of ``closeApp``'s dirty-quit handling (explicit
 * vitest imports; tsconfig.e2e has no vitest globals).
 *
 * The rules, in the words of the walker finding (2026-10-13): after a walk the
 * project was dirty, the quit opened the unsaved-changes prompt, and the
 * teardown never got through it. The harness must (1) find the prompt in
 * WHICHEVER window shows it, not assume ``windows()[0]``; (2) only click a
 * discard button that is there and enabled; (3) when the app stays alive
 * without a prompt it can click, leave a log line per window that says what
 * that window was showing, so the next hang is diagnosable from the log.
 */

import { describe, it, expect } from 'vitest'

import {
  BODY_EXCERPT_CHARS,
  bodyExcerpt,
  formatWindowReport,
  pickDialogWindow,
  type WindowProbe,
} from './closeAppProbe'

function probe(overrides: Partial<WindowProbe> = {}): WindowProbe {
  return {
    index: 0,
    url: 'file:///out/renderer/index.html',
    closed: false,
    reachable: true,
    title: 'StrixGeo',
    dialog: false,
    discard: 'absent',
    bodyText: 'Data Secties Litho',
    ...overrides,
  }
}

describe('pickDialogWindow — the window that shows the prompt, wherever it is', () => {
  it('picks the second window when only the second shows the prompt', () => {
    const probes = [
      probe({ index: 0, url: 'file:///out/renderer/sheet.html' }),
      probe({ index: 1, dialog: true, discard: 'enabled' }),
    ]
    expect(pickDialogWindow(probes)).toBe(1)
  })

  it('picks the first window when it shows the prompt', () => {
    expect(pickDialogWindow([probe({ dialog: true, discard: 'enabled' })])).toBe(0)
  })

  it('returns null when no window shows the prompt (a clean quit)', () => {
    expect(pickDialogWindow([probe(), probe({ index: 1 })])).toBeNull()
  })

  it('does not pick a prompt whose discard button is disabled (a save in flight)', () => {
    expect(pickDialogWindow([probe({ dialog: true, discard: 'disabled' })])).toBeNull()
  })

  it('does not pick a prompt that has no discard button', () => {
    expect(pickDialogWindow([probe({ dialog: true, discard: 'absent' })])).toBeNull()
  })

  it('skips a closed or unreachable window even if its last probe saw a prompt', () => {
    const probes = [
      probe({ index: 0, closed: true, dialog: true, discard: 'enabled' }),
      probe({ index: 1, reachable: false, dialog: true, discard: 'enabled' }),
      probe({ index: 2, dialog: true, discard: 'enabled' }),
    ]
    expect(pickDialogWindow(probes)).toBe(2)
  })
})

describe('bodyExcerpt — the first 300 characters of what the window shows', () => {
  it('keeps at most the first 300 characters', () => {
    const text = 'x'.repeat(1000)
    expect(BODY_EXCERPT_CHARS).toBe(300)
    expect(bodyExcerpt(text)).toHaveLength(300)
  })

  it('collapses whitespace runs so one window is one log line', () => {
    expect(bodyExcerpt('Data\n\n  Secties\tLitho ')).toBe('Data Secties Litho')
  })

  it('says so when the body could not be read', () => {
    expect(bodyExcerpt(null)).toBe('<unreadable>')
  })
})

describe('formatWindowReport — a hang names every window and what it shows', () => {
  it('writes one line per window with its url, prompt state and body excerpt', () => {
    const lines = formatWindowReport([
      probe({ index: 0, title: 'StrixGeo — Worked example *', bodyText: 'Bouw het model' }),
      probe({
        index: 1,
        url: 'file:///out/renderer/sheet.html',
        dialog: true,
        discard: 'disabled',
        bodyText: 'Wijzigingen opslaan?',
      }),
    ])
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('window[0]')
    expect(lines[0]).toContain('file:///out/renderer/index.html')
    expect(lines[0]).toContain('StrixGeo — Worked example *')
    expect(lines[0]).toContain('prompt=no')
    expect(lines[0]).toContain('Bouw het model')
    expect(lines[1]).toContain('window[1]')
    expect(lines[1]).toContain('prompt=yes')
    expect(lines[1]).toContain('discard=disabled')
    expect(lines[1]).toContain('Wijzigingen opslaan?')
  })

  it('marks a window whose renderer did not answer the probe (a hung renderer)', () => {
    const [line] = formatWindowReport([probe({ reachable: false, bodyText: null })])
    expect(line).toContain('UNREACHABLE')
    expect(line).toContain('<unreadable>')
  })

  it('marks a closed window', () => {
    const [line] = formatWindowReport([probe({ closed: true, bodyText: null })])
    expect(line).toContain('closed')
  })

  it('says there are no windows at all rather than printing nothing', () => {
    expect(formatWindowReport([])).toEqual(['no windows'])
  })
})

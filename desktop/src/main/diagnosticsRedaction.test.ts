/**
 * What a captured diagnostic is allowed to contain.
 *
 * The rule these cases encode: a crash report may say what broke, and must not
 * say **who** the engineer is or **what site** they were working on. Stack
 * frames stay readable — a report that cannot be read is not worth capturing —
 * but the user's name and their project's identity come out.
 */

import { describe, expect, it } from 'vitest'

import { REDACTED_TEXT_CAP, redactText } from './diagnosticsRedaction'

describe('the engineer’s identity comes out', () => {
  it('R1 — a Windows user name is replaced wherever it appears', () => {
    const out = redactText('failed to open C:\\Users\\robin\\Documents\\notes.js')

    expect(out).not.toContain('robin')
    expect(out).toContain('<user>')
  })

  it('R2 — a macOS/Linux home directory is replaced', () => {
    expect(redactText('/Users/robin/app/out/main/index.js')).not.toContain('robin')
    expect(redactText('/home/robin/app/out/main/index.js')).not.toContain('robin')
  })

  it('R3 — an email address never survives', () => {
    const out = redactText('activation failed for robin.vorsselmans@example.com')

    expect(out).not.toContain('@example.com')
    expect(out).toContain('<email>')
  })

  it('R3b — a database connection string never survives', () => {
    // The backend prints its own DSN on startup, password included.
    const out = redactText('connecting to postgresql://groundmodel:groundmodel@127.0.0.1:5433/groundmodel')

    expect(out).not.toContain('groundmodel:groundmodel@')
    expect(out).toContain('<dsn>')
  })

  it('R4 — a routable IP address is removed but our own backend is not', () => {
    const out = redactText('POST http://127.0.0.1:8765/cpt/import from 84.195.12.7')

    expect(out).toContain('127.0.0.1:8765')
    expect(out).not.toContain('84.195.12.7')
  })
})

describe('the project’s identity comes out', () => {
  it('R5 — a project file path is reduced to its kind', () => {
    const out = redactText('cannot read D:\\Projecten\\ClientX\\Antwerpen-Noord.strix')

    expect(out).not.toContain('Antwerpen-Noord')
    expect(out).not.toContain('ClientX')
    expect(out).toContain('<path:.strix>')
  })

  it('R6 — a data-file path anywhere in a sentence is reduced', () => {
    const out = redactText('GEF parse failed: C:\\data\\cpt\\GEO-22-115-S10.gef (row 42)')

    expect(out).not.toContain('GEO-22-115-S10')
    expect(out).toContain('<path:.gef>')
    // The rest of the sentence survives — it is what makes the report useful.
    expect(out).toContain('GEF parse failed')
    expect(out).toContain('row 42')
  })

  it('R7 — a file:// URL is removed whole', () => {
    const out = redactText('navigation blocked: file:///D:/Projecten/ClientX/index.html')

    expect(out).not.toContain('ClientX')
    expect(out).toContain('<file-url>')
  })

  it('R8 — a site coordinate pair is removed', () => {
    const out = redactText('no surface at (152340.55, 211004.20)')

    expect(out).not.toContain('152340')
    expect(out).toContain('<coords>')
  })

  it('R9 — a query string is removed, the route is kept', () => {
    const out = redactText('GET http://127.0.0.1:8765/cpt/list?project_id=abc&name=Antwerpen 500')

    expect(out).not.toContain('Antwerpen')
    expect(out).toContain('/cpt/list')
    expect(out).toContain('500')
  })
})

describe('what stays, on purpose', () => {
  it('R10 — a stack frame inside our own code keeps its module path', () => {
    const out = redactText(
      'TypeError: x is undefined\n    at fillGap (C:\\Users\\robin\\app\\out\\main\\index.js:1200:9)',
    )

    // The user name goes; the frame that tells us WHERE it broke stays.
    expect(out).not.toContain('robin')
    expect(out).toContain('out\\main\\index.js:1200:9')
    expect(out).toContain('fillGap')
  })

  it('R11 — an id survives, because it is meaningless without the user’s own database', () => {
    // Deliberate, and flagged for the owner: ids are the only way to ask
    // "which record was it" in a follow-up. They carry no name, path or value.
    const id = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

    expect(redactText(`body ${id} has no partition`)).toContain(id)
  })

  it('R12 — an HTTP status and a route survive', () => {
    expect(redactText('POST /geology/sections/x/partition 500')).toContain('500')
  })
})

describe('the text is bounded', () => {
  it('R13 — an enormous message is capped', () => {
    const out = redactText('x'.repeat(REDACTED_TEXT_CAP * 3))

    expect(out.length).toBeLessThanOrEqual(REDACTED_TEXT_CAP + 32)
    expect(out).toMatch(/truncated/)
  })

  it('R14 — a non-string reads as empty rather than as "[object Object]"', () => {
    expect(redactText(undefined)).toBe('')
    expect(redactText({ secret: 'value' } as unknown as string)).toBe('')
  })
})

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

describe('a path containing a space is still redacted', () => {
  // The leak these pin: the path body used to stop at the first space, so
  // everything after it (the employer, the client, the site, the surname)
  // survived verbatim in a bundle the UI calls redacted. A path segment can
  // and does contain spaces ("OneDrive - Acme NV", "Two Words") — redaction
  // must consume the whole path, not just its first space-free fragment.

  it('S1 — a Windows project path whose folders contain spaces leaves no client name', () => {
    const out = redactText(
      'cannot read C:\\Users\\robin\\OneDrive - Acme Geotechniek NV\\2026 Antwerp Docks\\Kaai 42.strix',
    )

    // Everything after the first space used to survive.
    expect(out).not.toContain('Acme')
    expect(out).not.toContain('Geotechniek')
    expect(out).not.toContain('Antwerp Docks')
    expect(out).not.toContain('Kaai')
    expect(out).toContain('<path:.strix>')
  })

  it('S2 — a Windows user folder with a space keeps the surname out of a stack frame', () => {
    const out = redactText(
      'at fillGap (C:\\Users\\First Last\\app\\out\\main\\index.js:1200:9)',
    )

    // The user folder is one segment: "First Last". Stripping only "First"
    // used to leak the surname.
    expect(out).not.toContain('Last')
    expect(out).toContain('<user>')
    expect(out).toContain('out\\main\\index.js:1200:9')
  })

  it('S3 — a non-C drive path with spaces is reduced to its kind', () => {
    const out = redactText('save failed for D:\\Projects\\Two Words\\x.strix')

    expect(out).not.toContain('Two Words')
    expect(out).toContain('<path:.strix>')
  })

  it('S4 — a file:// URL with a space is removed whole', () => {
    const out = redactText(
      'navigation blocked: file:///C:/Users/robin/OneDrive - Firm NV/index.html',
    )

    expect(out).not.toContain('Firm NV')
    expect(out).toContain('<file-url>')
  })

  it('S5 — a POSIX project path with spaces leaves no client name', () => {
    const out = redactText('cannot read /Users/robin/My Projects/Client ABC/site.strix')

    expect(out).not.toContain('My Projects')
    expect(out).not.toContain('Client ABC')
    expect(out).toContain('<path:.strix>')
  })

  it('S6 — a POSIX user folder with a space keeps the surname out of a stack frame', () => {
    const out = redactText('/Users/First Last/app/out/main/index.js:1200:9')

    expect(out).not.toContain('Last')
    expect(out).toContain('<user>')
    expect(out).toContain('out/main/index.js')
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

// DOV is Flemish PUBLIC open data — owner ruling 2026-08-28, verbatim: "all
// data from dov doesnt need any redaction whatsoever". Its request URLs carry
// the whole diagnostic payload in the query string (which layer, which bbox,
// which permkey), so scrubbing them costs every DOV import diagnosis and
// protects nothing. Other hosts keep their query stripped.
describe('DOV open data is exempt from redaction', () => {
  it('DOV1 — a DOV WFS request survives whole, query included', () => {
    const url =
      'https://www.dov.vlaanderen.be/geoserver/wfs?service=WFS&request=GetFeature' +
      '&typeName=dov-pub:Sonderingen&bbox=88000,164000,88600,165000'
    expect(redactText(`GET ${url}`)).toContain(url)
  })

  it('DOV2 — a non-DOV host still loses its query string', () => {
    const out = redactText('GET https://tracker.example.com/collect?user=robin&site=kaai42')
    expect(out).not.toContain('robin')
    expect(out).not.toContain('kaai42')
  })
})

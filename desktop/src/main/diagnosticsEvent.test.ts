/**
 * What a captured diagnostic record is allowed to be built from.
 *
 * The rule: the record is assembled from a **whitelist**. A capture site — and
 * especially the renderer, which is the least trusted process we have — can
 * only fill fields this module knows about, and cannot state facts about the
 * build or the machine. Redaction ({@link diagnosticsRedaction}) is the second
 * layer; this is the first.
 */

import { describe, expect, it } from 'vitest'

import { normaliseDiagnosticEvent, type DiagnosticContext } from './diagnosticsEvent'

const CONTEXT: DiagnosticContext = {
  appVersion: '0.1.0',
  platform: 'win32',
  buildId: '2026.08.26-beta',
  nowIso: '2026-08-26T12:00:00.000Z',
}

describe('only known fields survive', () => {
  it('D1 — a field nobody asked for is dropped', () => {
    const event = normaliseDiagnosticEvent(
      {
        kind: 'renderer-error',
        message: 'boom',
        projectName: 'Antwerpen-Noord',
        payload: { qc: [1, 2, 3] },
      },
      'renderer',
      CONTEXT,
    )

    expect(event).not.toBeNull()
    expect(JSON.stringify(event)).not.toContain('Antwerpen-Noord')
    expect(JSON.stringify(event)).not.toContain('qc')
  })

  it('D2 — the message and the stack are redacted', () => {
    const event = normaliseDiagnosticEvent(
      {
        kind: 'renderer-error',
        message: 'cannot open D:\\Projecten\\ClientX\\site.strix',
        stack: 'at open (C:\\Users\\robin\\app\\out\\main\\index.js:9:1)',
      },
      'renderer',
      CONTEXT,
    )

    expect(event?.message).toContain('<path:.strix>')
    expect(event?.stack).not.toContain('robin')
  })

  it('D3 — nothing to say means nothing is captured', () => {
    expect(normaliseDiagnosticEvent({ kind: 'renderer-error' }, 'renderer', CONTEXT)).toBeNull()
    expect(normaliseDiagnosticEvent({ message: '   ' }, 'renderer', CONTEXT)).toBeNull()
  })

  it('D4 — a non-object is not a diagnostic', () => {
    expect(normaliseDiagnosticEvent('boom', 'renderer', CONTEXT)).toBeNull()
    expect(normaliseDiagnosticEvent(null, 'renderer', CONTEXT)).toBeNull()
  })
})

describe('the renderer does not get to state facts about the build', () => {
  it('D5 — build, version and platform always come from the main process', () => {
    const event = normaliseDiagnosticEvent(
      { kind: 'renderer-error', message: 'boom', appVersion: '9.9.9', platform: 'sunos', buildId: 'forged' },
      'renderer',
      CONTEXT,
    )

    expect(event?.appVersion).toBe('0.1.0')
    expect(event?.platform).toBe('win32')
    expect(event?.buildId).toBe('2026.08.26-beta')
  })

  it('D6 — the source is decided by the capture site, not by the payload', () => {
    const event = normaliseDiagnosticEvent(
      { kind: 'renderer-error', message: 'boom', source: 'main' },
      'renderer',
      CONTEXT,
    )

    expect(event?.source).toBe('renderer')
  })

  it('D7 — the timestamp comes from the main process clock', () => {
    const event = normaliseDiagnosticEvent(
      { kind: 'renderer-error', message: 'boom', ts: '1999-01-01T00:00:00.000Z' },
      'renderer',
      CONTEXT,
    )

    expect(event?.ts).toBe('2026-08-26T12:00:00.000Z')
  })
})

describe('unrecognised values degrade instead of passing through', () => {
  it('D8 — an unknown kind becomes the catch-all kind', () => {
    const event = normaliseDiagnosticEvent(
      { kind: 'something-invented', message: 'boom' },
      'renderer',
      CONTEXT,
    )

    expect(event?.kind).toBe('unknown')
  })

  it('D9 — an unknown severity becomes error', () => {
    const event = normaliseDiagnosticEvent(
      { kind: 'renderer-error', severity: 'catastrophic', message: 'boom' },
      'renderer',
      CONTEXT,
    )

    expect(event?.severity).toBe('error')
  })

  it('D10 — a scope with unexpected characters is not carried through', () => {
    const event = normaliseDiagnosticEvent(
      { kind: 'renderer-error', scope: 'C:\\Users\\robin\\project', message: 'boom' },
      'renderer',
      CONTEXT,
    )

    expect(event?.scope).toBe('unknown')
  })

  it('D11 — a plain scope is kept, because it says which module failed', () => {
    const event = normaliseDiagnosticEvent(
      { kind: 'api-error', scope: 'api', message: 'boom' },
      'renderer',
      CONTEXT,
    )

    expect(event?.scope).toBe('api')
  })

  it('D12 — an http status is kept only when it looks like one', () => {
    const good = normaliseDiagnosticEvent(
      { kind: 'api-error', message: 'boom', httpStatus: 500 },
      'renderer',
      CONTEXT,
    )
    const bad = normaliseDiagnosticEvent(
      { kind: 'api-error', message: 'boom', httpStatus: 'five hundred' },
      'renderer',
      CONTEXT,
    )

    expect(good?.httpStatus).toBe(500)
    expect(bad?.httpStatus).toBeUndefined()
  })
})

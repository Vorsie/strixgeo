/**
 * Pins for the walker's invariant checkers.
 *
 * Explicit vitest imports (see walkerPolicy.test.ts for why).
 */

import { describe, it, expect } from 'vitest'

import {
  RESPONSIVENESS_BUDGET_MS,
  checkConsoleErrors,
  checkEmptyView,
  checkPhantomRows,
  checkRefusedRequests,
  checkResponsiveness,
  checkSurvivors,
  isIgnoredConsoleError,
} from './walkerInvariants'

// Walker replay 2026-10-12: a basemap tile request to an external host (Esri /
// Geopunt / OSM) that the network reset logged "Failed to load resource:
// net::ERR_CONNECTION_RESET" at a click on the Leaflet "+" zoom control. That
// is the network, not the app. The rule: a resource-load failure whose
// location is NOT the app itself (file:// bundle, 127.0.0.1 / localhost) is
// ignored; every error from the app's own origin or the backend port is kept,
// and every pageerror is kept.
describe('walker invariant -- an external resource-load failure is not an app finding', () => {
  it('an external tile host reset (net::ERR_CONNECTION_RESET) is ignored', () => {
    expect(
      isIgnoredConsoleError({
        source: 'console',
        text: 'Failed to load resource: net::ERR_CONNECTION_RESET',
        locationUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/17/1/2',
      }),
    ).toBe(true)
  })

  it('a backend 409 on 127.0.0.1:8765 is still a finding', () => {
    expect(
      isIgnoredConsoleError({
        source: 'console',
        text: 'Failed to load resource: the server responded with a status of 409 (Conflict)',
        locationUrl: 'http://127.0.0.1:8765/projects/p1/geology/models/m1',
      }),
    ).toBe(false)
  })

  it('a net:: failure on the app origin (backend port) is still a finding', () => {
    expect(
      isIgnoredConsoleError({
        source: 'console',
        text: 'Failed to load resource: net::ERR_CONNECTION_REFUSED',
        locationUrl: 'http://localhost:8765/health',
      }),
    ).toBe(false)
  })

  it('an app console error from the file:// renderer bundle is still a finding', () => {
    expect(
      isIgnoredConsoleError({
        source: 'console',
        text: 'Failed to load resource: net::ERR_FILE_NOT_FOUND',
        locationUrl: 'file:///C:/app/out/renderer/assets/index.js',
      }),
    ).toBe(false)
  })

  it('an external non-resource error (app code logging) is still a finding', () => {
    expect(
      isIgnoredConsoleError({
        source: 'console',
        text: 'TypeError: x is undefined',
        locationUrl: 'https://tile.openstreetmap.org/x.js',
      }),
    ).toBe(false)
  })

  it('a pageerror is always a finding', () => {
    expect(
      isIgnoredConsoleError({
        source: 'pageerror',
        text: 'Failed to load resource: net::ERR_CONNECTION_RESET',
        locationUrl: 'https://geo.api.vlaanderen.be/tile',
      }),
    ).toBe(false)
  })
})

describe('walker invariant -- no row on screen the server does not have', () => {
  it('a phantom row is a finding, not an abort', () => {
    // A "ghost" contact is drawn on the canvas but no model has it. The checker
    // must REPORT it (return a finding), not throw and abort the walk.
    let findings
    expect(() => {
      findings = checkPhantomRows('contact', ['a', 'b', 'ghost'], ['a', 'b'], 5)
    }).not.toThrow()
    expect(findings).toHaveLength(1)
    expect(findings![0].step).toBe(5)
    expect(findings![0].detail).toContain('ghost')
  })

  it('every DOM row backed by the server yields no finding', () => {
    expect(checkPhantomRows('contact', ['a', 'b'], ['a', 'b', 'c'], 9)).toEqual([])
  })

  it('a phantom id repeated in the DOM is reported once', () => {
    expect(checkPhantomRows('contact', ['ghost', 'ghost'], [], 3)).toHaveLength(1)
  })
})

describe('walker invariant -- no console error / no uncaught page error', () => {
  it('each new console error line is a finding', () => {
    const out = checkConsoleErrors(['TypeError: x is undefined', 'Warning: y'], 4)
    expect(out).toHaveLength(2)
    expect(out[0].invariant).toBe('console-error')
  })

  it('no new console lines yields no finding', () => {
    expect(checkConsoleErrors([], 4)).toEqual([])
  })
})

describe('walker invariant -- no refused request for an action the UI offered', () => {
  it('a 500 and a 422 are findings', () => {
    const out = checkRefusedRequests(
      [
        { method: 'POST', url: '/x', status: 500 },
        { method: 'POST', url: '/y', status: 422 },
      ],
      7,
    )
    expect(out).toHaveLength(2)
  })

  it('a 409 answered by a dialog is fine, not a finding', () => {
    expect(
      checkRefusedRequests([{ method: 'POST', url: '/cpt/import', status: 409 }], 7),
    ).toEqual([])
  })
})

describe('walker invariant -- no empty view where the model still has data', () => {
  it('server has rows but the view rendered zero is a finding', () => {
    expect(checkEmptyView('contacts', 0, 12, true, 2)).toHaveLength(1)
  })

  it('an empty view is fine when the server also has nothing', () => {
    expect(checkEmptyView('contacts', 0, 0, true, 2)).toEqual([])
  })

  it('an empty view is fine when the stage is not meant to render rows', () => {
    expect(checkEmptyView('contacts', 0, 12, false, 2)).toEqual([])
  })
})

describe('walker invariant -- the app stays responsive', () => {
  it('a heartbeat over the budget is a finding', () => {
    expect(checkResponsiveness(RESPONSIVENESS_BUDGET_MS + 1, 1)).toHaveLength(1)
  })

  it('a heartbeat that never answered is a finding', () => {
    expect(checkResponsiveness(-1, 1)).toHaveLength(1)
  })

  it('a prompt heartbeat yields no finding', () => {
    expect(checkResponsiveness(120, 1)).toEqual([])
  })
})

describe('walker invariant -- no lingering process after close', () => {
  it('surviving pids are a finding naming them', () => {
    const out = checkSurvivors([111, 222], 300)
    expect(out).toHaveLength(1)
    expect(out[0].detail).toContain('111')
  })

  it('no survivors yields no finding', () => {
    expect(checkSurvivors([], 300)).toEqual([])
  })
})

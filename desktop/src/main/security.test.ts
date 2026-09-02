// Unit tests for the pure security helpers (debt #36/#37).
//
// These helpers run in the Electron main process but have no Electron
// dependency, so vitest can exercise them in jsdom just like the
// renderer-side helpers.

import { describe, expect, it } from 'vitest'

import {
  buildContentSecurityPolicy,
  decideExternalOpen,
  isInAppNavigation,
  isValidRecentProjectEntry,
  normalizePathForCompare,
  rawBackendLogAffordanceEnabled,
} from './security'

describe('buildContentSecurityPolicy', () => {
  it('production CSP allows wasm-unsafe-eval (Cesium WASM) but forbids general unsafe-eval + unsafe-inline on script-src', () => {
    const csp = buildContentSecurityPolicy(false)
    expect(csp).toContain("script-src 'self'")
    const scriptDirective = csp
      .split(';')
      .map(d => d.trim())
      .find(d => d.startsWith('script-src'))
    expect(scriptDirective).toBeDefined()
    // Tokenize so a substring of ``'wasm-unsafe-eval'`` can't be confused with
    // the standalone ``'unsafe-eval'`` token.
    const tokens = scriptDirective!.replace('script-src', '').trim().split(/\s+/)
    // CesiumJS needs WASM compilation — ``'wasm-unsafe-eval'`` permits ONLY that.
    expect(tokens).toContain("'wasm-unsafe-eval'")
    // The dangerous general-eval token must NOT be present in production.
    expect(tokens).not.toContain("'unsafe-eval'")
    // ``script-src`` in production must NOT include ``'unsafe-inline'``.
    // style-src can carry it (Tailwind/Leaflet limitation), script-src never.
    expect(tokens).not.toContain("'unsafe-inline'")
  })

  it('dev CSP relaxes script-src for Vite HMR fast-refresh', () => {
    const csp = buildContentSecurityPolicy(true)
    expect(csp).toContain("'unsafe-eval'")
    expect(csp).toContain("'unsafe-inline'")
    // And adds the Vite HMR websocket origin to connect-src.
    expect(csp).toContain('ws://localhost:*')
  })

  it('connect-src whitelists the local API + DOV + DEM + OSM tiles', () => {
    const csp = buildContentSecurityPolicy(false)
    expect(csp).toContain('http://127.0.0.1:8765')
    expect(csp).toContain('https://www.dov.vlaanderen.be')
    expect(csp).toContain('https://geo.api.vlaanderen.be')
    expect(csp).toContain('https://*.tile.openstreetmap.org')
  })

  it('default-src is locked to self', () => {
    expect(buildContentSecurityPolicy(false)).toContain("default-src 'self'")
  })

  it('iframe + object embedding is denied', () => {
    const csp = buildContentSecurityPolicy(false)
    expect(csp).toContain("frame-src 'none'")
    expect(csp).toContain("object-src 'none'")
  })

  it('base-uri + form-action are pinned to self (UA hardening)', () => {
    const csp = buildContentSecurityPolicy(false)
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("form-action 'self'")
  })
})

describe('decideExternalOpen', () => {
  it('allows http + https URLs through to the OS browser', () => {
    expect(decideExternalOpen('http://example.com').external).toBe(true)
    expect(decideExternalOpen('https://example.com').external).toBe(true)
    expect(decideExternalOpen('https://www.dov.vlaanderen.be/x').external).toBe(true)
  })

  it('allows mailto URLs', () => {
    expect(decideExternalOpen('mailto:hello@example.com').external).toBe(true)
  })

  it('rejects javascript: URLs (would execute code)', () => {
    expect(decideExternalOpen('javascript:alert(1)').external).toBe(false)
    expect(decideExternalOpen('JAVASCRIPT:alert(1)').external).toBe(false)
  })

  it('rejects file: URLs (would launch a local handler)', () => {
    expect(decideExternalOpen('file:///etc/passwd').external).toBe(false)
  })

  it('rejects data: URLs (could carry inline HTML/JS)', () => {
    expect(decideExternalOpen('data:text/html,<script>alert(1)</script>').external).toBe(
      false,
    )
  })

  it('rejects empty / malformed URLs', () => {
    expect(decideExternalOpen('').external).toBe(false)
    expect(decideExternalOpen('not-a-url').external).toBe(false)
  })
})

describe('normalizePathForCompare', () => {
  const isWin = process.platform === 'win32'

  it('returns null for non-strings + empty strings', () => {
    expect(normalizePathForCompare('')).toBe(null)
    expect(normalizePathForCompare(undefined)).toBe(null)
    expect(normalizePathForCompare(null)).toBe(null)
    expect(normalizePathForCompare(42)).toBe(null)
  })

  it('collapses .. segments so traversal-style strings are normalized', () => {
    // The set membership check must treat "/authorised/../evil" the
    // same as "/evil" so a renderer can't smuggle in an authorised-
    // looking string that resolves outside the allowed set.
    if (isWin) {
      const a = normalizePathForCompare('C:\\authorised\\..\\evil')
      const b = normalizePathForCompare('C:\\evil')
      expect(a).toBe(b)
    } else {
      const a = normalizePathForCompare('/authorised/../evil')
      const b = normalizePathForCompare('/evil')
      expect(a).toBe(b)
    }
  })

  it('is case-insensitive on win32 (NTFS default)', () => {
    if (!isWin) return
    const a = normalizePathForCompare('C:\\Users\\Project.strix')
    const b = normalizePathForCompare('c:\\users\\project.strix')
    expect(a).toBe(b)
  })

  it('strips trailing separators so "dir" and "dir/" match', () => {
    if (isWin) {
      expect(normalizePathForCompare('C:\\dir\\')).toBe(
        normalizePathForCompare('C:\\dir'),
      )
    } else {
      expect(normalizePathForCompare('/dir/')).toBe(
        normalizePathForCompare('/dir'),
      )
    }
  })

  it('two different paths normalize to different values', () => {
    if (isWin) {
      expect(normalizePathForCompare('C:\\a')).not.toBe(
        normalizePathForCompare('C:\\b'),
      )
    } else {
      expect(normalizePathForCompare('/a')).not.toBe(
        normalizePathForCompare('/b'),
      )
    }
  })
})

describe('isValidRecentProjectEntry (debt #41)', () => {
  it('accepts a well-formed entry within length caps', () => {
    expect(
      isValidRecentProjectEntry({
        path: 'C:\\Users\\Project.strix',
        name: 'My Project',
        lastOpened: '2026-05-13T10:00:00Z',
      }),
    ).toBe(true)
  })

  it('rejects non-objects + null', () => {
    expect(isValidRecentProjectEntry(null)).toBe(false)
    expect(isValidRecentProjectEntry(undefined)).toBe(false)
    expect(isValidRecentProjectEntry('a-string')).toBe(false)
    expect(isValidRecentProjectEntry(42)).toBe(false)
  })

  it('rejects missing fields', () => {
    expect(isValidRecentProjectEntry({})).toBe(false)
    expect(isValidRecentProjectEntry({ path: 'x' })).toBe(false)
    expect(
      isValidRecentProjectEntry({ path: 'x', name: 'y' }),
    ).toBe(false)
  })

  it('rejects empty path', () => {
    expect(
      isValidRecentProjectEntry({
        path: '',
        name: 'My Project',
        lastOpened: '2026-05-13T10:00:00Z',
      }),
    ).toBe(false)
  })

  it('rejects pathological name length (DoS class)', () => {
    expect(
      isValidRecentProjectEntry({
        path: 'C:\\x.strix',
        name: 'x'.repeat(10_000),
        lastOpened: '2026-05-13T10:00:00Z',
      }),
    ).toBe(false)
  })

  it('rejects pathological path length', () => {
    expect(
      isValidRecentProjectEntry({
        path: 'C:\\' + 'x'.repeat(10_000),
        name: 'My Project',
        lastOpened: '2026-05-13T10:00:00Z',
      }),
    ).toBe(false)
  })
})

describe('isInAppNavigation', () => {
  const RENDERER_DIR = 'file:///C:/app/resources/renderer/'

  it('allows navigation within the dev renderer URL', () => {
    expect(
      isInAppNavigation('http://localhost:5173/some-page', 'http://localhost:5173', null),
    ).toBe(true)
  })

  it('allows file:// navigation under the packaged renderer directory', () => {
    expect(
      isInAppNavigation(`${RENDERER_DIR}index.html`, null, RENDERER_DIR),
    ).toBe(true)
    expect(
      isInAppNavigation(`${RENDERER_DIR}index.html#/sections`, null, RENDERER_DIR),
    ).toBe(true)
  })

  it('rejects file:// navigation outside the renderer directory (audit #15)', () => {
    expect(isInAppNavigation('file:///C:/Windows/System32/x.html', null, RENDERER_DIR)).toBe(
      false,
    )
    expect(isInAppNavigation('file:///etc/passwd', null, RENDERER_DIR)).toBe(false)
  })

  it('rejects file:// with dotdot traversal out of the renderer directory', () => {
    expect(
      isInAppNavigation(
        'file:///C:/app/resources/renderer/../../../Windows/System32/x.html',
        null,
        RENDERER_DIR,
      ),
    ).toBe(false)
  })

  it('rejects all file:// when no renderer file base is set (dev)', () => {
    expect(isInAppNavigation('file:///C:/anything.html', 'http://localhost:5173', null)).toBe(
      false,
    )
  })

  it('rejects external http(s) navigation to a foreign host', () => {
    expect(isInAppNavigation('https://evil.com', null, RENDERER_DIR)).toBe(false)
    expect(isInAppNavigation('https://evil.com', 'http://localhost:5173', null)).toBe(false)
    // A plain http:// foreign host is denied the same way — only the dev
    // origin prefix or the packaged renderer-directory prefix is in-app.
    expect(isInAppNavigation('http://evil.com', null, RENDERER_DIR)).toBe(false)
    expect(isInAppNavigation('http://evil.com/', 'http://localhost:5173', null)).toBe(false)
  })

  it('rejects javascript: navigation', () => {
    expect(isInAppNavigation('javascript:alert(1)', null, RENDERER_DIR)).toBe(false)
  })
})

describe('rawBackendLogAffordanceEnabled (user-data leak — the raw backend.log is not redacted)', () => {
  it('a packaged build never hands the user the raw, unredacted backend.log', () => {
    // ``backend.log`` carries the asyncpg DSN (password) and raw project
    // paths — the very things the diagnostics bundle is built to strip. A
    // shipped build must route the user to the redacted "Save diagnostics
    // bundle…" instead of opening the raw log directory.
    expect(rawBackendLogAffordanceEnabled(true)).toBe(false)
  })

  it('a development build keeps the raw-log shortcut for the developer', () => {
    // Same reasoning as the dev-only Reload / DevTools gating: dev runs on
    // the developer's own machine, so the raw log is a convenience, not a
    // third-party leak.
    expect(rawBackendLogAffordanceEnabled(false)).toBe(true)
  })
})

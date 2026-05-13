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
  normalizePathForCompare,
} from './security'

describe('buildContentSecurityPolicy', () => {
  it('production CSP forbids unsafe-eval + unsafe-inline on script-src', () => {
    const csp = buildContentSecurityPolicy(false)
    expect(csp).toContain("script-src 'self'")
    expect(csp).not.toContain("'unsafe-eval'")
    // ``script-src 'self'`` in production must NOT include
    // ``'unsafe-inline'``. style-src can carry it (Tailwind/Leaflet
    // limitation), script-src never.
    const scriptDirective = csp
      .split(';')
      .map(d => d.trim())
      .find(d => d.startsWith('script-src'))
    expect(scriptDirective).toBeDefined()
    expect(scriptDirective).not.toContain("'unsafe-inline'")
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

describe('isInAppNavigation', () => {
  it('allows navigation within the dev renderer URL', () => {
    expect(isInAppNavigation('http://localhost:5173/some-page', 'http://localhost:5173')).toBe(
      true,
    )
  })

  it('allows file:// navigation (production loadFile)', () => {
    expect(isInAppNavigation('file:///C:/.../index.html', null)).toBe(true)
  })

  it('rejects external https navigation', () => {
    expect(isInAppNavigation('https://evil.com', null)).toBe(false)
    expect(
      isInAppNavigation('https://evil.com', 'http://localhost:5173'),
    ).toBe(false)
  })

  it('rejects javascript: navigation', () => {
    expect(isInAppNavigation('javascript:alert(1)', null)).toBe(false)
  })
})

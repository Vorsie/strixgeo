import '@testing-library/jest-dom/vitest'

// jsdom doesn't ship with ``ResizeObserver``. Recharts'
// ``ResponsiveContainer`` (used by every chart we render in detail
// panels) calls ``new ResizeObserver(...)`` on mount, which throws
// ``ReferenceError`` in tests. A no-op stub is enough — we don't
// assert on chart layout in unit tests, only that the surrounding
// panel renders.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  // Cast to a mutable shape via unknown — the TS lib types globalThis
  // as the const-shaped global object, so a direct cast is rejected.
  ;(globalThis as unknown as { ResizeObserver: typeof NoopResizeObserver }).ResizeObserver =
    NoopResizeObserver
}

// jsdom doesn't implement ``Element.scrollTo``. ``BoreholeLog``'s
// auto-scroll effect calls it after a sample is selected to centre
// the row in the viewport. No-op is fine for tests — we don't
// assert on scroll position.
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollTo !== 'function') {
  Element.prototype.scrollTo = function () {}
}

// jsdom doesn't implement ``window.matchMedia``. ``useTheme`` calls
// it to read the OS-level ``prefers-color-scheme`` value on mount.
// A stub returning ``matches: false`` (i.e. "system light") is
// enough — we don't test theme-resolution paths in unit tests, only
// that surrounding components render. ``addListener``/
// ``removeListener`` plus their modern ``addEventListener``/
// ``removeEventListener`` aliases are stubbed so the resize-aware
// listener wiring inside the hook doesn't throw.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  })
}

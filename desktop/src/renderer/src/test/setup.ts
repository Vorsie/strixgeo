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
  // @ts-expect-error — assigning to a known-missing global is the point
  globalThis.ResizeObserver = NoopResizeObserver
}

// jsdom doesn't implement ``Element.scrollTo``. ``BoreholeLog``'s
// auto-scroll effect calls it after a sample is selected to centre
// the row in the viewport. No-op is fine for tests — we don't
// assert on scroll position.
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollTo !== 'function') {
  Element.prototype.scrollTo = function () {}
}

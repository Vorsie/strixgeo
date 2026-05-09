/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  // ``darkMode: 'class'`` lets ``useTheme`` toggle a ``dark`` class on
  // <html> programmatically. The default ``media`` strategy would mean
  // tracking the OS preference exclusively with no user override; we
  // want both — the hook reads ``prefers-color-scheme`` on first load
  // and lets the user override via a (future) theme toggle, persisted
  // to localStorage. See ``hooks/useTheme.ts`` + UX Conventions
  // section in Strix/CLAUDE.md.
  darkMode: 'class',
  theme: { extend: {} },
  plugins: []
}

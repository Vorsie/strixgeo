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
  theme: {
    extend: {
      // Semantic colour tokens for the workflow-spine shell
      // (docs/ui-shell-architecture.md §6). Each maps to a CSS custom
      // property defined in ``index.css``; light values live under
      // ``:root`` and the dark *hero* palette under ``.dark``. New
      // shell chrome authors ONLY against these names (e.g.
      // ``bg-surface-app``) so a light/dark flip changes one token, not
      // every utility class in every component. Existing components keep
      // their raw ``slate-*`` / ``dark:`` variants until migrated
      // opportunistically (tracked as a separate low debt item).
      //
      // ``extend`` MERGES into Tailwind's default palette — the stock
      // ``slate-*`` / ``blue-*`` scales stay intact, so this addition is
      // non-breaking for every component already in the tree.
      // Stage cross-fade animation (§6.5). The ``animate-[fadeIn_150ms_ease-out]``
      // arbitrary value in StageCanvas.tsx references this keyframe by name.
      // Without registering it here the arbitrary class has no matching
      // ``@keyframes`` declaration and the cross-fade is silently dead.
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      animation: {
        // Named animation shorthand so ``animate-fadeIn`` works as an
        // alternative to the arbitrary ``animate-[fadeIn_150ms_ease-out]``
        // form. Both work; the arbitrary form is used in StageCanvas.tsx
        // because it is already there and is more explicit about duration.
        fadeIn: 'fadeIn 150ms ease-out',
      },
      colors: {
        // Surface hierarchy — Primer's layered-surface model.
        'surface-app': 'var(--color-surface-app)',
        'surface-page': 'var(--color-surface-page)',
        'surface-card': 'var(--color-surface-card)',
        'surface-overlay': 'var(--color-surface-overlay)',

        // Borders.
        'border-subtle': 'var(--color-border-subtle)',
        'border-default': 'var(--color-border-default)',

        // Text.
        'text-primary': 'var(--color-text-primary)',
        'text-secondary': 'var(--color-text-secondary)',
        'text-muted': 'var(--color-text-muted)',
        'text-on-accent': 'var(--color-text-on-accent)',

        // Accent — Primer maps to blue-600 (light) / blue-400 (dark).
        accent: 'var(--color-accent)',
        'accent-muted': 'var(--color-accent-muted)',

        // Status — amber for dirty/stale (never red — project rule),
        // red reserved for destructive intent.
        'status-amber': 'var(--color-status-amber)',
        'status-danger': 'var(--color-status-danger)',

        // Stage spine — slightly distinct surface so the process rail
        // reads as chrome separate from the canvas.
        'spine-bg': 'var(--color-spine-bg)',
        'spine-active': 'var(--color-spine-active)',
        'spine-hover': 'var(--color-spine-hover)',
      },
    },
  },
  plugins: [],
}

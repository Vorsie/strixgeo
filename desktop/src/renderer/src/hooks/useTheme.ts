import { useCallback, useEffect, useState } from 'react'

// Theme strategy (see UX Conventions in Strix/CLAUDE.md):
//
//   - ``system`` (default) — follow the OS ``prefers-color-scheme`` and
//     respond live to changes. No localStorage entry.
//   - ``light`` / ``dark``  — explicit user override, persisted.
//
// Tailwind's ``darkMode: 'class'`` strategy means the active palette
// flips when the ``dark`` CSS class is present on the <html> element;
// this hook owns that class. Components don't manipulate the class
// themselves — they react to it via ``dark:`` Tailwind variants.

export type ThemeChoice = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'groundmodel.theme'

function readStoredChoice(): ThemeChoice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  } catch {
    // localStorage unavailable (privacy mode, quota); fall through.
  }
  return 'system'
}

function writeStoredChoice(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, choice)
  } catch {
    // ignore — session-level state still works.
  }
}

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function applyResolvedTheme(theme: ResolvedTheme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

/**
 * React hook for the desktop theme. Returns the current ``choice``
 * (system / light / dark), the ``resolved`` theme actually in effect
 * (light / dark — system collapses to whichever the OS reports), and
 * a ``setChoice`` setter that persists to localStorage and applies
 * the class on <html>.
 *
 * On mount the hook reads localStorage and the OS preference, applies
 * the right class, and (when in ``system`` mode) starts listening for
 * OS preference changes so dark/light updates flow through live.
 */
export function useTheme(): {
  choice: ThemeChoice
  resolved: ResolvedTheme
  setChoice: (next: ThemeChoice) => void
} {
  const [choice, setChoiceState] = useState<ThemeChoice>(() => readStoredChoice())
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    resolveTheme(readStoredChoice()),
  )

  // Apply the class on every change, AND react to OS preference changes
  // when we're in system mode so a dark-mode toggle outside the app
  // (e.g. macOS Night Shift, Windows theme switch) propagates instantly.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    function refresh(): void {
      const r = resolveTheme(choice)
      setResolved(r)
      applyResolvedTheme(r)
    }
    refresh()
    if (choice === 'system') {
      mq.addEventListener('change', refresh)
      return () => mq.removeEventListener('change', refresh)
    }
    return undefined
  }, [choice])

  const setChoice = useCallback((next: ThemeChoice) => {
    writeStoredChoice(next)
    setChoiceState(next)
  }, [])

  return { choice, resolved, setChoice }
}

function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice === 'light') return 'light'
  if (choice === 'dark') return 'dark'
  return systemPrefersDark() ? 'dark' : 'light'
}

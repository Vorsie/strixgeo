// Language selector — the ONE place the interface language is read and written.
//
// Scope: DEVICE-local, not project-scoped. The interface language follows the
// person, not the file, so it belongs in localStorage and never in the .gmproj
// bundle (CLAUDE.md §Project files: the bundle carries engineering decisions,
// localStorage carries per-user UI chrome; docs/ux.md §Translation & persistence
// names the global ``groundmodel.<kind>`` key shape this uses).
//
// Shape: a module-level subscriber set + ``useSyncExternalStore``, deliberately
// mirroring ``utils/partitionEngineSelect.ts`` rather than introducing a React
// context. Three reasons:
//
//   1. No provider means no edit to ``App.tsx`` — a component starts reading the
//      language by importing ``useT``, and nothing above it changes.
//   2. Non-React callers (a toast builder, a file-dialog filter list) can call
//      ``translate()`` directly at call time and get the current language,
//      exactly as ``computeSectionFillActive`` reads its flag.
//   3. It is the pattern already in the codebase for a device pref that applies
//      immediately with no Save step — the theme toggle and the engine toggle
//      both behave this way, and the language toggle sits beside them in
//      Settings → Appearance.

import { useSyncExternalStore } from 'react'

import { DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, LANGUAGES, type Language } from './i18n_constants'
import { log } from '../utils/log'

/** Subscribers notified when the language flips. Feeds ``useSyncExternalStore``
 *  so every mounted component re-renders on the same tick as the toggle. */
const subscribers = new Set<() => void>()

/**
 * Narrow an arbitrary value to a supported ``Language``.
 *
 * Parameters
 * ----------
 * raw : unknown
 *     Candidate value — typically a localStorage string.
 *
 * Returns
 * -------
 * Language | null
 *     The language when it is one we ship, otherwise ``null``.
 */
function asLanguage(raw: unknown): Language | null {
  return typeof raw === 'string' && (LANGUAGES as readonly string[]).includes(raw)
    ? (raw as Language)
    : null
}

/**
 * Read the device-local language out of localStorage.
 *
 * Best-effort: a missing key, an unknown value (hand-edited storage, a locale
 * we removed) or an unavailable localStorage (privacy mode, worker context,
 * node without jsdom) all resolve to ``DEFAULT_LANGUAGE``. Never throws — a
 * storage failure must not decide whether the app renders.
 *
 * Returns
 * -------
 * Language
 *     The stored language, or the default.
 */
/**
 * The language the operating system runs in, when it is one we ship.
 *
 * ``navigator.language`` is a BCP-47 tag (``nl-BE``, ``en-GB``); only the
 * primary subtag decides. Returns ``null`` for an unsupported or unknown
 * system language so the caller falls back to the default (owner 2026-09-03:
 * "default to the system language, fall back to English").
 */
export function systemLanguage(): Language | null {
  if (typeof navigator === 'undefined') return null
  const tag = navigator.language
  if (typeof tag !== 'string' || tag === '') return null
  return asLanguage(tag.toLowerCase().split('-')[0])
}

export function getLanguage(): Language {
  if (typeof localStorage === 'undefined') return systemLanguage() ?? DEFAULT_LANGUAGE
  try {
    return (
      asLanguage(localStorage.getItem(LANGUAGE_STORAGE_KEY)) ?? systemLanguage() ?? DEFAULT_LANGUAGE
    )
  } catch {
    return systemLanguage() ?? DEFAULT_LANGUAGE
  }
}

/**
 * Set the device-local interface language and notify subscribers.
 *
 * Reversible UI chrome, so it applies immediately with no Save step (docs/ux.md
 * §Reversible vs irreversible actions) — same contract as the theme toggle.
 *
 * Parameters
 * ----------
 * next : Language
 *     The language to switch to. An unsupported value is ignored and logged, so
 *     a bad call site degrades to "nothing happened" rather than to a blank UI.
 */
export function setLanguage(next: Language): void {
  const safe = asLanguage(next)
  if (safe === null) {
    log.warn('i18n', `ignored unsupported language "${String(next)}" — keeping ${getLanguage()}`)
    return
  }
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, safe)
    } catch {
      // Quota / privacy mode — session-level state still updates via notify().
    }
  }
  log.info('i18n', `interface language set → ${safe}`)
  for (const cb of subscribers) cb()
}

/**
 * Subscribe to language changes. Returns an unsubscribe function.
 * Consumed by ``useSyncExternalStore``; not called directly.
 *
 * Parameters
 * ----------
 * cb : () => void
 *     Invoked (no args) whenever ``setLanguage`` commits a change.
 *
 * Returns
 * -------
 * () => void
 *     Unsubscribe.
 */
function subscribe(cb: () => void): () => void {
  subscribers.add(cb)
  return () => {
    subscribers.delete(cb)
  }
}

/**
 * React hook: the current interface language, re-rendering the component live
 * when the Settings toggle flips it.
 *
 * Returns
 * -------
 * Language
 *     The active language.
 */
export function useLanguage(): Language {
  // getSnapshot and getServerSnapshot are the same reader: the value is derived
  // from localStorage, which is stable within a render pass.
  return useSyncExternalStore(subscribe, getLanguage, getLanguage)
}

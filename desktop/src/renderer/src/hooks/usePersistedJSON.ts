import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

// localStorage-backed React state with project-scoped keying. Generic
// over the value type ``T`` — pass ``parse`` to coerce raw JSON into a
// validated ``T`` (returns the default on bad input), and ``serialize``
// when the type doesn't round-trip through ``JSON.stringify`` natively
// (e.g. Set, Map, custom classes).
//
// Pass ``undefined`` for the key when the relevant scope (project,
// user) isn't ready yet — the hook resets to ``defaultValue`` and
// skips persistence until a real key arrives. After a key change the
// FIRST save is skipped via a ref, because the load effect's queued
// state update hasn't propagated yet and saving stale state would
// clobber the new key's stored value.

export function usePersistedJSON<T>(
  storageKey: string | undefined,
  defaultValue: T,
  parse: (raw: unknown) => T,
  serialize: (value: T) => unknown = identity,
): readonly [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => loadInitial(storageKey, defaultValue, parse))

  const lastKeyRef = useRef(storageKey)

  useEffect(() => {
    if (!storageKey) {
      setValue(defaultValue)
      lastKeyRef.current = undefined
      return
    }
    setValue(loadInitial(storageKey, defaultValue, parse))
    // reason: ``defaultValue`` and ``parse`` are intentionally omitted
    // from the dep array — they should be stable across renders
    // (callers typically inline literals or module-level functions),
    // and re-running on their identity changes would loop forever
    // for inline-object defaults.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  useEffect(() => {
    if (!storageKey) return
    if (lastKeyRef.current !== storageKey) {
      lastKeyRef.current = storageKey
      return
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(serialize(value)))
    } catch {
      // Quota / privacy mode — fail silently; session-level state still works.
    }
  }, [storageKey, value, serialize])

  return [value, setValue] as const
}

function loadInitial<T>(
  key: string | undefined,
  defaultValue: T,
  parse: (raw: unknown) => T,
): T {
  if (!key) return defaultValue
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return defaultValue
    return parse(JSON.parse(raw))
  } catch {
    return defaultValue
  }
}

function identity<T>(value: T): unknown {
  return value
}

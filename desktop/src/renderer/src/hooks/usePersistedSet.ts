import { type Dispatch, type SetStateAction } from 'react'

import { usePersistedJSON } from './usePersistedJSON'

// localStorage-backed Set<string> — thin wrapper around
// ``usePersistedJSON`` that handles the array <-> Set coercion. Sets
// don't round-trip through ``JSON.stringify`` natively (they
// serialise as ``{}``), so we need an explicit serializer pair. The
// underlying load-on-key-change + save-with-ref-skip semantics live
// in ``usePersistedJSON``.

const EMPTY_SET: ReadonlySet<string> = new Set()

const parseStringSet = (raw: unknown): Set<string> => {
  if (!Array.isArray(raw)) return new Set()
  return new Set(raw.filter((v): v is string => typeof v === 'string'))
}

const serializeStringSet = (set: Set<string>): unknown => [...set]

export function usePersistedSet(
  storageKey: string | undefined,
): readonly [Set<string>, Dispatch<SetStateAction<Set<string>>>] {
  // The defaultValue is a fresh Set per call site so two consumers
  // don't share mutation state.
  return usePersistedJSON<Set<string>>(
    storageKey,
    new Set(EMPTY_SET),
    parseStringSet,
    serializeStringSet,
  )
}

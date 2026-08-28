/** One-shot state for the model-check gap marker in a section view. */
import { useCallback, useEffect, useRef, useState } from 'react'

import { FLASH_HIGHLIGHT_MS } from './utils'

export function useSectionGapReveal(): {
  gapFlashInvestigationIds: readonly [string, string] | null
  flashGap: (investigationIds: readonly [string, string]) => void
} {
  const [gapFlashInvestigationIds, setGapFlashInvestigationIds] = useState<
    readonly [string, string] | null
  >(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (flashTimer.current !== null) clearTimeout(flashTimer.current)
    },
    [],
  )

  const flashGap = useCallback((investigationIds: readonly [string, string]) => {
    setGapFlashInvestigationIds(investigationIds)
    if (flashTimer.current !== null) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(
      () => setGapFlashInvestigationIds(null),
      FLASH_HIGHLIGHT_MS,
    )
  }, [])

  return { gapFlashInvestigationIds, flashGap }
}

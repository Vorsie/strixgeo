/**
 * The landing marker for a model-check finding between two investigations.
 *
 * A rendered gap can be narrower than one screen pixel. The marker therefore
 * holds its true centre but stays at least 16 px wide, so "Show me" remains
 * useful for the narrowest reported gaps without pretending either column is
 * the faulty ground.
 */
import type { PlacedColumn } from './utils'

interface Props {
  investigationIds: readonly [string, string] | null
  placedColumns: readonly PlacedColumn[]
  plotTop: number
  plotHeight: number
}

export default function GapRevealFlash({
  investigationIds,
  placedColumns,
  plotTop,
  plotHeight,
}: Props) {
  if (investigationIds === null) return null
  const [firstId, secondId] = investigationIds
  const first = placedColumns.find(c => c.proj.item.id === firstId)
  const second = placedColumns.find(c => c.proj.item.id === secondId)
  if (!first || !second) return null

  const centreX = (first.nudgedX + second.nudgedX) / 2
  const width = Math.max(Math.abs(second.nudgedX - first.nudgedX), 16)
  return (
    <rect
      data-testid="gap-reveal-flash"
      x={centreX - width / 2}
      y={plotTop}
      width={width}
      height={plotHeight}
      fill="rgb(245 158 11 / 0.28)"
      className="animate-pulse"
      pointerEvents="none"
    />
  )
}

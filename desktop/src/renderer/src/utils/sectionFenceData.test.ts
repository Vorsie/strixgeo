// desktop/src/renderer/src/utils/sectionFenceData.test.ts
import { describe, expect, it } from 'vitest'
import { assembleSectionPartitionInput, type FenceLayerInput, type FenceProjectedColumn } from './sectionFenceData'

const projected: FenceProjectedColumn[] = [
  { investigationId: 'A', alongM: 10, surfaceElevM: 12 },
  { investigationId: 'B', alongM: 50, surfaceElevM: 13 },
]
const layers: FenceLayerInput[] = [
  { investigationId: 'A', layerId: 'a1', formationId: 'ZAND', bodyId: 'z', topDepthM: 0, baseDepthM: 2, accepted: true },
  { investigationId: 'A', layerId: 'a2', formationId: 'KLEI', bodyId: null, topDepthM: 2, baseDepthM: 5, accepted: true },
  { investigationId: 'B', layerId: 'b1', formationId: 'ZAND', bodyId: 'z', topDepthM: 0, baseDepthM: 4, accepted: true },
  { investigationId: 'B', layerId: 'bX', formationId: 'KLEI', bodyId: null, topDepthM: 4, baseDepthM: 6, accepted: false }, // dropped
]

describe('assembleSectionPartitionInput', () => {
  it('builds ordered PartitionColumns from accepted layers + projected columns', () => {
    const { columns, orderedColumns } = assembleSectionPartitionInput(projected, layers)
    expect(orderedColumns.map((c) => c.investigationId)).toEqual(['A', 'B']) // sorted by alongM
    expect(orderedColumns[0].alongM).toBe(10)
    expect(columns).toHaveLength(2)
    const colA = columns.find((c) => c.investigationId === 'A')!
    expect(colA.surfaceElevM).toBe(12)
    expect(colA.units.map((u) => u.formationId)).toEqual(['ZAND', 'KLEI']) // sorted shallow→deep
    expect(colA.units[0].layerId).toBe('a1')
  })

  it('drops non-accepted layers and columns with no accepted layers', () => {
    const { columns } = assembleSectionPartitionInput(projected, [layers[3]]) // only B's rejected layer
    expect(columns).toEqual([])
  })

  it('drops a projected column whose surface elevation is null', () => {
    const noElev: FenceProjectedColumn[] = [{ investigationId: 'A', alongM: 10, surfaceElevM: null }]
    const { columns } = assembleSectionPartitionInput(noElev, layers)
    expect(columns).toEqual([])
  })
})

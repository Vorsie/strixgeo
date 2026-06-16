import { describe, it, expect } from 'vitest'
import { renderInMap } from '../test/renderInMap'
import { Pane } from './Pane'

describe('Pane', () => {
  it('creates a named map pane with the given z-index', () => {
    const { map } = renderInMap(<Pane name="testpane" zIndex={450} />)
    const pane = map.getPane('testpane')
    expect(pane).toBeDefined()
    expect(pane!.style.zIndex).toBe('450')
  })
})

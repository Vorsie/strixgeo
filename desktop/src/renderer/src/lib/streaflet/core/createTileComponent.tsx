import type L from 'leaflet'
import { forwardRef, useRef, useState, useEffect } from 'react'
import { useStreafletContext } from './MapContext'
import { useEventHandlers, type EventedProps } from './events'
import { useImperativeInstance } from './lifecycle'

export interface TileFactory<P, I extends L.Layer> {
  createInstance: (props: P, ctx: ReturnType<typeof useStreafletContext>) => I
  updateInstance?: (instance: I, props: P, prev: P) => void
}

/** Tile/raster factory — adds the layer to the map, removes on unmount. */
export function createTileComponent<P extends EventedProps, I extends L.Layer>(
  factory: TileFactory<P, I>,
) {
  return forwardRef<I, P>(function StreafletTile(rawProps, ref) {
    // TypeScript cannot prove PropsWithoutRef<P> === P inside the forwardRef
    // callback due to generic variance; cast is safe because the outer signature
    // already constrains the caller to P.
    const props = rawProps as P
    const ctx = useStreafletContext()
    const prev = useRef<P>(props)
    const [instance] = useState<I>(() => factory.createInstance(props, ctx))

    if (factory.updateInstance && prev.current !== props) {
      factory.updateInstance(instance, props, prev.current)
      prev.current = props
    }

    useEffect(() => {
      instance.addTo(ctx.map)
      return () => {
        instance.remove()
      }
    }, [instance, ctx.map])

    useEventHandlers(instance, props)
    useImperativeInstance(ref, instance)
    return null
  })
}

import { forwardRef, useRef, useState, type ReactNode } from 'react'
import type L from 'leaflet'
import { MapContext, useStreafletContext, type StreafletContextValue } from './MapContext'
import { useEventHandlers, type EventedProps } from './events'
import { useLayerLifecycle, useImperativeInstance } from './lifecycle'

/** A streaflet layer component is built from these two functions. */
export interface LayerFactory<P, I extends L.Layer> {
  /** Construct the Leaflet instance from initial props + context. */
  createInstance: (props: P, ctx: StreafletContextValue) => I
  /** Apply changed props to an existing instance (mutate in place, never recreate). */
  updateInstance?: (instance: I, props: P, prevProps: P) => void
}

/**
 * Build a React component for a Leaflet layer. Handles: create-once, add to the
 * nearest container, mutate-in-place on prop change, event binding, ref
 * forwarding, and removal on unmount. `children` (if any) render under a context
 * whose layerContainer is THIS instance when it is a group, else the inherited one.
 */
export function createLayerComponent<P extends EventedProps, I extends L.Layer>(
  factory: LayerFactory<P, I>,
) {
  return forwardRef<I, P & { children?: ReactNode }>(function StreafletLayer(rawProps, ref) {
    // TypeScript cannot prove PropsWithoutRef<P & {children?}> === P inside
    // the forwardRef callback due to generic variance; cast is safe because the
    // outer signature already constrains the caller to P & {children?}.
    const props = rawProps as unknown as P & { children?: ReactNode }
    const ctx = useStreafletContext()
    const prevProps = useRef<P>(props)
    // Create the instance exactly once (StrictMode-safe via lazy init).
    const [instance] = useState<I>(() => factory.createInstance(props, ctx))

    if (factory.updateInstance && prevProps.current !== props) {
      factory.updateInstance(instance, props, prevProps.current)
      prevProps.current = props
    }

    useLayerLifecycle(instance, ctx.layerContainer)
    useEventHandlers(instance, props)
    useImperativeInstance(ref, instance)

    const childCtx: StreafletContextValue =
      'addLayer' in instance
        ? { map: ctx.map, layerContainer: instance as unknown as L.LayerGroup }
        : ctx
    return <MapContext.Provider value={childCtx}>{props.children}</MapContext.Provider>
  })
}

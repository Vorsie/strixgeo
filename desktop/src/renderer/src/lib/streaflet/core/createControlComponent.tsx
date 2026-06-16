import { forwardRef, useRef, useState, useEffect } from 'react'
import type L from 'leaflet'
import { useStreafletContext } from './MapContext'
import { useImperativeInstance } from './lifecycle'

export interface ControlProps {
  position?: L.ControlPosition
}

export interface ControlFactory<P extends ControlProps, I extends L.Control> {
  createInstance: (props: P) => I
  updateInstance?: (instance: I, props: P, prev: P) => void
}

/** Control factory — addControl on mount, removeControl on unmount, setPosition on change. */
export function createControlComponent<P extends ControlProps, I extends L.Control>(
  factory: ControlFactory<P, I>,
) {
  return forwardRef<I, P>(function StreafletControl(rawProps, ref) {
    // TypeScript cannot prove PropsWithoutRef<P> === P inside the forwardRef
    // callback due to generic variance; cast is safe because the outer signature
    // already constrains the caller to P.
    const props = rawProps as P
    const ctx = useStreafletContext()
    const prev = useRef<P>(props)
    const [instance] = useState<I>(() => factory.createInstance(props))

    if (props.position && props.position !== prev.current.position) {
      instance.setPosition(props.position)
    }
    factory.updateInstance?.(instance, props, prev.current)
    prev.current = props

    useEffect(() => {
      ctx.map.addControl(instance)
      return () => {
        ctx.map.removeControl(instance)
      }
    }, [instance, ctx.map])

    useImperativeInstance(ref, instance)
    return null
  })
}

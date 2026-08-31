/**
 * usePartitionGhostHandles — the DEFERRED, TOPOLOGY-STABLE ghost-handle probe (SESSION 78).
 *
 * ── The bug this replaces (S77, §83) ────────────────────────────────────────
 * The S77 ghost-handle suppression ran ``detectDeadHandleBodies`` inside a plain
 * ``useMemo`` on the RENDER path. That probe re-partitions the section ONCE PER
 * shapeable region (CS1: 69 regions × ~38 ms ≈ 2.6 s), and its memo depended on
 * ``partitionTopology`` — which re-derives from ``screenByInv`` (pan/zoom changes
 * each column's ``nudgedX``). So a pan/zoom rebuilt the topology object → the 2.6 s
 * probe re-ran on the main thread EVERY viewport change → the app rubberbanded
 * (``[Violation] 'message' handler took 5024 ms`` repeating). Two faults: the probe
 * blocks paint, and it re-runs when nothing that AFFECTS it changed.
 *
 * ── The two fixes here ───────────────────────────────────────────────────────
 * 1. CONTENT KEY (not object identity). The probe's answer depends ONLY on the
 *    drag/pan-INDEPENDENT topology: the column unit stacks, the approved edges, the
 *    along-metres, and the active engine. ``topologyKey`` serialises exactly those
 *    VALUES, so a pan/zoom (which changes only screen x, never a unit / edge / along
 *    value) yields the SAME key → the cached DEAD set is reused, no recompute. The
 *    probe re-runs ONLY on a real model / section / correlation change.
 * 2. OFF THE PAINT PATH + CHUNKED. When the key changes the DEAD set resets to empty
 *    (every handle renders — better a live handle for one beat than a 2.6 s freeze)
 *    and the probe walks the shapeable regions a FEW per idle callback, accumulating
 *    into state. No single frame is held; pan stays smooth while it resolves. The
 *    FINAL set is byte-identical to the synchronous S77 oracle (same per-region
 *    single-body probe, just spread over time — each region's verdict is independent,
 *    so chunk order cannot change the result).
 *
 * The probe itself (``detectDeadHandleBodies``) is UNCHANGED and still the load-
 * bearing oracle the all-sections gate pins; this module only governs WHEN and HOW
 * OFTEN it runs. No React render logic beyond the hook; a pure key builder + a
 * chunked scheduler.
 */
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  type CorrelationEdge,
  type PartitionColumn,
  type SectionRegion,
} from '../../utils/sectionPartition'
import { isApexShapeable } from './partitionFillOverlayHelpers'
import { type ComputePartition, detectDeadHandleBodies } from './partitionGhostHandles'

/** Regions probed per idle slice when the browser gives us NO deadline (the
 *  setTimeout fallback). With a real ``IdleDeadline`` the slice is sized by the budget
 *  instead — see ``PROBE_BUDGET_FLOOR_MS``. */
const PROBE_CHUNK = 2

/** Stop taking on another probe once the idle budget is down to this, in ms.
 *
 *  A fixed slice of 2 ignored the deadline entirely: one probe is ~18 ms on the owner's
 *  CS1 and ~47 ms on CS2, so a slice ran 36-96 ms inside a budget that is never more
 *  than 50 ms — five to ten dropped frames, about 35 times over. Sizing the slice by
 *  what is actually left means a cheap section gets many probes per slice and an
 *  expensive one gets a single probe, which is the most it can afford. */
const PROBE_BUDGET_FLOOR_MS = 4

/**
 * A stable string key over the drag/pan-INDEPENDENT partition inputs.
 *
 * Serialises every VALUE the ghost probe reads — each column's investigation id +
 * surface elevation + unit stack (layer id / formation / body / top / base), the
 * approved edges (id pair + sides), and the along-metres. Two
 * renders with the same geological topology but different pan/zoom (only screen x
 * changed) produce the SAME key, so the probe's cached result is reused.
 *
 * @param columns Ordered partition columns.
 * @param edges   Approved correlation edges.
 * @param alongM  True along-section metres per column.
 * @returns       A content key stable under pan/zoom, distinct on any topology change.
 */
export function topologyKey(
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[],
  alongM: readonly number[] | undefined,
): string {
  if (columns.length < 2) return ''
  const cols = columns
    .map(
      (c) =>
        `${c.investigationId}:${c.surfaceElevM.toFixed(4)}[` +
        c.units
          .map(
            (u) =>
              `${u.layerId}|${u.formationId}|${u.bodyId ?? ''}|${u.topDepthM.toFixed(4)}|${u.baseDepthM.toFixed(4)}`,
          )
          .join(',') +
        ']',
    )
    .join(';')
  const eg = edges.map((e) => `${e.a}|${e.b}|${e.aSide ?? 'top'}|${e.bSide ?? 'top'}`).join(';')
  const am = (alongM ?? []).map((a) => a.toFixed(4)).join(',')
  return `v2|${cols}|E:${eg}|A:${am}`
}

/** What the probe needs from an ``IdleDeadline`` — how much of this idle period is left. */
type IdleBudget = { timeRemaining: () => number }

/** requestIdleCallback with a setTimeout fallback (Electron renderer has rIC, but be safe).
 *
 * The deadline is handed to the callback so a slice can size itself to the budget
 * rather than to a fixed count. The fallback has no deadline and passes ``undefined``,
 * which keeps the old fixed-slice behaviour there. */
function scheduleIdle(fn: (deadline?: IdleBudget) => void): () => void {
  const g = globalThis as unknown as {
    requestIdleCallback?: (cb: (deadline: IdleBudget) => void) => number
    cancelIdleCallback?: (h: number) => void
  }
  if (typeof g.requestIdleCallback === 'function') {
    const h = g.requestIdleCallback(fn)
    return () => g.cancelIdleCallback?.(h)
  }
  const t = setTimeout(() => fn(undefined), 0)
  return () => clearTimeout(t)
}

/**
 * The DEAD (ghost) ``gapIndex:bodyId`` set for the current topology, computed off the
 * paint path and cached per ``topologyKey``.
 *
 * Returns an EMPTY set until the deferred probe resolves for the current key (so
 * every shapeable handle renders for the first beat, then the ghosts drop as the
 * probe finishes — never a 2.6 s render freeze). A pan/zoom keeps the key → the
 * resolved set is returned immediately with no recompute.
 *
 * @param base    The no-override active-engine partition (the regions handles render for).
 * @param columns Ordered partition columns.
 * @param edges   Approved correlation edges.
 * @param alongM  True along-section metres per column.
 * @param compute The active partition engine (injected; ``computeSectionFillActive``).
 * @param enabled Whether the probe may run at all (off on a view-only axis → always empty).
 * @returns       The resolved DEAD set (empty while a fresh topology's probe is in flight).
 */
export function usePartitionGhostHandles(
  base: readonly SectionRegion[],
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[],
  alongM: readonly number[] | undefined,
  compute: ComputePartition,
  enabled: boolean,
): Set<string> {
  const key = enabled ? topologyKey(columns, edges, alongM) : ''
  const [resolved, setResolved] = useState<{ key: string; dead: Set<string> }>({
    key: '',
    dead: new Set(),
  })

  // Latest inputs in a ref so the idle callback reads current values without
  // widening the effect's dep set (the KEY is the single source of "must re-run").
  const inputs = useRef({ base, columns, edges, alongM, compute })
  inputs.current = { base, columns, edges, alongM, compute }

  useEffect(() => {
    if (key === '') {
      // v1 / < 2 cols: no probe, no suppression.
      setResolved((prev) => (prev.key === '' && prev.dead.size === 0 ? prev : { key: '', dead: new Set() }))
      return
    }
    const { base: b, columns: c, edges: e, alongM: a, compute: f } = inputs.current
    if (b.length === 0) {
      setResolved({ key, dead: new Set() })
      return
    }
    // The exact set of handles the overlay renders (S77 oracle input) — probe only these.
    const shapeable = b.filter((r): r is SectionRegion & { bodyId: string } => !!r.bodyId && isApexShapeable(r))
    if (shapeable.length === 0) {
      setResolved({ key, dead: new Set() })
      return
    }

    let i = 0
    const dead = new Set<string>()
    let cancel: (() => void) | null = null
    let cancelled = false

    const step = (deadline?: IdleBudget): void => {
      if (cancelled) return
      // One probe at a time, continuing while the idle period can still afford another.
      // Always at least one, so a starved frame still makes progress instead of
      // rescheduling forever. Without a deadline (the setTimeout fallback) fall back to
      // the old fixed slice.
      let taken = 0
      do {
        const end = Math.min(i + 1, shapeable.length)
        // ``detectDeadHandleBodies`` compares against the FULL ``base`` footprint while
        // probing only this slice (``regionsToProbe``) — the S77 contract that keeps a
        // multi-region body from false-flagging. Independent per region, so accumulating
        // across chunks yields the identical set to the synchronous oracle.
        const slice = detectDeadHandleBodies(b, c, e, a, f, shapeable.slice(i, end))
        for (const k of slice) dead.add(k)
        i = end
        taken += 1
      } while (
        i < shapeable.length &&
        (deadline ? deadline.timeRemaining() > PROBE_BUDGET_FLOOR_MS : taken < PROBE_CHUNK)
      )
      if (i < shapeable.length) {
        cancel = scheduleIdle(step)
      } else {
        setResolved({ key, dead })
      }
    }
    cancel = scheduleIdle(step)
    return () => {
      cancelled = true
      cancel?.()
    }
    // reason: the KEY is the single content-hash of every value the probe reads;
    // ``inputs.current`` supplies the live objects without re-triggering on their
    // (pan-churned) identity. Re-running only on ``key`` is the whole perf fix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Only expose the DEAD set once it matches the CURRENT key (a stale in-flight
  // topology never suppresses the wrong handles).
  return useMemo(() => (resolved.key === key ? resolved.dead : new Set<string>()), [resolved, key])
}

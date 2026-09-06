/**
 * Pins for the pure part of the process-tree helper (explicit vitest imports).
 */

import { describe, it, expect } from 'vitest'

import { descendantsOf, type ProcRow } from './processTree'

const SNAP: ProcRow[] = [
  { pid: 1, ppid: 0, cmd: 'root' },
  { pid: 10, ppid: 1, cmd: 'electron main' },
  { pid: 11, ppid: 10, cmd: 'electron renderer' },
  { pid: 12, ppid: 10, cmd: 'uv run python -m groundmodel' },
  { pid: 13, ppid: 12, cmd: 'python worker' },
  { pid: 99, ppid: 1, cmd: 'unrelated' },
]

describe('descendantsOf', () => {
  it('collects every descendant at any depth, excluding the root', () => {
    const pids = descendantsOf(10, SNAP).map(r => r.pid).sort((a, b) => a - b)
    expect(pids).toEqual([11, 12, 13])
  })

  it('returns nothing for a leaf pid', () => {
    expect(descendantsOf(13, SNAP)).toEqual([])
  })

  it('does not loop on a cyclic parent reference', () => {
    const cyclic: ProcRow[] = [
      { pid: 5, ppid: 6, cmd: 'a' },
      { pid: 6, ppid: 5, cmd: 'b' },
    ]
    // Must terminate; 6 is the only reachable descendant of 5.
    expect(descendantsOf(5, cyclic).map(r => r.pid)).toEqual([6])
  })
})

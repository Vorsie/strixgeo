// The Windows orphan bug, pinned in one place: closing StrixGeo must leave no
// lingering process, and ``child.kill()`` on Windows is ``TerminateProcess`` on
// the DIRECT process only - the engine's ProcessPoolExecutor parse workers (up
// to four ``python.exe`` grandchildren once a DOV import ran) survive it. The
// cure is ``taskkill /PID <pid> /T /F``, whose ``/T`` walks the whole tree while
// the parent still lives to link it.

import { describe, expect, it, vi } from 'vitest'

import { killProcessTreeSync, taskkillTreeArgs } from './killProcessTree'

describe('the engine and database are killed by their whole process tree', () => {
  it('KPT1 - the kill uses /T (the whole tree) and /F (force), not a bare terminate', () => {
    // /T is the load-bearing flag: without it the grandchildren orphan.
    expect(taskkillTreeArgs(4321)).toEqual(['/PID', '4321', '/T', '/F'])
  })

  it('KPT2 - killProcessTreeSync hands taskkill the tree args for the given pid', () => {
    const run = vi.fn(() => ({ status: 0 }))
    killProcessTreeSync(1234, () => {}, run)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith('taskkill', ['/PID', '1234', '/T', '/F'])
  })

  it('KPT3 - a pid that already exited is swallowed, not thrown', () => {
    // taskkill exits non-zero ("process not found") when the tree is already
    // gone. The goal state - that pid dead - already holds, so the shutdown must
    // not throw out of its own teardown.
    const lines: string[] = []
    const run = vi.fn(() => ({ status: 128, stderr: 'ERROR: process 1 not found.' }))
    expect(() => killProcessTreeSync(1, l => lines.push(l), run)).not.toThrow()
    expect(lines.join('\n')).toContain('128')
  })
})

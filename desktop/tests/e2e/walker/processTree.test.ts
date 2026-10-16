/**
 * Pins for the pure part of the process-tree helper (explicit vitest imports).
 */

import { describe, it, expect } from 'vitest'

import {
  describeProcess,
  descendantsOf,
  exeNameOf,
  formatLifetime,
  observeSurvivors,
  type ObserveDeps,
  type ProcRow,
} from './processTree'

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

// Walker deep run 2026-10-16 (seed 414764992): the one finding named only
// "pids still alive 5 s after close: 39360" and the process was gone by the
// time anyone looked. The rule: a survivor is NAMED by its executable, which is
// the basename of the first token of its command line, quoted or not.
describe('exeNameOf -- the executable a survivor ran', () => {
  it('takes the basename of a quoted path that holds spaces', () => {
    expect(exeNameOf('"C:\\Program Files\\StrixGeo\\electron.exe" --type=gpu-process --field-trial')).toBe(
      'electron.exe',
    )
  })

  it('takes the basename of an unquoted path', () => {
    expect(exeNameOf('C:\\Windows\\system32\\conhost.exe 0xffffffff -ForceV1')).toBe('conhost.exe')
  })

  it('takes a bare program name as it is, and a forward-slash path by its basename', () => {
    expect(exeNameOf('python -m groundmodel')).toBe('python')
    expect(exeNameOf('/usr/bin/node script.js')).toBe('node')
  })

  it('an empty command line names no executable', () => {
    expect(exeNameOf('')).toBe('')
    expect(exeNameOf('   ')).toBe('')
  })
})

describe('describeProcess -- one survivor named from the pre-close snapshot', () => {
  const snap: ProcRow[] = [
    { pid: 39360, ppid: 12345, cmd: '"C:\\a b\\electron.exe" --type=gpu-process --gpu-preferences=' + 'x'.repeat(300) },
    { pid: 7, ppid: 1, cmd: '' },
  ]

  it('names pid, parent pid, executable and the head of the command line', () => {
    const text = describeProcess(39360, snap)
    expect(text.startsWith('39360 (ppid 12345, electron.exe, "')).toBe(true)
    expect(text).toContain('--type=gpu-process')
  })

  it('cuts the command line at 160 characters', () => {
    const text = describeProcess(39360, snap)
    const quoted = text.slice(text.indexOf(', "') + 3, text.lastIndexOf('"'))
    expect(quoted.length).toBe(160 + '...'.length)
    expect(quoted.endsWith('...')).toBe(true)
  })

  it('a row with no command line says so instead of printing empty quotes', () => {
    expect(describeProcess(7, snap)).toBe('7 (ppid 1, unknown executable, no command line)')
  })

  it('a pid missing from the snapshot is marked as such', () => {
    expect(describeProcess(4242, snap)).toBe('4242 (not in the pre-close snapshot)')
  })
})

describe('formatLifetime -- how long a survivor lived after the close', () => {
  it('an exit inside the window reads as seconds with one decimal', () => {
    expect(formatLifetime(7349, 20_000)).toBe('exited after 7.3 s')
  })

  it('no exit inside the window reads as still alive at the window end', () => {
    expect(formatLifetime(undefined, 20_000)).toBe('still alive at 20 s')
  })
})

/**
 * A fake clock and process list: ``exitAt`` maps pid -> the ms it disappears
 * (absent = never); pid 1 always stays so a snapshot is never empty unless
 * ``blankAt`` names that instant (a failed WMI query).
 */
function fakeDeps(exitAt: Record<number, number>, pids: number[], blankAt: number[] = []): ObserveDeps {
  let t = 0
  return {
    now: () => t,
    sleep: async ms => {
      t += ms
    },
    snapshot: () => {
      if (blankAt.includes(t)) return []
      const rows: ProcRow[] = [{ pid: 1, ppid: 0, cmd: 'system' }]
      for (const pid of pids) if (exitAt[pid] === undefined || t < exitAt[pid]) rows.push({ pid, ppid: 1, cmd: 'x' })
      return rows
    },
  }
}

const OPTS = { thresholdMs: 5000, windowMs: 20_000, pollMs: 250 }

describe('observeSurvivors -- the finding stays at 5 s, the watch runs on to report exit times', () => {
  it('a pid gone before 5 s is no survivor', async () => {
    const out = await observeSurvivors([10], OPTS, fakeDeps({ 10: 1000 }, [10]))
    expect(out.atThreshold).toEqual([])
    expect(out.exitedAfterMs.get(10)).toBe(1000)
  })

  it('a pid alive at 5 s that exits at 7.25 s is a survivor with its exit time', async () => {
    const seen: number[][] = []
    const out = await observeSurvivors(
      [10, 11],
      { ...OPTS, onThreshold: s => seen.push([...s]) },
      fakeDeps({ 10: 500, 11: 7250 }, [10, 11]),
    )
    expect(out.atThreshold).toEqual([11])
    expect(seen).toEqual([[11]])
    expect(out.exitedAfterMs.get(11)).toBe(7250)
  })

  it('a pid that never exits stays a survivor with no exit time, and the watch stops at 20 s', async () => {
    const deps = fakeDeps({}, [10])
    const out = await observeSurvivors([10], OPTS, deps)
    expect(out.atThreshold).toEqual([10])
    expect(out.exitedAfterMs.has(10)).toBe(false)
    expect(deps.now()).toBe(20_000)
  })

  it('an empty snapshot (a failed WMI query) is not read as every pid exiting', async () => {
    const out = await observeSurvivors([10], OPTS, fakeDeps({ 10: 6000 }, [10], [250, 500]))
    expect(out.atThreshold).toEqual([10])
    expect(out.exitedAfterMs.get(10)).toBe(6000)
  })
})

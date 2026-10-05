// The main log in DEV (owner 2026-10-05: "isn't it easier to log the backend to
// file man, i'm sick of copy pasting"). A dev launch writes the same backend.log
// a packaged launch writes, AND keeps the terminal echo the owner reads.
//
// Real files in a temp dir (the log IS a file; faking fs would test the fake),
// a fake child process (two PassThrough streams) standing in for uvicorn.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { readFileSync as readSource } from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { bootMainLog, createMainLog, MAIN_LOG_FILENAME, pipeBackendOutput } from './mainLog'
import { forwardRendererMessage } from './rendererConsoleForwarding'

let logsDir: string

beforeEach(() => {
  logsDir = mkdtempSync(join(tmpdir(), 'strix-mainlog-'))
})

afterEach(() => {
  rmSync(logsDir, { recursive: true, force: true })
})

function fakeConsole() {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function fakeApiProcess() {
  return { stdout: new PassThrough(), stderr: new PassThrough() }
}

/** Let the PassThrough deliver its 'data' event. */
function flush(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}

function fileText(): string {
  return readFileSync(join(logsDir, MAIN_LOG_FILENAME), 'utf-8')
}

describe('dev launch: the backend output lands in the log file AND on the console', () => {
  it('ML1 - a line the api prints on stdout is in backend.log and in the terminal', async () => {
    const console = fakeConsole()
    const log = createMainLog({ echoToConsole: true, console })
    log.open(logsDir)
    const api = fakeApiProcess()
    pipeBackendOutput(api, log)

    api.stdout.write('INFO:     Uvicorn running on http://127.0.0.1:8765\n')
    await flush()

    expect(fileText()).toContain('[api] INFO:     Uvicorn running on http://127.0.0.1:8765')
    expect(console.log).toHaveBeenCalledWith('[api] INFO:     Uvicorn running on http://127.0.0.1:8765')
  })

  it('ML2 - a stderr line is tagged [api:err] in the file and stays an error on the terminal', async () => {
    const console = fakeConsole()
    const log = createMainLog({ echoToConsole: true, console })
    log.open(logsDir)
    const api = fakeApiProcess()
    pipeBackendOutput(api, log)

    api.stderr.write('Traceback (most recent call last):\n')
    await flush()

    expect(fileText()).toContain('[api:err] Traceback (most recent call last):')
    // The terminal keeps the [api] tag it always had for stderr.
    expect(console.error).toHaveBeenCalledWith('[api] Traceback (most recent call last):')
  })

  it('ML3 - a packaged launch writes the file and never echoes to the console', async () => {
    const console = fakeConsole()
    const log = createMainLog({ echoToConsole: false, console })
    log.open(logsDir)
    const api = fakeApiProcess()
    pipeBackendOutput(api, log)

    api.stdout.write('postgresql+asyncpg://groundmodel:secret@127.0.0.1:5433/x\n')
    await flush()

    expect(fileText()).toContain('[api] postgresql+asyncpg://')
    expect(console.log).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
  })

  it('ML4 - a line written before the log is open still reaches the console', () => {
    const console = fakeConsole()
    const log = createMainLog({ echoToConsole: false, console })

    log.write('[main] early line')

    expect(console.log).toHaveBeenCalledWith('[main] early line')
    expect(log.path).toBeNull()
  })

  it('ML5 - a dead terminal (EPIPE) never stops the line reaching the file', () => {
    const console = fakeConsole()
    console.log.mockImplementation(() => {
      throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })
    })
    const log = createMainLog({ echoToConsole: true, console })
    log.open(logsDir)

    expect(() => log.write('[main] after the pipe broke')).not.toThrow()
    expect(fileText()).toContain('[main] after the pipe broke')
  })

  it('ML6 - an over-cap file from the last launch rotates to .1 when the log opens', () => {
    writeFileSync(join(logsDir, MAIN_LOG_FILENAME), 'x'.repeat(200))
    const log = createMainLog({ echoToConsole: true, console: fakeConsole(), maxBytes: 100 })

    log.open(logsDir)
    log.write('[boot] fresh launch')

    expect(readFileSync(join(logsDir, `${MAIN_LOG_FILENAME}.1`), 'utf-8')).toBe('x'.repeat(200))
    expect(fileText()).toBe('[boot] fresh launch\n')
  })
})

describe('boot: a dev launch opens the log and says where it is', () => {
  it('ML7 - dev prints "[boot] main log: <path>" on the console and writes it to the file', () => {
    const console = fakeConsole()
    const log = createMainLog({ echoToConsole: true, console })

    bootMainLog({ packaged: false, logsDir, log })

    const expectedPath = join(logsDir, MAIN_LOG_FILENAME)
    expect(log.path).toBe(expectedPath)
    expect(console.log).toHaveBeenCalledWith(`[boot] main log: ${expectedPath}`)
    expect(fileText()).toContain(`[boot] main log: ${expectedPath}`)
  })

  it('ML8 - a packaged boot leaves the opening to the packaged stages (no change there)', () => {
    const console = fakeConsole()
    const log = createMainLog({ echoToConsole: false, console })

    bootMainLog({ packaged: true, logsDir, log })

    expect(log.path).toBeNull()
    expect(console.log).not.toHaveBeenCalled()
  })
})

describe('dev launch: the renderer [ui ...] lines land in the same file', () => {
  it('ML9 - a forwarded renderer log line is in backend.log and on the console', () => {
    const console = fakeConsole()
    const log = createMainLog({ echoToConsole: true, console })
    log.open(logsDir)
    const line = '[ui 22:01:05.123 WARN sections] fill took 812 ms'

    forwardRendererMessage(
      { level: 'warning', message: line, sourceId: 'http://localhost:5173/src/x.ts', lineNumber: 1 },
      log.write,
    )

    expect(fileText()).toContain(line)
    expect(console.warn).toHaveBeenCalledWith(line)
  })

  it('ML10 - DevTools chatter stays out of the file', () => {
    const log = createMainLog({ echoToConsole: true, console: fakeConsole() })
    log.open(logsDir)

    forwardRendererMessage(
      { level: 'info', message: 'devtools noise', sourceId: 'devtools://devtools/x.js', lineNumber: 1 },
      log.write,
    )
    log.write('[main] marker')

    expect(fileText()).not.toContain('devtools noise')
  })
})

describe('index.ts wires the dev log (source pins: index.ts imports electron at module scope)', () => {
  const MAIN_SOURCE = readSource(join(__dirname, 'index.ts'), 'utf-8').replace(/\r\n/g, '\n')

  it('ML11 - the boot opens the log before the first [boot] line', () => {
    const boot = MAIN_SOURCE.indexOf('bootMainLog({')
    const firstBootLine = MAIN_SOURCE.indexOf('[boot] StrixGeo')
    expect(boot).toBeGreaterThanOrEqual(0)
    expect(boot).toBeLessThan(firstBootLine)
  })

  it('ML12 - the api output and the renderer console both go through the main log', () => {
    expect(MAIN_SOURCE).toContain('pipeBackendOutput(apiProcess, mainLog)')
    expect(MAIN_SOURCE).toContain('forwardRendererMessage(details, mainLog.write)')
    // The old dev-only console path for the api output is gone.
    expect(MAIN_SOURCE).not.toContain("console.log('[api]'")
  })
})

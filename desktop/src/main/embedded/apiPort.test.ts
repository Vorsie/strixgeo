// Tester finding 2026-10-12: a packaged 0.1.4 died twice at start with uvicorn
// "[Errno 10048] error while attempting to bind on address ('127.0.0.1', 8765)"
// because another program on that PC owned 8765. Rule: the packaged app
// acquires a free loopback port for the engine at boot the way it acquires the
// Postgres port: prefer 8765 when it is free, else the next free port in a
// small range, else a port the OS assigns. Dev and e2e keep 8765.

import { createServer, type Server } from 'net'
import { afterEach, describe, expect, it } from 'vitest'

import {
  API_PORT_FALLBACK_SPAN,
  DEFAULT_API_PORT,
  apiBaseUrl,
  apiPortCandidates,
  chooseApiPort,
  describeApiPortChoice,
  isLoopbackPortFree,
} from './apiPort'

/** A free-check that reports the listed ports as busy. */
function busyAt(...busy: number[]): (port: number) => Promise<boolean> {
  return async port => !busy.includes(port)
}

describe('apiPortCandidates - 8765 first, then a small range above it', () => {
  it('AP1 - starts at the preferred port 8765 and walks up the range', () => {
    const candidates = apiPortCandidates()
    expect(DEFAULT_API_PORT).toBe(8765)
    expect(candidates[0]).toBe(8765)
    expect(candidates).toHaveLength(API_PORT_FALLBACK_SPAN)
    expect(candidates[1]).toBe(8766)
  })
})

describe('chooseApiPort - prefer 8765 when free, else the next free port, else the OS', () => {
  it('AP2 - 8765 free: the engine gets 8765', async () => {
    const choice = await chooseApiPort({
      isFree: busyAt(),
      osAssigned: async () => 51000,
      taken: new Set(),
    })
    expect(choice).toEqual({ port: 8765, source: 'preferred', busy: [] })
  })

  it('AP3 - another program owns 8765: the engine gets the next free port in the range', async () => {
    const choice = await chooseApiPort({
      isFree: busyAt(8765, 8766),
      osAssigned: async () => 51000,
      taken: new Set(),
    })
    expect(choice).toEqual({ port: 8767, source: 'fallback', busy: [8765, 8766] })
  })

  it('AP4 - every port in the range busy: the OS assigns one', async () => {
    const choice = await chooseApiPort({
      isFree: async () => false,
      osAssigned: async () => 51000,
      taken: new Set(),
    })
    expect(choice.port).toBe(51000)
    expect(choice.source).toBe('os-assigned')
    expect(choice.busy).toEqual(apiPortCandidates())
  })

  it('AP5 - a port this launch already gave Postgres is never handed to the engine', async () => {
    const choice = await chooseApiPort({
      isFree: busyAt(),
      osAssigned: async () => 51000,
      taken: new Set([8765]),
    })
    expect(choice.port).toBe(8766)
    expect(choice.source).toBe('fallback')
  })
})

describe('describeApiPortChoice - the boot-log note', () => {
  it('AP6 - names the port and why it was chosen', () => {
    expect(describeApiPortChoice({ port: 8765, source: 'preferred', busy: [] })).toBe(
      'port 8765 (preferred)',
    )
    expect(describeApiPortChoice({ port: 8767, source: 'fallback', busy: [8765, 8766] })).toBe(
      'port 8767 (busy: 8765, 8766)',
    )
    expect(
      describeApiPortChoice({ port: 51000, source: 'os-assigned', busy: [8765, 8766] }),
    ).toBe('port 51000 (OS-assigned; busy: 8765, 8766)')
  })
})

describe('apiBaseUrl - the loopback origin for a port', () => {
  it('AP7 - composes http://127.0.0.1:<port>', () => {
    expect(apiBaseUrl(8765)).toBe('http://127.0.0.1:8765')
    expect(apiBaseUrl(8767)).toBe('http://127.0.0.1:8767')
  })
})

// Real sockets: the check must see a port another program holds, whichever
// interface that program bound.
describe('isLoopbackPortFree + chooseApiPort against real sockets', () => {
  const servers: Server[] = []

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(s => new Promise<void>(r => s.close(() => r()))))
  })

  /** Listen on an OS-assigned port of ``host`` and return the port. */
  function hold(host: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer()
      servers.push(server)
      server.on('error', reject)
      server.listen(0, host, () => {
        const address = server.address()
        if (address === null || typeof address === 'string') reject(new Error('no port'))
        else resolve(address.port)
      })
    })
  }

  it('AP8 - a port held on 127.0.0.1 reads as busy', async () => {
    const port = await hold('127.0.0.1')
    expect(await isLoopbackPortFree(port)).toBe(false)
  })

  it('AP9 - a port held on every interface (0.0.0.0) reads as busy', async () => {
    const port = await hold('0.0.0.0')
    expect(await isLoopbackPortFree(port)).toBe(false)
  })

  it('AP10 - a released port reads as free', async () => {
    const port = await hold('127.0.0.1')
    await new Promise<void>(r => servers.pop()!.close(() => r()))
    expect(await isLoopbackPortFree(port)).toBe(true)
  })

  it('AP11 - with the preferred port held by another program, the engine falls back', async () => {
    const preferred = await hold('127.0.0.1')
    const choice = await chooseApiPort({
      isFree: isLoopbackPortFree,
      osAssigned: async () => 0,
      taken: new Set(),
      candidates: apiPortCandidates(preferred),
    })
    expect(choice.port).not.toBe(preferred)
    expect(choice.source).not.toBe('preferred')
    expect(choice.busy).toContain(preferred)
  })
})

// Tester finding 2026-10-12: "another program on that PC owns 8765 now". The
// log must say WHICH program when that is cheap to find out: the Windows
// ``netstat -ano`` listing names the listening pid, ``tasklist`` its image.

import { describe, expect, it } from 'vitest'

import { parseNetstatListeners, parseTasklistImage } from './portOwner'

const NETSTAT = [
  '',
  'Active Connections',
  '',
  '  Proto  Local Address          Foreign Address        State           PID',
  '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1180',
  '  TCP    127.0.0.1:8765         0.0.0.0:0              LISTENING       4242',
  '  TCP    127.0.0.1:8765         127.0.0.1:50123        ESTABLISHED     4242',
  '  TCP    127.0.0.1:87650        0.0.0.0:0              LISTENING       9999',
  '  TCP    0.0.0.0:8766           0.0.0.0:0              LISTENING       5151',
  '  TCP    [::]:8766              [::]:0                 LISTENING       5151',
  '  TCP    [::1]:8767             [::]:0                 LISTENING       6161',
].join('\r\n')

describe('parseNetstatListeners - who LISTENS on a port', () => {
  it('PO1 - names the pid listening on 127.0.0.1:<port>, ignoring connections', () => {
    expect(parseNetstatListeners(NETSTAT, 8765)).toEqual([4242])
  })

  it('PO2 - a wildcard (0.0.0.0 / [::]) listener counts too, once per pid', () => {
    expect(parseNetstatListeners(NETSTAT, 8766)).toEqual([5151])
  })

  it('PO3 - an IPv6 loopback listener counts', () => {
    expect(parseNetstatListeners(NETSTAT, 8767)).toEqual([6161])
  })

  it('PO4 - a port nobody listens on names nobody (and 87650 is not 8765)', () => {
    expect(parseNetstatListeners(NETSTAT, 8768)).toEqual([])
    expect(parseNetstatListeners('', 8765)).toEqual([])
  })
})

describe('parseTasklistImage - the image name of a pid', () => {
  it('PO5 - reads the first CSV column', () => {
    expect(parseTasklistImage('"anki.exe","4242","Console","1","312,440 K"\r\n')).toBe('anki.exe')
  })

  it('PO6 - "no tasks" output names nothing', () => {
    expect(parseTasklistImage('INFO: No tasks are running which match the specified criteria.')).toBeNull()
  })
})

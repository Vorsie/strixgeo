// The SSE frame reader shared by the DOV import stream and the PDF triage
// stream: ``data: <json>`` frames separated by a blank line, which a chunked
// response can split anywhere.

import { describe, expect, it, vi } from 'vitest'

import { readSseEvents } from './sseEvents'

function streamOf(chunks: string[]): ReadableStream<Uint8Array<ArrayBuffer>> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
}

async function collect(body: ReadableStream<Uint8Array<ArrayBuffer>>, onBad?: (raw: string) => void) {
  const out: Record<string, unknown>[] = []
  for await (const event of readSseEvents(body, onBad)) out.push(event)
  return out
}

describe('readSseEvents', () => {
  it('yields each data frame as parsed JSON, in order', async () => {
    const events = await collect(streamOf(['data: {"a":1}\n\n', 'data: {"b":2}\n\n']))
    expect(events).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('reassembles a frame split across chunks', async () => {
    const events = await collect(streamOf(['data: {"pha', 'se":"classify","done":3}\n', '\n']))
    expect(events).toEqual([{ phase: 'classify', done: 3 }])
  })

  it('skips an unparseable frame and reports it', async () => {
    const bad = vi.fn()
    const events = await collect(streamOf(['data: {oops\n\n', 'data: {"ok":true}\n\n']), bad)
    expect(events).toEqual([{ ok: true }])
    expect(bad).toHaveBeenCalledWith('{oops')
  })
})

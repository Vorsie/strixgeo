// Server-Sent-Events frame reader for the backend's job streams.
//
// Every job stream (DOV CPT / borehole import, PDF report triage) sends
// ``data: <json>`` frames separated by a blank line. A chunked response can
// split a frame anywhere, so partial frames are buffered until complete.
// Extracted on the second copy (the DOV import hook had the loop inline).

/**
 * Yield every ``data:`` frame of an SSE body as parsed JSON, in order.
 *
 * @param body - The response body stream.
 * @param onUnparseable - Called with the raw text of a frame that is not JSON
 *   (the frame is skipped).
 */
export async function* readSseEvents(
  body: ReadableStream<Uint8Array<ArrayBuffer>>,
  onUnparseable?: (raw: string) => void,
): AsyncGenerator<Record<string, unknown>, void, void> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += value
    const frames = buffer.split('\n\n')
    // The last element may be an incomplete frame — keep it for the next chunk.
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const line = frame.split('\n').find(l => l.startsWith('data: '))
      if (!line) continue
      const raw = line.slice('data: '.length)
      try {
        yield JSON.parse(raw) as Record<string, unknown>
      } catch {
        onUnparseable?.(raw)
      }
    }
  }
}

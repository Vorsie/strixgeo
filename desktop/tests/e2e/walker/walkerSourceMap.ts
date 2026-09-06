/**
 * Resolve a bundled ``assets/<chunk>.js:<line>:<col>`` frame back to its source
 * file and line, so a walker finding names ``src/...`` instead of an opaque
 * minified chunk.
 *
 * The e2e renderer build emits ``.map`` files next to each chunk only when
 * ``E2E_SOURCEMAP=1`` (set by ``scripts/run-e2e.ps1``); production
 * ``npm run dist`` ships none. This module decodes a Source Map v3 ``mappings``
 * string with a self-contained Base64 VLQ decoder — no ``source-map`` package
 * (it is only a transitive dependency here) and no runtime dependency added to
 * the app. ``originalPositionFor`` is pure and unit-tested against a synthetic
 * map; ``resolveDetailSourceLocation`` is the thin file-system wrapper the
 * report calls.
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** The Base64 alphabet Source Map VLQ uses (RFC 4648 §4 order). */
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BASE64_TO_INT = new Map<string, number>()
for (let i = 0; i < BASE64_ALPHABET.length; i += 1) BASE64_TO_INT.set(BASE64_ALPHABET[i], i)

/** Continuation bit and value mask of a single Base64 VLQ digit. */
const VLQ_CONTINUATION_BIT = 0x20
const VLQ_VALUE_MASK = 0x1f

/** A minimal Source Map v3 document — only the fields this decoder reads. */
export interface RawSourceMap {
  version: number
  sources: string[]
  mappings: string
  sourceRoot?: string
  file?: string
  names?: string[]
  sourcesContent?: Array<string | null>
}

/** A resolved original position. */
export interface OriginalPosition {
  /** The source path as listed in the map (sourceRoot applied). */
  source: string
  /** 1-based line in the source. */
  line: number
  /** 0-based column in the source (Source Map convention). */
  column: number
}

/** One decoded mapping segment on a generated line. */
interface Segment {
  generatedColumn: number
  sourceIndex: number
  sourceLine: number
  sourceColumn: number
}

/**
 * Decode consecutive Base64 VLQ values from one segment string.
 *
 * @param segment - A comma-free run of Base64 VLQ digits.
 * @returns The decoded signed integers in order.
 * @throws Error if a character is not a Base64 VLQ digit.
 */
function decodeVlq(segment: string): number[] {
  const out: number[] = []
  let value = 0
  let shift = 0
  for (const char of segment) {
    const digit = BASE64_TO_INT.get(char)
    if (digit === undefined) throw new Error(`invalid Base64 VLQ character: ${char}`)
    value += (digit & VLQ_VALUE_MASK) << shift
    if (digit & VLQ_CONTINUATION_BIT) {
      shift += 5
    } else {
      const negative = value & 1
      const magnitude = value >>> 1
      out.push(negative ? -magnitude : magnitude)
      value = 0
      shift = 0
    }
  }
  return out
}

/** Running source-field totals — cumulative across the whole map, not per line. */
interface DecoderState {
  sourceIndex: number
  sourceLine: number
  sourceColumn: number
}

/**
 * Decode all segments on one generated line, advancing the cumulative state.
 *
 * ``generatedColumn`` resets to 0 at every line; ``sourceIndex`` /
 * ``sourceLine`` / ``sourceColumn`` are relative to the running totals carried
 * across lines. Single-field segments (a generated column with no source) are
 * kept but flagged with ``sourceIndex = -1``.
 *
 * @param lineMappings - One line's segment string (may be empty).
 * @param state - The cumulative source-field totals; mutated in place.
 * @returns The line's segments in generated-column order.
 */
function decodeLine(lineMappings: string, state: DecoderState): Segment[] {
  const segments: Segment[] = []
  if (lineMappings === '') return segments
  let generatedColumn = 0
  for (const segmentStr of lineMappings.split(',')) {
    if (segmentStr === '') continue
    const fields = decodeVlq(segmentStr)
    generatedColumn += fields[0]
    if (fields.length >= 4) {
      state.sourceIndex += fields[1]
      state.sourceLine += fields[2]
      state.sourceColumn += fields[3]
      segments.push({
        generatedColumn,
        sourceIndex: state.sourceIndex,
        sourceLine: state.sourceLine,
        sourceColumn: state.sourceColumn,
      })
    } else {
      segments.push({ generatedColumn, sourceIndex: -1, sourceLine: -1, sourceColumn: -1 })
    }
  }
  return segments
}

/**
 * Join a source path onto the map's ``sourceRoot`` (if any).
 *
 * @param map - The parsed source map.
 * @param sourceIndex - Index into ``map.sources``.
 * @returns The source path, or ``null`` when the index is out of range.
 */
function resolveSourcePath(map: RawSourceMap, sourceIndex: number): string | null {
  const raw = map.sources[sourceIndex]
  if (raw === undefined) return null
  const root = map.sourceRoot ?? ''
  if (root === '') return raw
  return `${root.replace(/\/$/, '')}/${raw}`
}

/**
 * Resolve a generated position to its original source position.
 *
 * Pure — takes the parsed map, returns the original position or ``null`` when
 * the line has no source-bearing mapping. Uses the Source Map convention:
 * ``generatedLine`` is 1-based, ``generatedColumn`` is 0-based; the returned
 * ``line`` is 1-based and ``column`` 0-based. When no segment starts at or
 * before ``generatedColumn`` (greatest-lower-bound miss), the first mapped
 * segment on the line is used — a lenient nearest, since minified columns
 * routinely fall between segment starts.
 *
 * @param map - The parsed Source Map v3 document.
 * @param generatedLine - 1-based line in the generated file.
 * @param generatedColumn - 0-based column in the generated file.
 * @returns The original position, or ``null`` if unresolvable.
 */
export function originalPositionFor(
  map: RawSourceMap,
  generatedLine: number,
  generatedColumn: number,
): OriginalPosition | null {
  const targetIndex = generatedLine - 1
  const lines = map.mappings.split(';')
  if (targetIndex < 0 || targetIndex >= lines.length) return null

  const state: DecoderState = { sourceIndex: 0, sourceLine: 0, sourceColumn: 0 }
  let targetSegments: Segment[] = []
  for (let i = 0; i <= targetIndex; i += 1) {
    const segments = decodeLine(lines[i], state)
    if (i === targetIndex) targetSegments = segments
  }

  const mapped = targetSegments.filter(s => s.sourceIndex >= 0)
  if (mapped.length === 0) return null

  let chosen: Segment | null = null
  for (const segment of mapped) {
    if (segment.generatedColumn <= generatedColumn) chosen = segment
    else break
  }
  if (chosen === null) chosen = mapped[0]

  const source = resolveSourcePath(map, chosen.sourceIndex)
  if (source === null) return null
  return { source, line: chosen.sourceLine + 1, column: chosen.sourceColumn }
}

/**
 * Trim a source path to a repo-relative ``src/...`` where possible.
 *
 * Vite lists a chunk's sources relative to ``out/renderer/assets`` — e.g.
 * ``../../src/renderer/src/components/MapView.tsx`` — so stripping the leading
 * ``../`` chain yields the stable ``src/...`` form. Anything else is returned
 * unchanged.
 *
 * @param source - A source path from the map.
 * @returns The trimmed path.
 */
function tidySourcePath(source: string): string {
  return source.replace(/^(?:\.\.\/)+/, '')
}

/**
 * A ``file://`` chunk frame found inside a finding detail.
 */
interface BundleFrame {
  /** The ``file://`` URL of the ``.js`` chunk. */
  fileUrl: string
  /** 1-based line reported in the frame. */
  line: number
  /** 1-based column reported in the frame (V8/Chromium convention). */
  column: number
}

/**
 * Extract the first ``file://.../assets/<chunk>.js:<line>:<col>`` frame from a
 * detail string.
 *
 * @param detail - A finding detail line.
 * @returns The parsed frame, or ``null`` when none is present.
 */
export function parseBundleFrame(detail: string): BundleFrame | null {
  const match = detail.match(/(file:\/\/\/?[^\s]*?\/assets\/[^\s/:]+\.js):(\d+):(\d+)/)
  if (!match) return null
  return { fileUrl: match[1], line: Number(match[2]), column: Number(match[3]) }
}

/** Reads a ``.map`` file's text, or ``null`` when it is absent. */
export type MapReader = (mapPath: string) => string | null

/** Default reader: the ``.map`` sibling on disk, or ``null``. */
function readMapFromDisk(mapPath: string): string | null {
  return existsSync(mapPath) ? readFileSync(mapPath, 'utf-8') : null
}

/**
 * Enrich a finding detail with its source location, resolved through the
 * chunk's ``.map``.
 *
 * When the detail carries a ``file://.../assets/<chunk>.js:<line>:<col>`` frame
 * and the sibling ``<chunk>.js.map`` is readable, append
 * `` -> src/...:<line>:<col>``. Any failure (no frame, no map, parse error,
 * unresolvable position) returns the detail unchanged, so a run without
 * sourcemaps still produces a valid report.
 *
 * @param detail - The finding detail line.
 * @param readMap - Injectable ``.map`` reader (defaults to reading disk).
 * @returns The detail, enriched with the source location when resolvable.
 */
export function resolveDetailSourceLocation(
  detail: string,
  readMap: MapReader = readMapFromDisk,
): string {
  const frame = parseBundleFrame(detail)
  if (frame === null) return detail
  try {
    const jsPath = fileURLToPath(frame.fileUrl)
    const raw = readMap(`${jsPath}.map`)
    if (raw === null || raw === '') return detail
    const map = JSON.parse(raw) as RawSourceMap
    // V8 stack columns are 1-based; Source Map queries are 0-based.
    const position = originalPositionFor(map, frame.line, Math.max(0, frame.column - 1))
    if (position === null) return detail
    // Present the source column 1-based to match the bundle frame's convention.
    return `${detail} -> ${tidySourcePath(position.source)}:${position.line}:${position.column + 1}`
  } catch {
    return detail
  }
}

/**
 * Vertically-centred multi-line SVG label for ghost-column rects.
 *
 * Shared by ``LithoSuggestionGhostColumns`` and
 * ``VirtueleBoringGhostColumns`` (extracted from their verbatim
 * copies). Uses one ``<tspan>`` per line so the renderer doesn't need
 * to measure text widths per render — the ``lines`` array carries the
 * exact wrap the character-budget heuristic produced.
 *
 * The ``<text>`` is ``pointerEvents: 'none'`` — clicks fall through to
 * the ghost rect underneath, which owns all interaction.
 */
function MultiLineLabel({
  lines,
  centerX,
  rectTopY,
  rectHeight,
  fontSize,
  tooltip,
}: {
  lines: readonly string[]
  centerX: number
  rectTopY: number
  rectHeight: number
  fontSize: number
  tooltip: string
}): JSX.Element {
  const lineHeight = fontSize * 1.15
  // Centre the multi-line block vertically inside the rect:
  // first baseline = rect centre minus half the block height plus
  // the font's typical ascender (≈ 0.75 × fontSize).
  const blockHeight = lineHeight * lines.length
  const firstBaselineY =
    rectTopY + rectHeight / 2 - blockHeight / 2 + fontSize * 0.8
  return (
    <text
      x={centerX}
      y={firstBaselineY}
      textAnchor="middle"
      fontSize={fontSize}
      fill="#111827"
      style={{ pointerEvents: 'none', userSelect: 'none' }}
    >
      {lines.map((line, i) => (
        <tspan key={i} x={centerX} dy={i === 0 ? 0 : lineHeight}>
          {line}
        </tspan>
      ))}
      <title>{tooltip}</title>
    </text>
  )
}

export default MultiLineLabel

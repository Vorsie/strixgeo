// Text + chrome metrics the toolbar-overflow planner measures with.
//
// WHY estimate instead of measuring the DOM: measuring rendered widths and
// then collapsing changes those widths, so the measurement feeds back into
// its own input and the row flaps between two layouts at the boundary. The
// planner is instead a pure function of the FULL-label widths and the
// container width, so its output is stable for a given viewport — it never
// reads back what it just rendered.
//
// The numbers are deliberately CONSERVATIVE (a slight over-estimate). An
// over-estimate collapses a few pixels early, which is invisible; an
// under-estimate would clip, which is the bug this module exists to kill.
// The row also keeps the ``toolbar-scrollable`` fallback above it, so even a
// badly wrong estimate degrades to a scrollbar rather than a mid-word cut.

/** Per-character advance + per-control chrome, all in CSS px. */
export interface ToolbarMetrics {
  /** Mean advance of one character at ``text-xs`` (12 px) in the system UI
   *  face. 6.4 is above the ~6.0-6.2 measured mean so mixed-case labels with
   *  capitals and digits still fit. */
  charAdvancePx: number
  /** Lucide icon box used by every toolbar primitive (``size={13}``). */
  iconPx: number
  /** Trailing ``ChevronDown size={11}`` on dropdown + split triggers. */
  caretIconPx: number
  /** ``px-2.5`` on ToolbarButton / PrimaryToolbarButton / ToolbarDropdown. */
  buttonPaddingPx: number
  /** ``gap-1.5`` between a control's icon, label and caret. */
  intraGapPx: number
  /** ``pl-2.5 pr-2`` + the caret half's ``px-1.5`` on SplitToolbarButton. */
  splitCaretPx: number
  /** ``gap-1`` between two toolbar controls. */
  rowGapPx: number
  /** Width the "⋯ More" trigger claims once anything folds into it. */
  overflowTriggerPx: number
}

export const DEFAULT_TOOLBAR_METRICS: ToolbarMetrics = {
  charAdvancePx: 6.4,
  iconPx: 13,
  caretIconPx: 11,
  buttonPaddingPx: 20,
  intraGapPx: 6,
  splitCaretPx: 21,
  rowGapPx: 4,
  overflowTriggerPx: 84,
}

/** Width of a ``w-px … mx-0.5`` separator: 1 px rule + 2 × 2 px margin. */
export const TOOLBAR_SEPARATOR_PX = 5

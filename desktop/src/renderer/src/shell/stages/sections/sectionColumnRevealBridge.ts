/**
 * Module-ref bridge from the SHELL to the Sections CANVAS: "bring this test's
 * column on screen".
 *
 * Two callers on the Geotechnical stage have to land on the Sections stage:
 * the Build pre-flight's one-click visit (owner ruling 2026-08-26: *"make it so
 * that user can go to those test through one click"*) and the gapless build
 * report's "Show me" (owner dogfeed 2026-08-28: *"the show me button opens
 * section but doesn't zoom to issue"*). The stage switch and the section select
 * are ``AppShell``'s job — it owns ``setActiveStage`` — but the pan and the
 * pulse belong to the surface that draws the columns. Nothing in between shares
 * a React parent, which is the same gap ``pendingTieRevealBridge`` closes for
 * the toolbar chip.
 *
 * The caller names INVESTIGATIONS and nothing else. It never passes a position,
 * a column index, or a slot in anyone's column list — that rule has already
 * cost one real bug (``PartitionFillOverlay.onJumpToConflictGap``), and this
 * bridge crosses two stage boundaries rather than one. A GAP is therefore named
 * by its two columns, never by its index: the index is only meaningful on the
 * litho frame's column list, and the panel resolves against its own.
 *
 * ``null`` whenever the Sections canvas is not mounted; a caller that finds it
 * null has simply asked too early and gets a plain ``false`` back.
 *
 * @module shell/stages/sections/sectionColumnRevealBridge
 */

import type { SectionColumnRevealResult } from '../../../components/sections/sectionColumnReveal'

/**
 * Bring the named investigations' columns on screen on the open section.
 *
 * One id centres and pulses that column. Two centre on the midpoint of their
 * span — the gap between them (see ``resolveColumnReveal``).
 *
 * Registered by ``useSectionColumnRevealBridge`` under ``SectionsCanvas``;
 * called by ``AppShell`` once the deep-link's stage switch + section select
 * have settled.
 */
export const sectionsRevealColumnCallback: {
  current: ((investigationIds: readonly string[]) => SectionColumnRevealResult) | null
} = {
  current: null,
}

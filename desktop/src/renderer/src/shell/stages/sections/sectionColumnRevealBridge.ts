/**
 * Module-ref bridge from the SHELL to the Sections CANVAS: "bring this test's
 * column on screen".
 *
 * The Build pre-flight lives on the Geotechnical stage and its one-click visit
 * has to land on the Sections stage (owner ruling 2026-08-26: *"make it so that
 * user can go to those test through one click"*). The stage switch and the
 * section select are ``AppShell``'s job — it owns ``setActiveStage`` — but the
 * pan and the pulse belong to the surface that draws the column. Nothing in
 * between shares a React parent, which is the same gap
 * ``pendingTieRevealBridge`` closes for the toolbar chip.
 *
 * The caller names an INVESTIGATION and nothing else. It never passes a
 * position, a column index, or a slot in anyone's column list — that rule has
 * already cost one real bug (``PartitionFillOverlay.onJumpToConflictGap``), and
 * this bridge crosses two stage boundaries rather than one.
 *
 * ``null`` whenever the Sections canvas is not mounted; a caller that finds it
 * null has simply asked too early and gets a plain ``false`` back.
 *
 * @module shell/stages/sections/sectionColumnRevealBridge
 */

import type { SectionColumnRevealResult } from '../../../components/sections/sectionColumnReveal'

/**
 * Centre the named investigation's column on the open section and pulse it.
 *
 * Registered by ``useSectionColumnRevealBridge`` under ``SectionsCanvas``;
 * called by ``AppShell`` once the deep-link's stage switch + section select
 * have settled.
 */
export const sectionsRevealColumnCallback: {
  current: ((investigationId: string) => SectionColumnRevealResult) | null
} = {
  current: null,
}

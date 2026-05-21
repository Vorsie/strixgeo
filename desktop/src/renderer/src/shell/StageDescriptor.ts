// Shell stage contract — the interface every stage descriptor implements.
//
// A ``StageDescriptor`` is a plain TypeScript object (no class, no React
// component at the descriptor level). ``AppShell`` reads the registry to
// configure its three zones (spine button, toolbar, canvas, inspector).
//
// Risk 3 note (see ui-shell-architecture.md §8.1): ``CanvasComponent`` is a
// React component that can render whatever it wants internally, including
// conditional branches. The stage abstraction does NOT mandate a single
// immutable view — a stage like Data that switches between map and chart just
// routes internally.

import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'

/**
 * Identifier for each workflow stage in the spine.
 *
 * Order here mirrors the engineering process order the spine communicates
 * (Data → Sections → Geology → Lithology → Geotechnical → Parameters →
 * Export).
 *
 * ``parameters`` is the sixth spine slot (2026-05-21 owner directive):
 * derive design-ready values per (test × parameter) and per (unit ×
 * parameter), with hard-separated correlation vs xlsx-lookup methods,
 * statistics + raincloud plots, probabilistic-distribution wiring, and
 * ML-suggestion hooks. See
 * ``memory/project_parameters_stage_architecture.md`` for the full
 * design.
 */
export type StageId =
  | 'data'
  | 'sections'
  | 'geology'
  | 'lithology'
  | 'geotechnical'
  | 'parameters'
  | 'export'

/**
 * Computed summary shown in the spine button tooltip and inspector header.
 *
 * The ``badge`` field drives the dot badge on the spine icon — ``null``
 * means no badge. ``badgeIntent`` controls the badge colour.
 */
export interface StageSummary {
  /** Short text shown in the spine button tooltip and inspector header. */
  label: string
  /** Dot badge content on the spine icon. ``null`` = no badge. */
  badge: string | null
  /** Badge colour intent. Defaults to ``'neutral'`` when omitted. */
  badgeIntent?: 'neutral' | 'amber' | 'red'
}

/**
 * Descriptor object that fully specifies a workflow stage.
 *
 * ``AppShell`` reads a ``StageDescriptor`` from the registry and uses it to
 * populate the spine button, the toolbar, the canvas, and the inspector for
 * that stage.  No prop avalanche is passed into zone components — they read
 * their data via ``useShell()`` hooks instead.
 *
 * Parameters
 * ----------
 * id
 *     Unique stage identifier.  Must match the ``StageId`` union.
 * icon
 *     24 px Lucide icon component (not JSX).  ``AppShell`` renders it with
 *     ``size={16}``.
 * spineLabel
 *     Short label rendered below the icon on the spine button (max ~10 chars
 *     at ``w-16``).
 * useStageSummary
 *     React hook (called inside ``AppShell``'s render tree) that computes the
 *     live summary for the spine badge and inspector header.
 * CanvasComponent
 *     The center canvas for this stage.  Receives state via ``useShell()``.
 * ToolbarComponent
 *     The stage-specific left zone of the top toolbar.  Receives state via
 *     ``useShell()``.
 * InspectorComponent
 *     The right inspector panel for this stage.  Receives state via
 *     ``useShell()``.
 */
export interface StageDescriptor {
  id: StageId
  // Lucide icon component. ``LucideIcon`` is lucide-react's own forwardRef
  // type — every stage descriptor assigns a lucide icon (Database, Layers,
  // …), so typing it as the narrower ``ComponentType<{size,className}>``
  // mis-rejected the actual values. StageSpine renders it with size + class.
  icon: LucideIcon
  spineLabel: string
  useStageSummary: () => StageSummary
  CanvasComponent: ComponentType
  ToolbarComponent: ComponentType
  InspectorComponent: ComponentType
}

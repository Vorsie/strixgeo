// Top bar for the shell.
//
// Two zones (per §4.4):
//
//   Left  — renders the active stage's ``ToolbarComponent`` (stage-specific
//            verbs: import, new section, build model, etc.).
//   Right — always-visible global controls:
//             • Project name + dirty indicator (amber asterisk)
//             • Save button  (Ctrl+S affordance)
//             • Theme toggle (System → Light → Dark cycle)
//             • Close project X
//             • Inspector toggle
//
// The project-name / dirty / close affordances previously lived in the
// Sidebar header block (removed in S3). They move here in S4 so every
// stage (Data, Sections, Geology, …) has the same global chrome.
//
// Semantic tokens only on the shell chrome. Existing leaf components
// (DirtyAsterisk) keep their own classes.

import { Laptop, Moon, Save, Sun, X } from 'lucide-react'

import { useShell } from './ShellContext'
import type { StageId, StageDescriptor } from './StageDescriptor'
import { STAGE_REGISTRY } from './StageRegistry'
import { useTheme, type ThemeChoice } from '../hooks/useTheme'
import DirtyAsterisk from '../components/ui/DirtyAsterisk'
import { useT } from '../i18n/translate'

export interface StageToolbarProps {
  /** Currently active stage id. */
  activeStageId: StageId
  /** Whether the inspector panel is currently open. */
  inspectorOpen: boolean
  /** Toggle the inspector panel open/closed. */
  onToggleInspector: () => void
}

/**
 * Top toolbar bar for the workflow-spine shell.
 *
 * Renders the active stage's ``ToolbarComponent`` on the left and
 * always-visible global controls on the right. ``h-10`` matches the
 * ``AppShell`` layout spec in §2.2.
 *
 * Parameters
 * ----------
 * activeStageId
 *     The stage currently displayed in the canvas.
 * inspectorOpen
 *     Whether the right inspector panel is expanded.
 * onToggleInspector
 *     Called when the user clicks the inspector toggle button.
 *
 * Returns
 * -------
 * JSX.Element
 *     The toolbar bar element.
 */
export default function StageToolbar({
  activeStageId,
  inspectorOpen,
  onToggleInspector,
}: StageToolbarProps): JSX.Element {
  const t = useT()
  const descriptor: StageDescriptor | undefined = STAGE_REGISTRY.get(activeStageId)
  const StageVerbs = descriptor?.ToolbarComponent ?? null

  // Global project state — used in the right zone.
  const {
    project,
    lifecycle: { projectDirty, saveProject, handleCloseProjectRequest, setMetadataEditorOpen },
    coordinator: { projectFilePath },
  } = useShell()

  return (
    <div
      role="toolbar"
      aria-label={t('shell.toolbar')}
      className="flex items-center h-10 bg-surface-card border-b border-border-subtle flex-shrink-0"
    >
      {/* Left zone — stage-specific verb buttons.
          A stage that renders its verbs through ``ResponsiveToolbarRow``
          (Sections, Geology) adapts inside this zone: it measures the zone
          and decides which verbs keep their labels, which become icons, and
          which fold into a ⋯ More menu.

          ``toolbar-scrollable`` (debt #23) stays as the LAST RESORT beneath
          that: a stage that has not adopted the responsive row, or a width
          estimate that comes up short, overflows into a thin horizontal
          scrollbar rather than being silently clipped.

          ``min-w-0`` is what lets the zone shrink to the space the right
          cluster leaves — without it the zone's automatic minimum is its
          content's, and the toolbar as a whole would overflow the window. */}
      <div className="flex items-center flex-1 min-w-0 toolbar-scrollable px-2 gap-1">
        {StageVerbs !== null && <StageVerbs />}
      </div>

      {/* Right zone — global shell controls (always visible) */}
      <div className="flex items-center gap-1 px-2 flex-shrink-0">
        {/* Project name + dirty indicator.
            Clicking the name opens the metadata editor (same behaviour
            as the old Sidebar project-name button). Tooltip shows the
            .gmproj file path so the user can confirm which file is open. */}
        <button
          onClick={() => setMetadataEditorOpen(true)}
          title={
            projectFilePath
              ? t('project.editMetadataHintWithPath', { path: projectFilePath })
              : t('project.editMetadataHint')
          }
          className="flex items-center gap-1 px-2 h-7 rounded text-xs text-text-secondary hover:text-text-primary hover:bg-spine-hover transition-colors max-w-[220px]"
        >
          <span className="truncate">{project.name}</span>
          {projectDirty && (
            <DirtyAsterisk
              className="shrink-0"
              title={t('project.unsavedHint')}
              data-testid="dirty-marker"
            />
          )}
        </button>

        {/* Save button — Ctrl+S affordance; also available via File menu. */}
        <button
          type="button"
          aria-label={t('project.save')}
          title={t('project.save')}
          onClick={() => void saveProject()}
          className={[
            'flex items-center justify-center w-7 h-7 rounded',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            'motion-safe:transition-colors motion-safe:duration-150',
            projectDirty
              ? 'text-status-amber hover:bg-spine-hover'
              : 'text-text-muted hover:bg-spine-hover hover:text-text-primary',
          ].join(' ')}
        >
          <Save size={14} />
        </button>

        {/* Theme toggle — cycles System → Light → Dark → System. */}
        <ThemeToggle />

        {/* Close project — mirrors File → Close Project (Ctrl+W) for
            mouse users. App's handleCloseProjectRequest decides whether
            to show the save-or-discard dialog or the click-protection
            confirm, so this button just signals intent. */}
        <button
          type="button"
          aria-label={t('project.close')}
          title={t('project.closeHintGmproj')}
          onClick={handleCloseProjectRequest}
          className={[
            'flex items-center justify-center w-7 h-7 rounded',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            'motion-safe:transition-colors motion-safe:duration-150',
            'text-text-muted hover:bg-spine-hover hover:text-text-primary',
          ].join(' ')}
        >
          <X size={14} />
        </button>

        {/* Separator */}
        <div className="w-px h-5 bg-border-subtle mx-1" aria-hidden="true" />

        {/* Inspector panel toggle (panel-right icon) */}
        <button
          type="button"
          aria-label={inspectorOpen ? t('shell.collapseInspector') : t('shell.expandInspector')}
          aria-pressed={inspectorOpen}
          onClick={onToggleInspector}
          className={[
            'flex items-center justify-center w-7 h-7 rounded',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            'motion-safe:transition-colors motion-safe:duration-150',
            inspectorOpen
              ? 'bg-accent/10 text-accent'
              : 'text-text-muted hover:bg-spine-hover hover:text-text-primary',
          ].join(' ')}
        >
          {/* Simple two-column SVG representing a panel-right layout */}
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="currentColor"
            aria-hidden="true"
          >
            <rect x="0" y="0" width="8" height="14" rx="1" opacity="0.4" />
            <rect x="10" y="0" width="4" height="14" rx="1" />
          </svg>
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Theme toggle — cycles System → Light → Dark → System.
// Icon reflects the CURRENT choice so the user sees what they last picked.
// ---------------------------------------------------------------------------

const THEME_CYCLE: Record<ThemeChoice, ThemeChoice> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
}

// ``as const`` keeps each value a literal member of MessageKey, so t() accepts
// it without importing the type.
const THEME_LABEL_KEYS = {
  system: 'shell.themeSystem',
  light: 'shell.themeLight',
  dark: 'shell.themeDark',
} as const

function ThemeToggle(): React.ReactElement {
  const t = useT()
  const { choice, setChoice } = useTheme()
  const next = THEME_CYCLE[choice]
  const Icon = choice === 'light' ? Sun : choice === 'dark' ? Moon : Laptop
  return (
    <button
      type="button"
      onClick={() => setChoice(next)}
      title={t('shell.themeToggleTitle', {
        current: t(THEME_LABEL_KEYS[choice]),
        next: t(THEME_LABEL_KEYS[next]).toLowerCase(),
      })}
      className={[
        'flex items-center justify-center w-7 h-7 rounded',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        'motion-safe:transition-colors motion-safe:duration-150',
        'text-text-muted hover:bg-spine-hover hover:text-text-primary',
      ].join(' ')}
    >
      <Icon size={14} />
    </button>
  )
}

// API-boot spinner gate — shown while waitForApi() is still pending.
//
// Extracted from App.tsx's ``if (!ready)`` early return (debt #12 R5).
// The early-return GUARD stays in App.tsx (Rules of Hooks); only the
// presentational JSX lives here.

/**
 * Full-screen "Starting Strix API…" spinner.
 *
 * Pure presentational — no props, no state. Rendered by App.tsx
 * between the boot-error gate and the project gate while
 * ``useAppBoot()`` reports ``!ready``.
 *
 * Returns
 * -------
 * JSX.Element
 *     The loading screen.
 */
import { useT } from '../i18n/translate'

export default function AppLoading(): JSX.Element {
  const t = useT()
  return (
    <div className="flex items-center justify-center h-screen bg-surface-app text-text-secondary text-sm gap-2">
      <div className="animate-spin rounded-full border-2 border-border-default border-t-accent w-5 h-5" />
      {t('app.starting')}
    </div>
  )
}

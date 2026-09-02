// Boot-failure gate screen — shown when the Python API never came up.
//
// Extracted from App.tsx's ``if (apiError)`` early return (debt #12
// R5). The early-return GUARD stays in App.tsx (it sits below all
// hook calls — moving it would violate the Rules of Hooks); only the
// presentational JSX lives here, so App.tsx reads as coordinator +
// a scannable render tree rather than inline gate markup.

/**
 * Full-screen "the API failed to start" message.
 *
 * Pure presentational — no props, no state. Rendered by App.tsx when
 * ``useAppBoot()`` reports ``apiError``.
 *
 * Returns
 * -------
 * JSX.Element
 *     The boot-error screen.
 */
import { useT } from '../i18n/translate'

export default function AppBootError(): JSX.Element {
  const t = useT()
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-surface-app text-text-secondary text-sm gap-2">
      <div className="text-status-danger font-medium">
        {t('app.bootFailedTitle')}
      </div>
      <div className="text-xs text-text-muted">
        {t('app.bootFailedBody')}
      </div>
    </div>
  )
}

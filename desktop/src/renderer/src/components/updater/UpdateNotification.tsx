// Update notification (prototype, debt #6).
//
// A bottom-right card that reflects the main-process updater's lifecycle: an
// available update offers Download / Later, a download shows progress, and a
// downloaded update offers Restart & install. Informational phases (up to date,
// disabled-in-dev, error) show a dismissable line — those only ever arrive after
// a manual Help → Check for updates (a dev launch never auto-checks).
//
// Self-subscribes to window.electron.onUpdaterEvent so App stays lean; App only
// wires the manual-check menu signal to window.electron.checkForUpdates(). All
// the real update machinery is gated on app.isPackaged in main, so this is inert
// in dev except for the "disabled" acknowledgement. See the design note.
//
// Reachable in EVERY renderer state (owner finding 2026-10-08: 0.1.4 over a
// 0.1.5 store showed no update prompt, because the card was mounted only in the
// welcome and project branches and a backend that never became ready never
// reaches them). App mounts it in every branch; switching branches remounts it,
// so on mount it PULLS the latched answer (``getLastUpdaterEvent``) besides the
// push subscription, and it remembers a "Later" across those remounts. It
// renders through a portal on document.body at the int32-max z-index, above the
// dialogs (Modal / BackendFailedModal sit one below): on a fatal start failure
// the update is the way out.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, RefreshCw, X } from 'lucide-react'

import Button from '../ui/Button'
import { useT } from '../../i18n/translate'
import type { MessageKey } from '../../i18n/locales/en'
import { log } from '../../utils/log'
import type { UpdaterErrorReasonDto, UpdaterEventDto } from '../../utils/launchPrototypeTypes'

/** Phases that render a dismissable one-line acknowledgement rather than a card. */
const INFO_PHASES = new Set<UpdaterEventDto['phase']>([
  'not-available',
  // The feed has nothing published yet — calm, not a failure (finding g).
  'no-release',
  'disabled',
  'error',
  'checking',
])

/**
 * The message a FAILED check shows, by named cause (finding g). Absent /
 * unknown reasons fall back to the generic ``updater.error`` line.
 */
const ERROR_REASON_KEY: Record<UpdaterErrorReasonDto, MessageKey> = {
  offline: 'updater.errorOffline',
  blocked: 'updater.errorBlocked',
  unexpected: 'updater.errorUnexpected',
}

/** Identity of an event for the remembered "Later": phase + version + cause. */
function eventKey(event: UpdaterEventDto): string {
  return `${event.phase}|${event.notice?.version ?? ''}|${event.errorReason ?? ''}`
}

/**
 * The event the engineer last dismissed, kept at module level so a remount
 * (App switching render branches) does not re-show a PULLED copy of it. A fresh
 * PUSH (a manual check, a new phase) always shows, as before.
 */
let dismissedKey: string | null = null

/** Test-only: forget the remembered dismissal between tests. */
export function __resetUpdateNotificationDismissalForTests(): void {
  dismissedKey = null
}

/**
 * The floating update notification.
 *
 * Renders nothing until an updater event arrives (or after the user dismisses
 * the current one). Subscribes once on mount.
 */
export default function UpdateNotification(): JSX.Element | null {
  const t = useT()
  const [event, setEvent] = useState<UpdaterEventDto | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // A renderer running against an older preload lacks this channel — degrade
    // to no notifications rather than throwing on the boot path.
    if (typeof window.electron.onUpdaterEvent !== 'function') return undefined
    let pushed = false
    let mounted = true
    const off = window.electron.onUpdaterEvent((next: UpdaterEventDto) => {
      pushed = true
      setEvent(next)
      // Every fresh event re-surfaces the notification.
      setDismissed(false)
    })
    // The answer may have arrived before this mount (launch check during the
    // loading screen, a branch switch). Pull it; a push that lands first wins,
    // and a pulled copy of what the engineer dismissed stays dismissed.
    if (typeof window.electron.getLastUpdaterEvent === 'function') {
      window.electron
        .getLastUpdaterEvent()
        .then(latched => {
          if (!mounted || pushed || latched === null || latched === undefined) return
          if (eventKey(latched) === dismissedKey) return
          setEvent(latched)
        })
        .catch(err => log.warn('updater', 'could not read the latched update event', err))
    }
    return () => {
      mounted = false
      off()
    }
  }, [])

  if (event === null || dismissed || event.phase === 'idle') return null

  const dismiss = (): void => {
    dismissedKey = eventKey(event)
    setDismissed(true)
  }

  const handleDownload = (): void => {
    void window.electron.downloadUpdate().catch(err => log.warn('updater', 'download failed', err))
  }
  const handleRestart = (): void => {
    void window.electron.quitAndInstallUpdate().catch(err => log.warn('updater', 'quit-and-install failed', err))
  }

  const version = event.notice?.version ?? '—'

  return createPortal(
    <div
      className="fixed bottom-4 right-4 z-[2147483647] w-80 max-w-[92vw] rounded-lg border border-border-default bg-surface-overlay shadow-lg text-text-primary"
      data-testid="update-notification"
      role="status"
    >
      {event.phase === 'available' && (
        <div className="p-4">
          <div className="flex items-start gap-2 mb-2">
            <Download size={16} className="text-accent mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-semibold">{t('updater.availableTitle')}</div>
              <div className="text-xs text-text-secondary mt-0.5">
                {t('updater.availableBody', { version })}
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <Button variant="ghost" size="sm" onClick={dismiss}>
              {t('updater.later')}
            </Button>
            <Button variant="primary" size="sm" onClick={handleDownload} data-testid="update-download">
              {t('updater.download')}
            </Button>
          </div>
        </div>
      )}

      {event.phase === 'downloading' && (
        <div className="p-4">
          <div className="text-sm font-medium mb-2">
            {t('updater.downloading', { percent: event.progressPercent ?? 0 })}
          </div>
          <div className="h-1.5 rounded-full bg-surface-card overflow-hidden">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${Math.max(0, Math.min(100, event.progressPercent ?? 0))}%` }}
            />
          </div>
        </div>
      )}

      {event.phase === 'downloaded' && (
        <div className="p-4">
          <div className="flex items-start gap-2 mb-2">
            <RefreshCw size={16} className="text-accent mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-semibold">{t('updater.downloadedTitle')}</div>
              <div className="text-xs text-text-secondary mt-0.5">
                {t('updater.downloadedBody', { version })}
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <Button variant="ghost" size="sm" onClick={dismiss}>
              {t('updater.later')}
            </Button>
            <Button variant="primary" size="sm" onClick={handleRestart} data-testid="update-restart">
              {t('updater.restart')}
            </Button>
          </div>
        </div>
      )}

      {INFO_PHASES.has(event.phase) && (
        <div className="p-3 flex items-start gap-2">
          <div className="flex-1 text-xs text-text-secondary">
            {event.phase === 'checking' && t('updater.checking')}
            {event.phase === 'not-available' && t('updater.upToDate')}
            {event.phase === 'no-release' && t('updater.noReleaseYet')}
            {event.phase === 'disabled' && t('updater.disabled')}
            {event.phase === 'error' &&
              t(event.errorReason ? ERROR_REASON_KEY[event.errorReason] : 'updater.error')}
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label={t('updater.dismiss')}
            className="p-0.5 rounded text-text-muted hover:text-text-primary"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>,
    document.body,
  )
}

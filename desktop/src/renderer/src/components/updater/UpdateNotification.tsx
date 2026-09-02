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

import { useEffect, useState } from 'react'
import { Download, RefreshCw, X } from 'lucide-react'

import Button from '../ui/Button'
import { useT } from '../../i18n/translate'
import { log } from '../../utils/log'
import type { UpdaterEventDto } from '../../utils/launchPrototypeTypes'

/** Phases that render a dismissable one-line acknowledgement rather than a card. */
const INFO_PHASES = new Set<UpdaterEventDto['phase']>(['not-available', 'disabled', 'error', 'checking'])

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
    const off = window.electron.onUpdaterEvent((next: UpdaterEventDto) => {
      setEvent(next)
      // Every fresh event re-surfaces the notification.
      setDismissed(false)
    })
    return off
  }, [])

  if (event === null || dismissed || event.phase === 'idle') return null

  const dismiss = (): void => setDismissed(true)

  const handleDownload = (): void => {
    void window.electron.downloadUpdate().catch(err => log.warn('updater', 'download failed', err))
  }
  const handleRestart = (): void => {
    void window.electron.quitAndInstallUpdate().catch(err => log.warn('updater', 'quit-and-install failed', err))
  }

  const version = event.notice?.version ?? '—'

  return (
    <div
      className="fixed bottom-4 right-4 z-[2000] w-80 max-w-[92vw] rounded-lg border border-border-default bg-surface-overlay shadow-lg text-text-primary"
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
            {event.phase === 'disabled' && t('updater.disabled')}
            {event.phase === 'error' && t('updater.error')}
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
    </div>
  )
}

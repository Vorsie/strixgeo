// Licensing / activation screen (prototype, debt #3).
//
// Renders the current activation state and drives the mock flow: enter a key +
// Activate, Start free trial, Deactivate / transfer this device. It also carries
// a PROTOTYPE-ONLY "preview a state" row so the owner can see each screen (trial,
// active, offline grace, expired, clock problem, not activated) without waiting
// out a real clock.
//
// Everything behind the buttons is the main-process ActivationService running
// the mock issuer behind the ActivationRepository seam (no network, no crypto).
// Honours the owner rulings: 30-day offline grace, 1 device per Solo seat (so a
// deactivate/transfer flow exists), trial = a server-issued time-limited licence
// on the same path. See docs/design/onboarding-activation-updater-proto.md.

import { useCallback, useEffect, useState } from 'react'
import { KeyRound, ShieldCheck, X } from 'lucide-react'

import Modal from '../ui/Modal'
import Button from '../ui/Button'
import ConfirmDialog from '../ui/ConfirmDialog'
import { useT, type Translator } from '../../i18n/translate'
import { useLanguage } from '../../i18n/languageSelect'
import type { Language } from '../../i18n/i18n_constants'
import type { MessageKey } from '../../i18n/locales/en'
import { log } from '../../utils/log'
import type {
  ActivationActionResultDto,
  ActivationStatusDto,
  BuildInfoDto,
  IssueFailureCodeDto,
  LicenceStateDto,
} from '../../utils/launchPrototypeTypes'

interface Props {
  open: boolean
  onClose: () => void
  /**
   * When false the dialog is a non-dismissable start screen (owner ruling A):
   * the X is hidden and Esc / backdrop no-op, so a packaged build's blocked
   * verdict cannot be clicked past. Defaults to true (the Help dialog).
   */
  dismissable?: boolean
  /**
   * Fired whenever the activation status is (re)read or an action changes it.
   * The packaged start-screen gate uses this to unlock once the verdict is no
   * longer blocked. Absent for the ordinary Help dialog.
   */
  onStatusChange?: (status: ActivationStatusDto) => void
}

/** The i18n key for each state's label. */
const STATE_LABEL_KEY: Record<LicenceStateDto, MessageKey> = {
  unactivated: 'licensing.stateUnactivated',
  trial: 'licensing.stateTrial',
  active: 'licensing.stateActive',
  grace: 'licensing.stateGrace',
  expired: 'licensing.stateExpired',
  'clock-rollback': 'licensing.stateClockRollback',
  'device-mismatch': 'licensing.stateDeviceMismatch',
}

/** The i18n key for each issuer failure code. */
const ERROR_KEY: Record<IssueFailureCodeDto, MessageKey> = {
  unknown_key: 'licensing.errorUnknownKey',
  device_limit: 'licensing.errorDeviceLimit',
  already_trialled: 'licensing.errorAlreadyTrialled',
  unreachable: 'licensing.errorUnreachable',
}

/** Pill colour classes per state — green live, amber grace, red trouble, muted none. */
const STATE_PILL: Record<LicenceStateDto, string> = {
  unactivated: 'bg-surface-card text-text-secondary border-border-default',
  trial: 'bg-blue-50 text-blue-800 border-blue-200',
  active: 'bg-green-50 text-green-800 border-green-200',
  grace: 'bg-amber-50 text-amber-900 border-amber-200',
  expired: 'bg-red-50 text-red-800 border-red-200',
  'clock-rollback': 'bg-red-50 text-red-800 border-red-200',
  'device-mismatch': 'bg-red-50 text-red-800 border-red-200',
}

/** The states the prototype preview control can force. */
const PREVIEW_STATES: readonly LicenceStateDto[] = [
  'unactivated',
  'trial',
  'active',
  'grace',
  'expired',
  'clock-rollback',
  'device-mismatch',
]

/** Format an epoch-ms instant as a local date, or an em dash when absent. */
function formatDate(ms: number | null): string {
  if (ms === null) return '—'
  return new Date(ms).toLocaleDateString()
}

/**
 * Locale tag per app language for the LONG date form the build line uses
 * ("1 November 2026" / "1 november 2026"). en-GB rather than en-US so the day
 * leads, matching the owner's wording.
 */
const DATE_LOCALE: Record<Language, string> = {
  en: 'en-GB',
  nl: 'nl-BE',
}

/** Format an epoch-ms instant as a long local date ("1 November 2026"). */
function formatLongDate(ms: number, language: Language): string {
  return new Date(ms).toLocaleDateString(DATE_LOCALE[language], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/**
 * The build's own beta expiry stamp + git SHA (owner finding f).
 *
 * Sits directly under the status panel so the licence key's expiry and the
 * build's expiry read as one block: a tester can check both which build they
 * hold ("Beta build 60e282c4") and when it stops ("expires 1 November 2026").
 * A dev / unstamped build shows the "development build" line instead.
 */
function BuildInfoPanel({
  info,
  language,
  t,
}: {
  info: BuildInfoDto
  language: Language
  t: Translator
}): JSX.Element {
  const line =
    info.expiresAtMs !== null
      ? t('licensing.betaBuild', {
          sha: info.sha ?? '—',
          date: formatLongDate(info.expiresAtMs, language),
        })
      : t('licensing.buildUnstamped')
  return (
    <div
      className="text-xs text-text-secondary border-t border-border-subtle pt-3"
      data-testid="licensing-build-info"
    >
      <span className="text-text-muted">{t('licensing.buildHeading')}: </span>
      <span className="text-text-primary">{line}</span>
    </div>
  )
}

/** The status heading + day counts, rendered from a verdict. */
function StatusPanel({ status, t }: { status: ActivationStatusDto; t: Translator }): JSX.Element {
  const { verdict } = status
  const countLine =
    verdict.state === 'grace' && verdict.graceDaysRemaining !== null
      ? t('licensing.graceRemaining', { days: verdict.graceDaysRemaining })
      : verdict.daysRemaining !== null && verdict.daysRemaining > 0
        ? t('licensing.daysRemaining', { days: verdict.daysRemaining })
        : null

  return (
    <div className="rounded-lg border border-border-subtle p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium uppercase tracking-wide text-text-secondary">
          {t('licensing.statusHeading')}
        </span>
        <span
          data-testid="licensing-state-pill"
          className={`text-xs font-medium px-2 py-0.5 rounded-full border ${STATE_PILL[verdict.state]}`}
        >
          {t(STATE_LABEL_KEY[verdict.state])}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
        <dt className="text-text-muted">{t('licensing.tierLabel')}</dt>
        <dd className="text-text-primary text-right uppercase">{verdict.tier ?? '—'}</dd>
        <dt className="text-text-muted">{t('licensing.expiresLabel')}</dt>
        <dd className="text-text-primary text-right">{formatDate(verdict.expiresAtMs)}</dd>
      </dl>
      {countLine !== null && <p className="text-xs text-text-secondary mt-2">{countLine}</p>}
    </div>
  )
}

/**
 * The licensing / activation dialog.
 *
 * Parameters
 * ----------
 * open
 *     Whether the dialog is shown.
 * onClose
 *     Dismiss handler (X, Esc, backdrop).
 */
export default function LicensingDialog({
  open,
  onClose,
  dismissable = true,
  onStatusChange,
}: Props): JSX.Element {
  const t = useT()
  const language = useLanguage()
  const [status, setStatus] = useState<ActivationStatusDto | null>(null)
  // Build facts (git SHA + beta expiry) shown next to the licence expiry (finding f).
  const [buildInfo, setBuildInfo] = useState<BuildInfoDto | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Deactivate / transfer is irreversible (it frees the seat on the server), so
  // the button opens a confirmation instead of firing (docs/ux.md).
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)

  // The prototype-only "Preview a state" control never ships in a packaged build
  // (senior review SHOULD-FIX 1) — mirrors previewControlAllowed(app.isPackaged)
  // in the main process, which also withholds the backing IPC when packaged.
  const previewAllowed = !window.electron.launchFlags.packaged

  const refresh = useCallback(async () => {
    try {
      const next = (await window.electron.getActivationStatus()) as ActivationStatusDto
      setStatus(next)
    } catch (err) {
      log.warn('licensing', 'could not read activation status', err)
    }
  }, [])

  // Read the current status each time the dialog opens.
  useEffect(() => {
    if (open) {
      setError(null)
      setNotice(null)
      void refresh()
      // Build facts (finding f) — the beta expiry stamp + git SHA. Optional on
      // the bridge, so a renderer against an older preload simply hides the
      // block rather than throwing on the open path.
      const buildInfoPromise = window.electron.getBuildInfo?.()
      if (buildInfoPromise) {
        void buildInfoPromise
          .then(info => setBuildInfo((info as BuildInfoDto | null) ?? null))
          .catch(err => log.warn('licensing', 'could not read build info', err))
      }
    }
  }, [open, refresh])

  // Report every status change so the packaged start-screen gate can unlock once
  // the verdict is no longer blocked (owner ruling A).
  useEffect(() => {
    if (status !== null) onStatusChange?.(status)
  }, [status, onStatusChange])

  /** Run an activation action, then reflect its result (status or error). */
  const runAction = useCallback(
    async (action: () => Promise<ActivationActionResultDto>, successKey: MessageKey) => {
      if (busy) return
      setBusy(true)
      setError(null)
      setNotice(null)
      try {
        const result = await action()
        if (result.ok) {
          setStatus(result.status)
          setNotice(t(successKey))
        } else {
          setError(t(ERROR_KEY[result.code]))
        }
      } catch (err) {
        log.warn('licensing', 'activation action failed', err)
        setError(t('licensing.errorUnreachable'))
      } finally {
        setBusy(false)
      }
    },
    [busy, t],
  )

  const handleActivate = (): void => {
    void runAction(
      () => window.electron.activateLicence(keyInput.trim()) as Promise<ActivationActionResultDto>,
      'licensing.toastActivated',
    )
  }
  const handleTrial = (): void => {
    void runAction(
      () => window.electron.startTrial() as Promise<ActivationActionResultDto>,
      'licensing.toastTrialStarted',
    )
  }
  // Only reached after the user confirms the irreversible deactivate.
  const handleDeactivateConfirmed = (): void => {
    setConfirmDeactivate(false)
    void runAction(
      () => window.electron.deactivateLicence() as Promise<ActivationActionResultDto>,
      'licensing.toastDeactivated',
    )
  }

  const handlePreview = (state: LicenceStateDto): void => {
    if (busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    void window.electron
      .previewActivationState(state)
      .then(next => setStatus(next as ActivationStatusDto))
      .catch(err => log.warn('licensing', 'preview-state failed', err))
      .finally(() => setBusy(false))
  }

  const activated = status !== null && status.verdict.state !== 'unactivated'

  return (
    <>
    <Modal
      open={open}
      // A non-dismissable start screen swallows Esc / backdrop so a blocked
      // packaged build cannot be clicked past.
      onCancel={dismissable ? onClose : () => {}}
      busy={busy}
      labelledBy="licensing-title"
      cardClassName="w-[480px] max-w-[92vw] max-h-[88vh] flex flex-col"
      testid="licensing-dialog"
    >
      <div className="flex flex-col min-h-0">
        <div className="px-6 pt-5 pb-3 border-b border-border-subtle flex items-center gap-2">
          <ShieldCheck size={16} className="text-text-muted" />
          <h2 id="licensing-title" className="text-base font-semibold text-text-primary flex-1">
            {t('licensing.title')}
          </h2>
          {dismissable && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close')}
              className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-card"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <div className="px-6 py-4 overflow-y-auto flex flex-col gap-4">
          {status !== null && <StatusPanel status={status} t={t} />}

          {/* The build's own beta expiry stamp + git SHA (finding f), next to
              the licence expiry above so both read as one block. */}
          {buildInfo !== null && <BuildInfoPanel info={buildInfo} language={language} t={t} />}

          {/* Inline feedback — self-contained so the dialog works in both the
              welcome and loaded-project branches, where the toast host differs. */}
          {error !== null && (
            <div role="alert" className="text-sm text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </div>
          )}
          {notice !== null && (
            <div className="text-sm text-green-800 bg-green-50 border border-green-200 rounded px-3 py-2">
              {notice}
            </div>
          )}

          {/* Activate with a key. */}
          <div>
            <label htmlFor="licensing-key" className="block text-xs font-medium text-text-secondary mb-1">
              {t('licensing.enterKey')}
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <KeyRound
                  size={14}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
                />
                <input
                  id="licensing-key"
                  type="text"
                  value={keyInput}
                  onChange={e => setKeyInput(e.target.value)}
                  disabled={busy}
                  data-testid="licensing-key-input"
                  placeholder="STRIX-SOLO-DEMO"
                  className="w-full border border-border-default rounded pl-8 pr-3 py-1.5 text-sm bg-surface-overlay text-text-primary font-mono placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
              <Button
                variant="primary"
                size="md"
                disabled={busy || keyInput.trim() === ''}
                onClick={handleActivate}
                data-testid="licensing-activate"
              >
                {t('licensing.activate')}
              </Button>
            </div>
            <p className="text-[11px] text-text-muted mt-1.5">{t('licensing.demoKeysHint')}</p>
          </div>

          {/* Trial + deactivate. */}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="md" disabled={busy} onClick={handleTrial} data-testid="licensing-trial">
              {t('licensing.startTrial')}
            </Button>
            {activated && (
              <Button
                variant="secondary"
                size="md"
                disabled={busy}
                onClick={() => setConfirmDeactivate(true)}
                data-testid="licensing-deactivate"
              >
                {t('licensing.deactivate')}
              </Button>
            )}
          </div>
          {activated && <p className="text-[11px] text-text-muted -mt-2">{t('licensing.deactivateHint')}</p>}

          {/* Device row. */}
          {status !== null && (
            <div className="text-xs text-text-secondary border-t border-border-subtle pt-3">
              <span className="text-text-muted">{t('licensing.deviceHeading')}: </span>
              <span className="text-text-primary">{status.deviceLabel}</span>
              {status.keyMasked !== null && (
                <span className="font-mono text-text-muted"> · {status.keyMasked}</span>
              )}
            </div>
          )}

          {/* PROTOTYPE-ONLY preview control — dev builds only (SHOULD-FIX 1). A
              packaged build hides the row AND the main process withholds the
              backing activation:preview-state IPC. */}
          {previewAllowed && (
            <div className="border-t border-dashed border-border-default pt-3" data-testid="licensing-preview-row">
              <div className="text-[11px] font-medium uppercase tracking-wide text-text-muted mb-2">
                {t('licensing.previewHeading')}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {PREVIEW_STATES.map(state => (
                  <button
                    key={state}
                    type="button"
                    disabled={busy}
                    onClick={() => handlePreview(state)}
                    data-testid={`licensing-preview-${state}`}
                    className="text-[11px] px-2 py-1 rounded border border-border-default text-text-secondary hover:bg-surface-card disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {t(STATE_LABEL_KEY[state])}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>

    {/* Irreversible-action guard: freeing the seat on the server cannot be
        undone locally, so Cancel is default-focused and the action button names
        the action (docs/ux.md "Reversible vs irreversible"). */}
    <ConfirmDialog
      open={confirmDeactivate}
      labelledBy="licensing-deactivate-confirm-title"
      title={t('licensing.deactivateConfirmTitle')}
      body={t('licensing.deactivateConfirmBody')}
      confirm={{
        label: t('licensing.deactivateConfirmAction'),
        onClick: handleDeactivateConfirmed,
        variant: 'danger',
        testid: 'licensing-deactivate-confirm',
      }}
      cancelTestid="licensing-deactivate-cancel"
      onCancel={() => setConfirmDeactivate(false)}
      busy={busy}
      testid="licensing-deactivate-dialog"
    />
    </>
  )
}

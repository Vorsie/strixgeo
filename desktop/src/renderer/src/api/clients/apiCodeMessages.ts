// User copy for the backend's machine-readable ``detail.code`` values that an
// engineer can hit in normal use (audit follow-up: the server's English text
// used to show verbatim in a Dutch app). Unknown codes fall through to the
// server message, so this is additive — a new backend code never breaks a
// toast, it just stays untranslated until a key lands here.
import type { Language } from '../../i18n/i18n_constants'
import { t, translate } from '../../i18n/translate'

const CODE_KEYS = {
  dov_import_too_large: 'api.code.dovImportTooLarge',
  dov_import_already_running: 'api.code.dovImportAlreadyRunning',
  body_partition_locked: 'api.code.bodyPartitionLocked',
  lock_timeout: 'api.code.lockTimeout',
} as const

type KnownCode = keyof typeof CODE_KEYS

function isKnownCode(code: string): code is KnownCode {
  return Object.prototype.hasOwnProperty.call(CODE_KEYS, code)
}

/**
 * The translated message for a known ``detail.code``, or ``null`` to keep the
 * server text. ``language`` overrides the app language (tests, previews).
 */
export function messageForApiCode(code: string | null | undefined, language?: Language): string | null {
  if (!code || !isKnownCode(code)) return null
  return language ? translate(language, CODE_KEYS[code]) : t(CODE_KEYS[code])
}

/**
 * The message to show for a FastAPI ``detail`` payload: a translated text for a
 * known code, else the server's ``message`` (object shape) or the bare string.
 */
export function messageForDetail(detail: unknown, fallback: string, language?: Language): string {
  if (typeof detail === 'string') return detail
  if (detail && typeof detail === 'object') {
    const d = detail as { code?: unknown; message?: unknown }
    const known = typeof d.code === 'string' ? messageForApiCode(d.code, language) : null
    if (known) return known
    if (typeof d.message === 'string') return d.message
  }
  return fallback
}

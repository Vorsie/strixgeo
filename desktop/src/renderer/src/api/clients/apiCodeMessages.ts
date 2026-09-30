// User copy for the backend's machine-readable ``detail.code`` values that an
// engineer can hit in normal use (audit follow-up: the server's English text
// used to show verbatim in a Dutch app). Unknown codes fall through to the
// server message, so this is additive — a new backend code never breaks a
// toast, it just stays untranslated until a key lands here.
import type { Language } from '../../i18n/i18n_constants'
import { t, translate } from '../../i18n/translate'
import type { MessageKey } from '../../i18n/locales/en'

const CODE_KEYS = {
  dov_import_too_large: 'api.code.dovImportTooLarge',
  cpt_pdf_report_unknown: 'api.code.cptPdfReportUnknown',
  dov_import_already_running: 'api.code.dovImportAlreadyRunning',
  body_partition_locked: 'api.code.bodyPartitionLocked',
  lock_timeout: 'api.code.lockTimeout',
  dov_unreachable: 'api.code.dovUnreachable',
  lab_borehole_conflict: 'api.code.labBoreholeConflict',
} as const

// Codes whose copy names one field of the ``detail`` (``{name}`` in the
// message). When the backend sent no such field, the ``*Unnamed`` key is used
// so the engineer never reads a bare placeholder.
const NAMED_FIELD: Partial<Record<KnownCode, { field: string; unnamedKey: MessageKey }>> = {
  lab_borehole_conflict: { field: 'borehole_name', unnamedKey: 'api.code.labBoreholeConflictUnnamed' },
}

type KnownCode = keyof typeof CODE_KEYS

function isKnownCode(code: string): code is KnownCode {
  return Object.prototype.hasOwnProperty.call(CODE_KEYS, code)
}

/**
 * The translated message for a known ``detail.code``, or ``null`` to keep the
 * server text. ``language`` overrides the app language (tests, previews);
 * ``detail`` supplies the field a named message interpolates (``NAMED_FIELD``).
 */
export function messageForApiCode(
  code: string | null | undefined,
  language?: Language,
  detail?: Readonly<Record<string, unknown>>,
): string | null {
  if (!code || !isKnownCode(code)) return null
  let key: MessageKey = CODE_KEYS[code]
  let params: Record<string, string> | undefined
  const named = NAMED_FIELD[code]
  if (named) {
    const value = detail?.[named.field]
    if (typeof value === 'string' && value !== '') params = { name: value }
    else key = named.unnamedKey
  }
  return language ? translate(language, key, params) : t(key, params)
}

/**
 * The message to show for a FastAPI ``detail`` payload.
 *
 * A ``detail`` arrives in three shapes: a bare string (a plain ``HTTPException``
 * refusal), a ``{code, message}`` object (our machine-readable guards), or — on
 * a 422 request-validation failure — a LIST of ``{loc, msg, type}`` entries. The
 * list shape was previously unhandled, so a refused DOV import box fell straight
 * to the ``HTTP 422`` fallback; now it reads as the validator's own sentence
 * ("bounding box east ... must be greater than west ..."), or ``field: message``
 * for a field-constraint error, so the engineer can act on it.
 *
 * Parameters
 * ----------
 * detail : unknown
 *     The ``detail`` field of a non-2xx response body.
 * fallback : str
 *     Shown only when ``detail`` carries no usable message.
 * language : Language, optional
 *     Overrides the app language when resolving a known ``code``.
 *
 * Returns
 * -------
 * str
 *     A human-readable message; ``fallback`` when none can be derived.
 */
export function messageForDetail(detail: unknown, fallback: string, language?: Language): string {
  if (typeof detail === 'string') return detail
  // A FastAPI validation error is a list of {loc, msg, type}. Checked before
  // the object branch because an array is also ``typeof === 'object'``.
  if (Array.isArray(detail)) {
    return messageForValidationErrors(detail) ?? fallback
  }
  if (detail && typeof detail === 'object') {
    const d = detail as { code?: unknown; message?: unknown }
    const known =
      typeof d.code === 'string'
        ? messageForApiCode(d.code, language, detail as Record<string, unknown>)
        : null
    if (known) return known
    if (typeof d.message === 'string') return d.message
  }
  return fallback
}

/**
 * Turn a FastAPI 422 validation-error list into one readable sentence.
 *
 * Reads the first entry only — the schema validators here raise on the first
 * problem, so the first entry is the actionable one. A model-level validator
 * (``@model_validator``) reports its ``ValueError`` text with a pydantic-added
 * ``"Value error, "`` prefix and a ``loc`` of just ``["body"]``; that prefix is
 * stripped and the sentence shown alone. A field-constraint error carries the
 * field path in ``loc`` (e.g. ``["body", "north"]``) and is shown as
 * ``"north: <message>"``; a nested key shows its dotted path.
 *
 * Parameters
 * ----------
 * errors : unknown[]
 *     The ``detail`` array from a 422 body.
 *
 * Returns
 * -------
 * str | null
 *     The message, or ``null`` when the list is empty or the first entry has no
 *     ``msg`` string (so the caller uses its fallback).
 */
function messageForValidationErrors(errors: unknown[]): string | null {
  const first = errors[0] as { loc?: unknown; msg?: unknown } | undefined
  if (!first || typeof first.msg !== 'string') return null
  // pydantic prefixes a raised ValueError with "Value error, " — an internal
  // detail the engineer should never see.
  const msg = first.msg.replace(/^Value error,\s*/i, '')
  // The field path is every ``loc`` segment after the request-body envelope
  // pydantic wraps each field in, dotted: a nested key reads as
  // ``view_state.borehole_channels.lithology``, which names WHERE the input
  // was refused (the last segment alone, "lithology", sent the reader to the
  // wrong schema on 2026-09-22). A model-level validator has no field segment
  // (loc is just ["body"]), so the sentence stands alone.
  const loc = Array.isArray(first.loc) ? first.loc : []
  const field = loc.filter(s => typeof s === 'string' && s !== 'body' && s !== 'query').join('.')
  return field ? `${field}: ${msg}` : msg
}

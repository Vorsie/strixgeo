/**
 * Tunables for the diagnostics uploader (Electron main process) — debt #16,
 * transmit half.
 *
 * One place for every dial the uploader turns: the endpoint path, the payload
 * size cap, the on-disk queue bound, the retry backoff and the drain cadence.
 * They live here rather than inline so the values are a single source of truth
 * and a reviewer can read the whole transmit policy without opening the logic.
 *
 * The uploader speaks the ``POST /v1/diagnostics`` contract documented in
 * ``docs/design/activation-api-contract.md`` and sends to the SAME origin as the
 * activation client (owner ruling 2026-08-31: "diagnostics go to the same
 * server"), so the base URL comes from ``activationConfig.ts`` — this file adds
 * only the path suffix and the transmit-side tunables.
 */

/**
 * Path appended to the activation base URL to reach the diagnostics endpoint.
 *
 * Versioned (``v1/``) on purpose: the diagnostics payload is a richer, newer
 * shape than the sibling activation endpoints and is the field most likely to
 * grow, so it carries its own version segment. Joined as
 * ``<activationBaseUrl>/v1/diagnostics`` — e.g.
 * ``https://strixgeo.com/api/activation/v1/diagnostics``.
 */
export const DIAGNOSTICS_UPLOAD_PATH = 'v1/diagnostics'

/**
 * Hard cap on one uploaded payload, bytes of UTF-8 JSON.
 *
 * 512 KiB is far more than any single support question needs and small enough
 * that a beta tester on a poor link is never asked to push a large body. The
 * client trims the NDJSON tail (oldest lines first) until the whole payload fits
 * and stamps ``truncated: true`` so the server knows the head was dropped.
 */
export const DIAGNOSTICS_MAX_PAYLOAD_BYTES = 512 * 1024

/**
 * Most bundles kept on disk at once.
 *
 * The queue is a durable outbox: a bundle survives a restart until it is
 * accepted (2xx), refused (4xx), or evicted as the oldest when a 21st arrives.
 * 20 bounds the directory so a permanently-offline machine cannot fill the disk;
 * the oldest is the least useful, so it is the one dropped.
 */
export const DIAGNOSTICS_QUEUE_MAX = 20

/** Sub-directory of the diagnostics dir that holds the queued bundles. */
export const DIAGNOSTICS_QUEUE_DIR_NAME = 'outbox'

/** Name of the high-water file that records which events have already been queued. */
export const DIAGNOSTICS_HIGHWATER_FILENAME = 'highwater.json'

/** Per-request timeout, ms. Matches the activation client's ceiling. */
export const DIAGNOSTICS_UPLOAD_TIMEOUT_MS = 10_000

/**
 * First backoff step after a kept (5xx / network) bundle, ms.
 *
 * A server fault or a dead link affects every bundle equally, so the drain stops
 * on the first kept bundle and waits at least this long before trying again,
 * doubling each consecutive failure up to {@link DIAGNOSTICS_RETRY_MAX_MS}.
 */
export const DIAGNOSTICS_RETRY_BASE_MS = 60_000

/** Ceiling on the exponential backoff, ms (1 hour). */
export const DIAGNOSTICS_RETRY_MAX_MS = 60 * 60_000

/**
 * Cadence for a routine drain while the queue is non-empty and healthy, ms.
 *
 * Used when the previous drain made progress (or on the first run); a failing
 * drain switches to the {@link DIAGNOSTICS_RETRY_BASE_MS} backoff instead. When
 * the queue empties the timer stops entirely — the uploader does nothing until a
 * new bundle is enqueued.
 */
export const DIAGNOSTICS_DRAIN_INTERVAL_MS = 15 * 60_000

/**
 * Whether an uploaded bundle carries the device's licence key + device id when
 * an activation exists.
 *
 * ``false`` today, deliberately. The capture design
 * (``docs/design/diagnostics-capture.md``) states, and its tests pin, that a
 * diagnostics record carries "no session id, no device id and no counter of any
 * kind". Attaching identity to the transmit payload reverses that shipped,
 * tested invariant — a real privacy-posture decision the owner has not ruled on
 * (the ``POST /v1/diagnostics`` contract lists the fields as optional for
 * exactly this reason). The plumbing is built and gated behind this one flag:
 * flip it to ``true`` in the same change that records the ruling, and identity
 * is attached whenever a licence is present.
 */
export const ATTACH_ACTIVATION_IDENTITY_TO_DIAGNOSTICS = false

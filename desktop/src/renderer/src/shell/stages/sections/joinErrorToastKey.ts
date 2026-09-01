import { apiErrorDetail } from '../../../api/clients/shared'

/**
 * The three catalogue keys a failed body-Join can toast.
 *
 * Only ``crossClass`` fires in practice: after the owner removed the Separate /
 * Rejoin verbs (2026-09-01) the backend no longer raises
 * ``body_union_contradicts_separation``, but the mapping keeps a defensive branch
 * for it so a legacy build (or a replayed error) still maps to a translated line
 * rather than the raw English ``detail.message``.
 */
export type JoinErrorToastKey =
  | 'sections.join.crossClass'
  | 'sections.join.blockedSeparation'
  | 'sections.join.failed'

/**
 * Map a failed ``createBodyUnion`` rejection to a translation KEY.
 *
 * Dutch mode must never show the backend's English ``detail.message`` verbatim,
 * so the Join catch block reads the structured guard ``code`` (via
 * :func:`apiErrorDetail`) and translates it here. Returning the key — not the
 * translated string — keeps this pure and testable without an ``i18n`` instance;
 * the caller wraps it in ``t(...)``.
 *
 * @param err - The caught rejection from ``createBodyUnion``.
 * @returns The catalogue key for the toast: the cross-class guard, the defensive
 *   standing-separation guard, or a generic failure fallback.
 */
export function joinErrorToastKey(err: unknown): JoinErrorToastKey {
  const code = apiErrorDetail(err)?.code
  if (code === 'body_union_cross_class') return 'sections.join.crossClass'
  if (code === 'body_union_contradicts_separation') return 'sections.join.blockedSeparation'
  return 'sections.join.failed'
}

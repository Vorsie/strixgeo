import { apiErrorDetail } from '../../../api/clients/shared'

/**
 * The catalogue keys a failed body-Join can toast.
 *
 * A cross-class refusal now splits by whether the two SOILS differ (owner ruling
 * 2026-09-01): same soil + different NAD packing class → ``crossPacking``;
 * different soil → ``crossLitho``. The old always-"packing" ``crossClass`` line
 * was wrong when the real difference was lithology (SILT vs ZAND).
 *
 * ``blockedSeparation`` no longer fires (the Separate verb was removed 2026-09-01)
 * but the branch is kept defensive so a legacy build / replayed error still maps
 * to a translated line rather than the raw English ``detail.message``.
 */
export type JoinErrorToastKey =
  | 'sections.join.crossPacking'
  | 'sections.join.crossLitho'
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
 * The ``body_union_cross_class`` 422 carries ``soil_a`` / ``soil_b``; when they
 * are equal the two bodies differ only by packing class (``crossPacking``),
 * otherwise the lithologies themselves differ (``crossLitho``). A missing / non-
 * string soil cannot prove same-soil, so it falls to ``crossLitho`` — the broader
 * statement — rather than falsely claiming a mere packing difference.
 *
 * @param err - The caught rejection from ``createBodyUnion``.
 * @returns The catalogue key for the toast: the packing-vs-lithology cross-class
 *   guard, the defensive standing-separation guard, or a generic failure fallback.
 */
export function joinErrorToastKey(err: unknown): JoinErrorToastKey {
  const detail = apiErrorDetail(err)
  const code = detail?.code
  if (code === 'body_union_cross_class') {
    const sameSoil = typeof detail?.soil_a === 'string' && detail.soil_a === detail.soil_b
    return sameSoil ? 'sections.join.crossPacking' : 'sections.join.crossLitho'
  }
  if (code === 'body_union_contradicts_separation') return 'sections.join.blockedSeparation'
  return 'sections.join.failed'
}

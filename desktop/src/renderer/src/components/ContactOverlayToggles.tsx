// Two on/off switches for the Data-stage detail-pane contact overlays.
//
// Owner 2026-10-04: "make it so that i can turn off lithological boundaries
// and stratigraphic boundaries". Rendered in the controls row of CptChart and
// BoreholeLog, next to the DOV overlay button and in the same pill style, so
// the pane keeps one consistent row of overlay switches. Reversible view
// choice: a click fires at once, no confirmation.

import { useT } from '../i18n/translate'
import type { MessageKey } from '../i18n/locales/en'
import type { ContactOverlay, ContactOverlayVisibility } from '../utils/contactOverlays'

/** Props of ``ContactOverlayToggles``. */
export interface ContactOverlayTogglesProps {
  /** Current per-source switches. */
  visibility: Readonly<ContactOverlayVisibility>
  /** Flip one source; the caller owns the state. */
  onToggle: (source: ContactOverlay['source']) => void
}

const SWITCHES: readonly { source: ContactOverlay['source']; labelKey: MessageKey }[] = [
  { source: 'geology', labelKey: 'borelog.stratigraphicBoundaries' },
  { source: 'litho', labelKey: 'borelog.lithologicalBoundaries' },
]

/**
 * Pill buttons that show / hide the stratigraphic (geology) and the
 * lithological (litho) boundary lines on a detail chart.
 *
 * @param props See ``ContactOverlayTogglesProps``.
 * @returns     Two ``aria-pressed`` toggle buttons.
 */
export function ContactOverlayToggles({
  visibility,
  onToggle,
}: ContactOverlayTogglesProps): JSX.Element {
  const t = useT()
  return (
    <>
      {SWITCHES.map(({ source, labelKey }) => {
        const on = visibility[source]
        return (
          <button
            key={source}
            type="button"
            onClick={() => onToggle(source)}
            aria-pressed={on}
            title={t(labelKey)}
            className={
              'flex items-center gap-1 px-2 h-6 rounded border text-[10px] whitespace-nowrap transition-colors ' +
              (on
                ? 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700'
                : 'border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700')
            }
          >
            {t(labelKey)}
          </button>
        )
      })}
    </>
  )
}

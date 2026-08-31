/**
 * The two lab-sample view toggles, as toolbar menu items.
 *
 * The sample markers and their grain-size hover card draw on the
 * lithostratigraphic AND geotechnical axes, so both switches have to be
 * reachable from both axes' view menus — the geotech axis's "Display" menu and
 * the litho axis's "Bodies" menu. That is two identical item blocks, so they
 * live here once ("extract on the second copy") rather than being pasted into
 * each menu array.
 *
 * The two menus differ only in icon size and testid prefix, both parameters.
 */

import { Eye, EyeOff } from 'lucide-react'

import type { ToolbarDropdownItem } from '../../ToolbarPrimitives'
import { toggleSampleMarkersOn } from '../../../utils/sampleMarkersOnStore'
import { togglePsdPreviewOn } from '../../../utils/psdPreviewOnStore'
import type { Translator } from '../../../i18n/translate'

/** Inputs a caller menu supplies to render the pair. */
export interface SampleDisplayMenuItemsInput {
  /** Active-language translator, threaded from the caller so a language flip
   *  re-renders both items in one pass. */
  t: Translator
  /** Current "Show samples" state, read by the caller's own store hook. */
  sampleMarkersOn: boolean
  /** Current "PSD preview on hover" state. */
  psdPreviewOn: boolean
  /** Testid prefix — ``'geotech'`` or ``'litho'``. */
  testidPrefix: string
  /** Icon pixel size; the Display menu uses 13, the Bodies menu 12. */
  iconSize: number
}

/**
 * Build the sample-marker and grain-size-preview toggle items.
 *
 * The dropdown primitive has no checkmark, so — like every sibling toggle in
 * these menus — the item's own label names the state the click will move to.
 *
 * @param input - Current toggle states plus the caller menu's cosmetics.
 * @returns The two items, in display order.
 */
export function sampleDisplayMenuItems({
  t,
  sampleMarkersOn,
  psdPreviewOn,
  testidPrefix,
  iconSize,
}: SampleDisplayMenuItemsInput): ToolbarDropdownItem[] {
  return [
    {
      label: sampleMarkersOn ? t('sections.samples.hide') : t('sections.samples.show'),
      icon: sampleMarkersOn ? <EyeOff size={iconSize} /> : <Eye size={iconSize} />,
      // The bare-P hook dispatches this key — hint only.
      shortcutHint: 'p',
      onClick: () => toggleSampleMarkersOn(),
      title: t('sections.toolbar.sampleMarkersHint'),
      testid: `${testidPrefix}-toggle-samples`,
    },
    {
      label: psdPreviewOn ? t('sections.samples.hidePsd') : t('sections.samples.showPsd'),
      icon: psdPreviewOn ? <EyeOff size={iconSize} /> : <Eye size={iconSize} />,
      onClick: () => togglePsdPreviewOn(),
      title: t('sections.toolbar.psdCardHint'),
      testid: `${testidPrefix}-toggle-psd-preview`,
    },
  ]
}

/**
 * Tests for the Geotechnical settings section's conditional Save-validity logic.
 *
 * The section is the first with a sub-field gated by a checkbox, so the
 * `allValid` short-circuit (snap-window validity is irrelevant when gradient
 * snap is OFF) is genuinely new behaviour worth pinning — flagged in the
 * code-quality review of the section's introduction.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GeotechSection } from './SettingsDialog'
import {
  GEOTECH_SUBDIVISION_DEFAULTS,
  type GeotechSubdivisionPrefs,
} from '../utils/geotechSubdivisionPrefs'

function renderSection(draft: Partial<GeotechSubdivisionPrefs>) {
  const onSubmit = vi.fn()
  render(
    <GeotechSection
      draft={{ ...GEOTECH_SUBDIVISION_DEFAULTS, ...draft }}
      setDraft={() => {}}
      initial={GEOTECH_SUBDIVISION_DEFAULTS}
      hasProject={true}
      onSubmit={onSubmit}
    />,
  )
  return { onSubmit, saveButton: () => screen.getByTestId('settings-save-button') }
}

describe('GeotechSection conditional validity', () => {
  it('hides the snap-window field when gradient snap is off', () => {
    renderSection({ gradientSnapEnabled: false })
    expect(screen.queryByLabelText(/Gradient snap window/i)).toBeNull()
  })

  it('shows the snap-window field when gradient snap is on', () => {
    renderSection({ gradientSnapEnabled: true })
    expect(screen.getByText(/Gradient snap window/i)).toBeTruthy()
  })

  it('Save stays enabled when snap is OFF even if the (hidden) snap window is out of range', () => {
    // dirty (window 99 != default 0.5), thickness valid, snap off → window check skipped.
    const { saveButton } = renderSection({
      gradientSnapEnabled: false,
      gradientSnapWindowM: 99,
    })
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false)
  })

  it('Save is disabled when snap is ON and the snap window is out of range', () => {
    const { saveButton } = renderSection({
      gradientSnapEnabled: true,
      gradientSnapWindowM: 99,
    })
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true)
  })

  it('Save is disabled when the min thickness is out of range, regardless of snap', () => {
    const { saveButton } = renderSection({ minimumLayerThicknessM: 99 })
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true)
  })

  it('Save calls onSubmit when a valid edit makes the draft dirty', () => {
    const { onSubmit, saveButton } = renderSection({ minimumLayerThicknessM: 0.5 })
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(saveButton())
    expect(onSubmit).toHaveBeenCalledOnce()
  })
})

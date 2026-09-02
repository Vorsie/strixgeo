/**
 * The question the geotech "Build model" press asks when a test in the model
 * has no packing bands yet.
 *
 * Owner ruling 2026-08-26: *"yes that suggestion is fine, these 2 tests… but
 * ofcourse make it so that user can go to those test through one click. Build
 * without them should produce the model that was there before the added tests,
 * so just plain ignore them."* — serving *"I can't have gaps or fallbacks in
 * the model unless users make mistakes."*
 *
 * Three things this dialog is deliberately NOT:
 *
 * * It is not a warning that fires on a finished model. ``geotechBuildPreflight``
 *   returns nothing when every test in the model is banded, and the caller only
 *   opens the dialog on a non-empty result — so today, on a complete model,
 *   Build behaves exactly as it always has.
 * * It is not destructive, so Cancel is NOT default-focused. The
 *   docs/ux.md rule that puts focus on Cancel is about irreversible actions
 *   (a delete, a send); here every button is a build the engineer can redo, and
 *   the one he wants nine times out of ten is the default.
 * * It is not a list of names. Every name is a BUTTON, because the ask was
 *   one-click access to the test itself, and a name he has to go hunt for is
 *   the state he was already in.
 */

import { useEffect, useRef } from 'react'

import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import { useT } from '../../../i18n/translate'
import type { UnbandedTest } from '../../../utils/geotechBuildPreflight'

/** Props: what the pre-flight found, and the three ways out of it. */
export interface Props {
  /** Truthy = render. The caller owns the open lifecycle. */
  open: boolean
  /** Tests in the model with accepted litho and no packing bands. */
  tests: readonly UnbandedTest[]
  /** Go to this test: switch to Sections, open a section carrying it, pulse it. */
  onVisitTest: (test: UnbandedTest) => void
  /** DEFAULT — subdivide the listed tests, then build. */
  onSubdivideAndBuild: () => void
  /** Build ignoring them entirely, reproducing the pre-import model. */
  onBuildWithout: () => void
  /** Close without building. */
  onCancel: () => void
  /** While busy, every button is disabled and Esc / backdrop are no-ops. */
  busy?: boolean
}

/**
 * Ask what to do about tests that carry no packing bands, before building.
 *
 * Parameters
 * ----------
 * open : boolean
 *     Render gate; the caller owns the lifecycle.
 * tests : readonly UnbandedTest[]
 *     The pre-flight's findings — one row each, name first.
 * onVisitTest : (test: UnbandedTest) => void
 *     Fired when a name is activated (click, Enter or Space — it is a
 *     ``<button>``).
 * onSubdivideAndBuild : () => void
 *     The default action.
 * onBuildWithout : () => void
 *     Build with these tests excluded from both the packing columns and the
 *     litho frame.
 * onCancel : () => void
 *     Close without building.
 * busy : boolean, optional
 *     Disable every control while an action is in flight.
 *
 * Returns
 * -------
 * JSX.Element
 *     The dialog (or nothing when ``open`` is false).
 */
export default function GeotechBuildPreflightDialog({
  open,
  tests,
  onVisitTest,
  onSubdivideAndBuild,
  onBuildWithout,
  onCancel,
  busy = false,
}: Props): JSX.Element {
  const t = useT()
  // Focus the DEFAULT action, not Cancel — see the header: nothing here is
  // irreversible, so the Cancel-default rule does not apply and putting focus
  // on the action he wants saves the reach for the mouse.
  const defaultRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (open) defaultRef.current?.focus()
  }, [open])

  const one = tests.length === 1
  return (
    <Modal
      open={open}
      onCancel={onCancel}
      labelledBy="geotech-build-preflight-title"
      busy={busy}
      cardClassName="w-[32rem]"
      testid="geotech-build-preflight-dialog"
    >
      <div className="p-5">
        <h2
          id="geotech-build-preflight-title"
          data-testid="geotech-build-preflight-title"
          className="mb-2 text-sm font-semibold text-text-primary"
        >
          {one
            ? t('geotech.preflightTitleOne')
            : t('geotech.preflightTitleMany', { count: tests.length })}
        </h2>
        <div className="mb-4 text-xs text-text-secondary">
          <p className="mb-2">
            {one ? t('geotech.preflightBodyOne') : t('geotech.preflightBodyMany')}
          </p>
          <ul className="space-y-1.5">
            {tests.map(test => (
              <li key={test.investigationId}>
                <button
                  type="button"
                  data-testid={`geotech-preflight-visit-${test.investigationId}`}
                  // Named as a link-shaped control because that is what it does
                  // — it navigates. Focus ring in the app's accent so it is
                  // reachable by keyboard like every other action here.
                  className="font-semibold text-accent underline underline-offset-2 hover:text-accent-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded disabled:pointer-events-none disabled:opacity-40"
                  disabled={busy}
                  onClick={() => onVisitTest(test)}
                  title={t('geotech.preflightVisitTitle', { name: test.name })}
                >
                  {test.name}
                </button>
                {/* The consequence, only where there is one (BD4): a section
                    whose litho frame survives but whose packing assembly is
                    left with fewer than two subdivided columns contributes
                    nothing between columns and leaves the build entirely. */}
                {test.droppedSections.length > 0 && (
                  <span
                    data-testid={`geotech-preflight-drop-${test.investigationId}`}
                    className="ml-1.5 text-status-amber"
                  >
                    {t('geotech.preflightDropWarning', {
                      name: test.name,
                      sections: test.droppedSections.map(s => s.sectionName).join(', '),
                    })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            size="md"
            onClick={onCancel}
            disabled={busy}
            data-testid="geotech-preflight-cancel"
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="secondary"
            size="md"
            onClick={onBuildWithout}
            disabled={busy}
            data-testid="geotech-preflight-build-without"
            title={t('geotech.preflightIgnore')}
          >
            {one ? t('geotech.preflightBuildWithoutOne') : t('geotech.preflightBuildWithoutMany')}
          </Button>
          <Button
            ref={defaultRef}
            variant="primary"
            size="md"
            onClick={onSubdivideAndBuild}
            disabled={busy}
            data-testid="geotech-preflight-subdivide"
            title={t('geotech.preflightKeep')}
          >
            {one ? t('geotech.preflightSubdivideOne') : t('geotech.preflightSubdivideMany')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

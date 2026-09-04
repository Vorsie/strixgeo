/**
 * The question the geotech subdivide asks about admixtures (owner ruling
 * 2026-09-04): *"we see you have an admixture here, which NAD classes do you
 * want, pure sand or sand with admixture."*
 *
 * One row per admixture-ambiguous litho unit, each with two radios — "Pure
 * {soil}" (the clean NAD column) or "{soil} with admixture" (the (f)/(s)
 * column). No radio is pre-checked for an un-answered unit: the owner asks the
 * engineer to decide, so Divide stays disabled until EVERY listed unit has an
 * answer. A unit already answered (the change-my-answer path) shows its stored
 * choice pre-selected and can be switched here.
 *
 * A sibling of ``GeotechBuildPreflightDialog`` in the same Build pre-flight
 * flow — kept separate because it asks a different question (which NAD family,
 * not which unbanded test) and gates the press differently (must answer, vs.
 * choose a build).
 */

import { useEffect, useRef } from 'react'

import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import { useT } from '../../../i18n/translate'
import { getLanguage } from '../../../i18n/languageSelect'
import { LITHOLOGY_LABELS, LITHOLOGY_LABELS_NL } from '../../../utils/lithoConstants'
import type { NadAdmixtureChoice } from '../../../api/clients/geology.types'
import type { AdmixtureUnit } from '../../../utils/admixtureNadChoice'

/** Props: the units to answer, the current selections, and the ways out. */
export interface Props {
  /** Truthy = render. The caller owns the open lifecycle. */
  open: boolean
  /** Admixture-ambiguous litho units in the subdivide scope. */
  units: readonly AdmixtureUnit[]
  /** Current per-unit selection (null = still unanswered). */
  selections: Readonly<Record<string, NadAdmixtureChoice | null>>
  /** Pick a NAD family for one unit. */
  onSelect: (formationId: string, choice: NadAdmixtureChoice) => void
  /** Persist the answers, then continue the press. Gated on all-answered. */
  onConfirm: () => void
  /** Close without dividing. */
  onCancel: () => void
  /** While busy, every control is disabled and Esc / backdrop are no-ops. */
  busy?: boolean
}

/** The soil's display label in the active UI language. */
function soilLabel(soilCode: string): string {
  const map = getLanguage() === 'nl' ? LITHOLOGY_LABELS_NL : LITHOLOGY_LABELS
  return map[soilCode] ?? soilCode
}

/**
 * Ask which NAD family each admixture unit is classified into, before dividing.
 *
 * @param open - render gate; the caller owns the lifecycle.
 * @param units - the admixture-ambiguous litho units.
 * @param selections - the current per-unit answer (null = unanswered).
 * @param onSelect - pick a family for one unit.
 * @param onConfirm - the default action; enabled only when every unit is answered.
 * @param onCancel - close without dividing.
 * @param busy - disable every control while an action is in flight.
 * @returns the dialog (or nothing when ``open`` is false).
 */
export default function GeotechAdmixtureChoiceDialog({
  open,
  units,
  selections,
  onSelect,
  onConfirm,
  onCancel,
  busy = false,
}: Props): JSX.Element {
  const t = useT()
  const firstRadioRef = useRef<HTMLInputElement>(null)
  // Guide the engineer to the first choice on open — Divide is disabled until
  // every unit is answered, so a disabled primary button is a poor focus target.
  useEffect(() => {
    if (open) firstRadioRef.current?.focus()
  }, [open])

  const allAnswered = units.every(u => selections[u.formationId] != null)

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      labelledBy="geotech-admixture-choice-title"
      busy={busy}
      cardClassName="w-[34rem]"
      testid="geotech-admixture-choice-dialog"
    >
      <div className="p-5">
        <h2
          id="geotech-admixture-choice-title"
          data-testid="geotech-admixture-choice-title"
          className="mb-2 text-sm font-semibold text-text-primary"
        >
          {t('geotech.admixtureChoiceTitle')}
        </h2>
        <p className="mb-4 text-xs text-text-secondary">{t('geotech.admixtureChoiceBody')}</p>
        <ul className="mb-4 space-y-3">
          {units.map((unit, unitIndex) => {
            const selected = selections[unit.formationId] ?? null
            const soil = soilLabel(unit.soilCode)
            return (
              <li
                key={unit.formationId}
                data-testid={`geotech-admixture-unit-${unit.formationId}`}
                className="rounded border border-border-subtle p-2.5"
              >
                <div className="mb-1.5 text-xs font-semibold text-text-primary">{unit.name}</div>
                <div className="flex flex-wrap gap-4 text-xs text-text-primary">
                  {(['pure', 'with_admixture'] as const).map((choice, choiceIndex) => (
                    <label
                      key={choice}
                      className="inline-flex cursor-pointer items-center gap-1.5"
                    >
                      <input
                        // Only the very first radio in the list gets the ref, so
                        // opening the dialog lands focus on the first choice.
                        ref={unitIndex === 0 && choiceIndex === 0 ? firstRadioRef : undefined}
                        type="radio"
                        name={`nad-admixture-${unit.formationId}`}
                        data-testid={`geotech-admixture-${choice}-${unit.formationId}`}
                        checked={selected === choice}
                        disabled={busy}
                        onChange={() => onSelect(unit.formationId, choice)}
                      />
                      {choice === 'pure'
                        ? t('geotech.admixturePureOption', { soil })
                        : t('geotech.admixtureWithOption', { soil })}
                    </label>
                  ))}
                </div>
              </li>
            )
          })}
        </ul>
        {!allAnswered && (
          <p
            data-testid="geotech-admixture-choice-gate"
            className="mb-3 text-xs text-text-secondary"
          >
            {t('geotech.admixtureChoiceGate')}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            size="md"
            onClick={onCancel}
            disabled={busy}
            data-testid="geotech-admixture-choice-cancel"
          >
            {t('geotech.admixtureChoiceCancel')}
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={onConfirm}
            disabled={busy || !allAnswered}
            data-testid="geotech-admixture-choice-confirm"
          >
            {t('geotech.admixtureChoiceConfirm')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

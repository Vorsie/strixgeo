// Consequence prompt for dragging a restated contact on the geotech axis.
//
// The owner asked for this in the first brainstorm — "a popup that says snap litho
// (or litho and geo in a combined case) to geotech" — and again after dogfeeding the
// build without it: "the warning, moving this boundary will move litho alongside it
// didn't appear. Or might even be litho and geo sometimes."
//
// WHY it is worth a modal on a drag. Everything else this axis does stays inside the
// geotechnical model: split a band, merge two, drag a packing boundary. This ONE gesture
// reaches up the hierarchy and edits the level above, and sometimes the level above that.
// The engineer is looking at packing bands, so nothing on screen says that the row he is
// about to move is shared with two other models. A drag whose blast radius is invisible
// is the thing the prompt exists to prevent.
//
// It is NOT styled as a destructive confirm. Nothing is lost — the move is one undo step,
// and refining a contact from the evidence is the intended workflow, not a mistake. So the
// action is the default and Cancel is the way out, which is the opposite of the
// re-subdivide dialog next door (that one destroys hand edits and defaults to Cancel).

import ConfirmDialog from './ui/ConfirmDialog'
import { useT } from '../i18n/translate'

interface Props {
  /** Truthy = render the dialog. The caller owns the open lifecycle. */
  open: boolean
  /** Fired on Cancel / Esc / backdrop — the contact stays where it was. */
  onCancel: () => void
  /** Fired on the confirm button. */
  onConfirm: () => void
  /** Both buttons disabled while the write is in flight. */
  busy?: boolean
  /** Where the contact lands, in metres below the collar. */
  depthM: number
  /**
   * Whether this litho row is derived from a geological contact.
   *
   * About a third of them are, so the sentence has to be built from the row rather than
   * assumed either way — that is the "or might even be litho and geo sometimes" case.
   */
  movesGeology: boolean
}

/**
 * Name what a restated-contact drag will move, before it moves anything.
 *
 * @returns The dialog element (or nothing when ``open`` is false).
 */
export default function MoveRestatedContactDialog({
  open,
  onCancel,
  onConfirm,
  busy = false,
  depthM,
  movesGeology,
}: Props): JSX.Element {
  const t = useT()
  return (
    <ConfirmDialog
      open={open}
      labelledBy="move-restated-contact-title"
      testid="move-restated-contact-dialog"
      cardClassName="w-[30rem]"
      cancelTestid="move-restated-contact-cancel"
      onCancel={onCancel}
      busy={busy}
      title={
        movesGeology
          ? t('sections.moveRestated.titleGeo')
          : t('sections.moveRestated.titleLitho')
      }
      body={
        <>
          <p>{t('sections.moveRestated.body', { depth: depthM.toFixed(2) })}</p>
          <ul className="mt-2 list-disc pl-5 space-y-1" data-testid="move-restated-contact-list">
            <li>{t('sections.moveRestated.bullet1')}</li>
            <li>{t('sections.moveRestated.bullet2')}</li>
            {/* Built from the row, never assumed: roughly one litho layer in three carries a
                geological parent, so a fixed sentence would be wrong most of the time. */}
            {movesGeology && (
              <li data-testid="move-restated-contact-geology">
                {t('sections.moveRestated.bullet3')}
              </li>
            )}
          </ul>
          <p className="mt-2 text-text-secondary">{t('sections.moveRestated.undoNote')}</p>
        </>
      }
      confirm={{
        label: t('sections.moveRestated.moveIt'),
        onClick: onConfirm,
        variant: 'primary',
        testid: 'move-restated-contact-confirm',
      }}
    />
  )
}

// What a close-without-save would cost, itemised.
//
// ``projectDirty`` in useProjectLifecycle is one boolean OR'd from seven
// sources, which is enough to decide whether to prompt but not enough to tell
// the engineer what is at stake. This module keeps the itemised view — a pure
// derivation, no React, no I/O — so the lifecycle hook (debt #201, already
// over the 500-line mark) does not grow another block of logic.

/**
 * What a Discard would cost, in terms the engineer can act on.
 *
 * Imports are counted per kind because the session-import id sets track them
 * individually. Interpretation edits are only a boolean: the two-stage save
 * model keeps a single "something was mutated" flag, so no count exists and
 * the dialog says so rather than inventing one.
 */
export interface UnsavedWorkSummary {
  /** False for a never-saved project: Discard deletes rather than reverts. */
  hasSavedSnapshot: boolean
  /** CPTs imported this session. */
  importedCpts: number
  /** Boreholes imported this session. */
  importedBoreholes: number
  /** Formations added to the project this session. */
  importedFormations: number
  /** Sections drawn this session. */
  importedSections: number
  /** Geological contacts created this session. */
  importedContacts: number
  /** A pre-existing row was correlated / dragged / accepted / deleted. */
  hasInterpretationEdits: boolean
  /** The metadata editor holds an uncommitted draft. */
  hasMetadataEdits: boolean
}

/** The raw session-dirty state the summary is derived from. */
export interface UnsavedWorkInputs {
  /** True once the project has been written to a .gmproj at least once. */
  hasSavedSnapshot: boolean
  sessionImportCptIds: ReadonlySet<string>
  sessionImportBoreholeIds: ReadonlySet<string>
  sessionImportFormationIds: ReadonlySet<string>
  sessionImportSectionIds: ReadonlySet<string>
  sessionImportContactIds: ReadonlySet<string>
  /** ``hasUnsavedMutations`` — a pre-existing row was touched this session. */
  hasUnsavedMutations: boolean
  /** ``metadataDirty`` — the metadata editor holds a draft. */
  metadataDirty: boolean
}

/**
 * Build the itemised summary from the session-dirty state.
 *
 * Parameters
 * ----------
 * inputs
 *     The session-import id sets plus the two dirty flags.
 *
 * Returns
 * -------
 * UnsavedWorkSummary
 *     Per-kind import counts and the two edit flags.
 */
export function buildUnsavedWorkSummary(inputs: UnsavedWorkInputs): UnsavedWorkSummary {
  return {
    hasSavedSnapshot: inputs.hasSavedSnapshot,
    importedCpts: inputs.sessionImportCptIds.size,
    importedBoreholes: inputs.sessionImportBoreholeIds.size,
    importedFormations: inputs.sessionImportFormationIds.size,
    importedSections: inputs.sessionImportSectionIds.size,
    importedContacts: inputs.sessionImportContactIds.size,
    hasInterpretationEdits: inputs.hasUnsavedMutations,
    hasMetadataEdits: inputs.metadataDirty,
  }
}

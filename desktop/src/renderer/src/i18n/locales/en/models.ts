// The three model stages — geological, lithostratigraphic, geotechnical.
//
// Part of the English message catalogue — see 'locales/en/index.ts' for the
// key-naming rules and the domain-canon carve-out.

export const MODELS = {
  // -------------------------------------------------------------------------
  // geology stage.
  // -------------------------------------------------------------------------
  'geology.formations': 'Formations',
  'geology.addFormation': 'Add formation',
  'geology.addFormationHint': 'Add a new formation to this project',
  'geology.createFormation': 'Create formation',
  'geology.editFormation': 'Edit formation',
  'geology.deleteFormation': 'Delete formation',
  'geology.deleteFormationConfirm': 'Delete formation?',
  'geology.recolorFormation': 'Recolor formation',
  'geology.newFormation': 'New formation',
  'geology.newFormationHint':
    'Create a placeholder formation — rename and recolour it in the inspector',
  'geology.reorderHint': 'Drag to reorder (lower = older)',
  'geology.dropAtBottom': 'Drop here to place at the bottom (oldest)',
  'geology.fillFromBoreholes': 'Fill from boreholes',
  'geology.build3d': 'Build 3D model',
  'geology.activeStratigraphy': 'Active stratigraphy — every formation pick belongs to this model',
  'geology.boreholesInModel': 'Boreholes in model',
  'geology.showBoreholeScopes': 'Show / hide the per-borehole scope toggles',
  'geology.showConfidenceFade': 'Show confidence fade',
  'geology.confidenceFadeHint':
    'Faded triangles in the 3D view + faded contact polylines on sections mark regions where the TIN extrapolates away from nearby data. Toggle off for a uniform colour.',
  'geology.groundSurface': 'Ground surface',
  'geology.deleteModelConfirm': 'Delete stratigraphic model?',
  'geology.deleteStratigraphy': 'Delete stratigraphy…',
  'geology.dedupeContacts': 'Dedupe contacts…',
  'geology.addToModel': 'Add to model',
  'geology.overwriteModel': 'Overwrite model',
  'geology.addOrReplace': 'Add to this model, or replace it?',
  'geology.emptyNoBoreholes':
    'No formations yet. This project has no boreholes to fill from — add a formation manually to start the model.',
  'geology.emptyWithBoreholes':
    'No formations yet. Use "Fill from boreholes" in the toolbar to seed them from borehole stratigraphy, or add one manually.',
  'geology.noStratigraphyOnSection': 'No boreholes on this section carry stratigraphy data.',
  'geology.noInterpretationData':
    'No borehole carries interpretation data — add formations manually in the inspector instead.',
  'geology.surfaceCrossingWarnings': 'Surface crossing warnings',
  'geology.surfaceValidationFailed': 'Surface validation failed',
  'geology.surfaceValidationPending': 'Surface validation pending',
  'geology.openOffendingSection':
    'Open the cross-section containing the offending contacts and pan to them.',
  'geology.noSectionForContact':
    'No cross-section contains the offending contact — draw one through the borehole or CPT to view it.',
  'geology.loadFailed':
    'Could not load the stratigraphic model — check the connection and reopen the project.',
  'geology.splitView': 'Split view',
  'geology.singleView': 'Single view',
  'geology.singleViewHint': 'Collapse back to a single view',
  'geology.drawSplitLine': 'Draw a line across the model to split it into two independently-panned views',
  'geology.cancelSplit': 'Cancel split',
  'geology.cancelSplitHint': 'Cancel the split-line draw',
  'geology.reset3dView': 'Reset 3D view',
  'geology.offlineBasemap': 'Offline — basemap unavailable. Formation geometry is unaffected.',
  // 3-D LAYERS legend chrome.
  'geology.layers': 'Layers',
  'geology.basemap': 'Basemap',
  'geology.hideBasemap': 'Hide basemap',
  'geology.showBasemap': 'Show basemap',
  'geology.hideGroundSurface': 'Hide ground surface',
  'geology.showGroundSurface': 'Show ground surface',
  'geology.showIn3d': 'Show in 3D',
  'geology.hideIn3d': 'Hide in 3D',
  'geology.thisModel': 'This model',
  'geology.splitModel': 'Split model',
  'geology.drawSplitFirst': 'Click two points to draw a split line',
  'geology.drawSplitSecond': 'Click the second point to complete the split line',
  'geology.compareWith': 'Compare with {label}',
  'geology.compareWithHint': 'Show {label} beside this model at the same viewpoint',
  // GeotechLayersTree — the nested soil ▸ class ▸ body legend rows.
  'geology.collapseNamed': 'Collapse {label}',
  'geology.expandNamed': 'Expand {label}',
  'geology.showNamedIn3d': 'Show {label} in 3D',
  'geology.hideNamedIn3d': 'Hide {label} in 3D',
  'geology.showBodyIn3d': 'Show body {label} in 3D',
  'geology.hideBodyIn3d': 'Hide body {label} in 3D',
  'geology.underConstrainedBody': 'Under-constrained body',
  'geology.switchBasemap': 'Switch basemap',
  'geology.formationCandidates': 'Formation candidates',
  'geology.targetFormationOptions': 'Target formation options',
  'geology.keepSeparate': 'Keep separate',
  'geology.applySelection': 'Apply selection',
  'geology.lumpingCollisions': 'Lumping collision warnings',
  'geology.selectFormationsBlurb':
    'Select formations to include. Use "→ same as" on a row to lump it into another formation. If your selection leaves out formations already in the model, Apply asks whether to add to the model or replace it.',
  'geology.filterFormationPlaceholder': 'Filter or type a target formation name',
  'geology.rerankPlaceholder': 'Type to re-rank or enter name…',
  'geology.noStratigraphyCandidates': 'No stratigraphy candidates found.',
  // Geology toolbar verbs + dialogs.
  'geology.scanning': 'Scanning…',
  'geology.applying': 'Applying…',
  'geology.building': 'Building…',
  'geology.cleaning': 'Cleaning…',
  'geology.deleting': 'Deleting…',
  'geology.noBoreholesVisible': 'No boreholes visible in this project',
  'geology.scanningStratigraphy': 'Scanning borehole stratigraphy…',
  'geology.applyingSelection': 'Applying selection…',
  'geology.fillTitle':
    'Discover formation names from borehole stratigraphy and select which to keep',
  'geology.buildStale': 'Build 3D model · {n} stale',
  'geology.buildNoModel': 'No active stratigraphy — create formations and contacts first',
  'geology.buildNoContacts':
    'No contacts yet — open a cross-section, then Seed from stratigraphy on the stratigraphy axis or pick contacts manually before Build',
  'geology.building3d': 'Building 3D model…',
  'geology.surfacesNeedRebuildOne': '{n} formation surface needs rebuilding — click to compute TINs',
  'geology.surfacesNeedRebuildMany':
    '{n} formation surfaces need rebuilding — click to compute TINs',
  'geology.rebuildTins': 'Rebuild TIN surfaces from current contacts',
  'geology.dedupe': 'Dedupe',
  'geology.noActiveStratigraphy': 'No active stratigraphy',
  'geology.dedupeTitle':
    'Remove duplicate (anchor, formation) contacts — keeps the most-recent pick in each group',
  'geology.resetView': 'Reset view',
  'geology.resetViewTitle': 'Reset to single 3D view and fly camera to model bounding box',
  'geology.deleteStratigraphyShort': 'Delete stratigraphy',
  'geology.deleteStratigraphyTitle':
    'Permanently delete the active stratigraphic model and all its formations, contacts, and surfaces',
  'geology.moreActions': 'More stratigraphy actions',
  'geology.applyFailed': 'Could not apply formation selection — check the connection.',
  'geology.deleteFailed': 'Could not delete the model.',
  'geology.selectionExcludePrefix': 'Your selection does not include',
  'geology.selectionExcludeSuffix': 'already in this model.',
  'geology.unitWordOne': 'unit',
  'geology.unitWordMany': 'units',
  'geology.unitCount': '{n} {unit}',
  'geology.addToModelExplain': 'keeps them and only adds what you selected.',
  'geology.overwriteExplainPrefix': 'permanently removes {n} {unit} not in your selection:',
  'geology.overwriteExplainSuffix': 'and every contact on them.',
  'geology.deleteModelBody':
    'and all its formations, contacts, and cached surfaces will be permanently deleted. This cannot be undone.',
  'geology.deleteModelButton': 'Delete stratigraphic model',
  // GeologyStage spine summary.
  'geology.summaryFormationOne': '{n} formation',
  'geology.summaryFormationMany': '{n} formations',
  'geology.summaryStale': '{n} stale',
  // Geology canvas empty state + inline CTA (geologyEmptyState / GeologyCanvas).
  'geology.emptyBuildPrompt': 'No 3D model yet — build it from the stratigraphy.',
  'geology.adding': 'Adding…',
  // Geology inspector (roster header, crossings banner, delete confirm, rows).
  'geology.stratigraphyLabel': 'Stratigraphy',
  'geology.crossingsNotChecked': 'Surface crossings not checked — Build the 3D model to validate.',
  'geology.crossingsCheckFailed':
    'Surface crossings could NOT be checked — this is not a clean result. Rebuild or reopen the project to check again.',
  'geology.crossingsDetectedOne': '{n} surface crossing detected',
  'geology.crossingsDetectedMany': '{n} surface crossings detected',
  'geology.emptyRosterHint':
    'No formations yet — Fill from boreholes or add one, then build the 3D model.',
  'geology.boreholeInModel': '{name} in model',
  'geology.deleteFormationBody':
    'and every contact + geotech unit pointing at it will be removed from the stratigraphic model. This can’t be undone (until File → Save the change isn’t in the .gmproj yet — closing without saving reverts).',
  'geology.dragToReorderNamed': 'Drag to reorder {name}',
  'geology.colorClickToChange': '{color} — click to change colour',
  'geology.changeColorOf': 'Change colour of {name}',
  // Formation selection dialog (Fill from boreholes).
  'geology.formationsFoundOne': '{n} formation found',
  'geology.formationsFoundMany': '{n} formations found',
  'geology.candAll': 'All',
  'geology.candNone': 'None',
  'geology.foundInBoreholesOne': 'found in {n} borehole',
  'geology.foundInBoreholesMany': 'found in {n} boreholes',
  'geology.updating': 'Updating…',
  'geology.boreholeWordOne': 'borehole',
  'geology.boreholeWordMany': 'boreholes',
  'geology.boundaryWordOne': 'boundary',
  'geology.boundaryWordMany': 'boundaries',
  'geology.formationWordOne': 'formation',
  'geology.formationWordMany': 'formations',
  'geology.contactWordOne': 'contact',
  'geology.contactWordMany': 'contacts',
  'geology.collisionSummary':
    '{count} {boreholeWord} had layers lumping to the same formation — kept shallowest, dropped {dropped} {boundaryWord}; review your grouping',
  'geology.collisionInBorehole': 'in borehole',
  'geology.collisionCollidingNames': ': colliding names:',
  'geology.collisionKept': '. Kept top at {top}m, dropped {dropped}.',
  'geology.deletionWarning':
    '{fCount} {formationWord} and {cCount} {contactWord} are not in your selection. Apply will ask whether to keep or remove them.',
  'geology.reassignedToClickChange': 'Reassigned to "{label}" — click to change',
  'geology.reassignToAnother': 'Reassign "{name}" to another formation',
  'geology.sameAs': '→ same as',
  'geology.useCustomName': 'Use "{name}"',
  // DOV formal-stratigraphy code surface on each candidate (owner dogfeed
  // 2026-09-05). {codes} is a comma-joined list; the per-code counts and
  // catalogue names go in the title tooltip.
  'geology.dovCodes': 'DOV: {codes}',
  'geology.dovCodeTip': '{code}: {count} {word}',
  'geology.useDovName': 'Use DOV name: {name}',
  // Geology hook toasts (useGeologicalModel / useGeologicalModelOps).
  'geology.createModelFailed': 'Could not create the stratigraphic model — check the connection.',
  'geology.scanStratigraphyFailed': 'Could not scan borehole stratigraphy — check the connection.',
  'geology.nothingCreated':
    'Nothing created — {n} layer(s) already populated. Use Dedupe or Delete model to reset, then retry.',
  'geology.removedNotInSelection': 'Removed {n} {unit} not in your selection: {names}.',
  'geology.seededContacts': 'Seeded {created} contacts.',
  'geology.seededContactsSkipped': 'Seeded {created} contacts. {skipped}',
  'geology.seedSkippedFragmentOne': '{n} layer skipped — formation not in your model.',
  'geology.seedSkippedFragmentMany': '{n} layers skipped — formation not in your model.',
  'geology.nothingSeeded': 'Nothing seeded — {skipped} Add it in the Stratigraphy stage to place it here.',
  'geology.alreadyInSyncNothingToAdd': 'Already in sync — nothing to add.',
  'geology.seedContactsFailed': 'Could not seed contacts from stratigraphy.',
  'geology.dedupeAlreadyClean': 'Already clean — no duplicates found.',
  'geology.dedupeRemoved':
    'Removed {d} duplicate {contactWord} across {g} (anchor, formation) {pairWord}.',
  'geology.pairWordOne': 'pair',
  'geology.pairWordMany': 'pairs',
  'geology.cleanupFailed': 'Could not run the cleanup — see console.',
  'geology.noFormationsToRebuild': 'No formations with picks yet — nothing to rebuild.',
  'geology.cacheInSync': 'Cache already in sync ({n} {formationWord} checked).',
  'geology.rebuiltSurfaces': 'Rebuilt {rebuilt} of {considered} {surfaceWord}',
  'geology.surfacesAlreadyCurrent': '{considered} {surfaceWord} already current',
  'geology.reorderedByDepth': '; reordered {n} {formationWord} by depth',
  'geology.surfaceWordOne': 'surface',
  'geology.surfaceWordMany': 'surfaces',
  'geology.rebuildSurfacesFailed': 'Could not rebuild surfaces — see console.',
  'geology.plaxisExported': 'Plaxis 3D script exported.',
  'geology.plaxisExportFailed': 'Could not export the Plaxis script.',

  // -------------------------------------------------------------------------
  // lithology stage.
  // -------------------------------------------------------------------------
  'litho.model': 'Lithology model',
  'litho.modelFull': 'Lithological model',
  'litho.units': 'Lithology units',
  'litho.unitsStale': 'Lithology units — 3-D model is stale, rebuild it',
  'litho.formations': 'Litho formations',
  'litho.bodySolids': 'Body solids',
  'litho.noModel': 'No lithology model',
  'litho.noUnits': 'No litho units in this model yet',
  'litho.stale': 'Stale',
  'litho.staleHint': 'Stale — rebuild to update',
  'litho.createModel': 'Create lithological model',
  'litho.createModelHint': 'Create the lithological model that refines this stratigraphic model',
  'litho.newModel': 'New lithological model',
  'litho.newModelHint': 'New lithological model (refines the active stratigraphic model)',
  'litho.newModelNameLabel': 'New lithological model name',
  'litho.modelNamePlaceholder': 'Model name…',
  'litho.activeModel': 'Active lithological model',
  'litho.deleteModel': 'Delete lithological model',
  'litho.deleteModelConfirm': 'Delete lithological model?',
  'litho.deleteModelHint': 'Delete the active lithological model',
  'litho.cancelNewModel': 'Cancel new model',
  'litho.createOneToPick': 'Create one to pick contacts on sections',
  'litho.clearModel': 'Clear all litho content for this model',
  'litho.clearModelConfirm': 'Clear litho model?',
  'litho.emptyInspector':
    'Accept CPT suggestions or draw contacts on a section — each accepted layer adds a unit here.',
  'litho.emptyCanvas':
    'Select or create a lithology model in the right panel. Draw contacts in the Sections stage, then click Build model on the Lithology toolbar to generate the 3D solid bodies.',
  'litho.createThenSections':
    'Create a lithology model above, then open the Sections stage to draw contacts.',
  'litho.drawThenBuild': 'Draw contacts on Sections, then Build to update surfaces.',
  // Debt #65: excluded-boreholes list in the Lithology inspector. Surfaces the
  // litho model's excluded_borehole_ids so an engineer can bring a borehole
  // back into the build without a backend edit.
  'litho.excludedBoreholesHeading': 'Excluded from the litho build',
  'litho.excludedBoreholesHint':
    'These boreholes are left out of the litho build. Include one again to bring it back.',
  'litho.includeBoreholeAgain': 'Include again',
  'litho.includeBoreholeAgainAria': 'Include {name} in the litho build again',
  'litho.excludedBoreholeUnknown': 'Unknown borehole',
  'litho.boreholeIncludedToast': 'Borehole included in the litho build again',
  'litho.boreholeExcludedToast': 'Borehole excluded from the litho build',
  // Debt #65 (exclude gesture): the "Boreholes in model" scope roster — the
  // in-UI gesture to exclude a borehole from the litho build (mirrors the
  // geological inspector's roster).
  'litho.boreholesInModel': 'Boreholes in model',
  'litho.showBoreholeScopes': 'Show / hide the per-borehole scope toggles',
  'litho.boreholesInModelHint': 'Uncheck a borehole to leave it out of the litho build.',
  'litho.boreholeInModel': '{name} in the litho build',
  'litho.buildToSeeBodies': 'Build the 3D model to see bodies.',
  'litho.allContentBlurb': 'All litho units, contacts, correlations and surfaces in this model',
  'litho.renumberBodies': 'Re-number litho bodies from their correlation graph',
  'litho.pickBodyColour': 'Pick a custom colour for this body solid',
  'litho.resetBodyColour': 'Reset to formation lithology colour',
  'litho.underConstrained':
    'Under-constrained: fewer than 3 CPT/borehole traces — best-effort slab',
  'litho.confidenceFadeHint':
    'Faded triangles in the 3D view mark regions where the model extrapolates away from nearby data. Toggle off for a uniform colour.',
  'litho.parentFormation': 'Parent stratigraphic formation',
  'litho.noParent': '— No parent (detach) —',
  'litho.switchSolidFence': 'Switch between solid TIN surfaces and fence-diagram walls',
  'litho.exportFence': 'Export fence',
  'litho.exportFenceHint': 'Save the 3-D fence diagram as a DXF (switch the view to Fence first)',
  'litho.resetCamera': 'Reset camera',
  'litho.resetCameraHint': 'Collapse any split view and fly the camera back to the model extent',
  'litho.nothingToBuild': 'Nothing to build — accept litho layers on a cross-section, then Build.',
  'litho.nothingToExportFence':
    'Nothing to export — switch the 3-D view to Fence and make sure the fence has walls.',
  'litho.autoCorrelateNothing':
    'Auto-correlate: no correlatable units found — accept litho suggestions first.',
  // Confirm / reassign / detach parent dialog.
  'litho.assignParent': 'Assign parent formation',
  'litho.confirmExtrapolatedParent': 'Confirm extrapolated parent',
  'litho.orphanBlurb': 'No stratigraphy contact covered this litho unit at the investigation.',
  'litho.extrapolatedBlurb':
    'The parent was inferred from the stratigraphy TIN — please confirm or change it.',
  'litho.detach': 'Detach',
  'litho.confirm': 'Confirm',
  'litho.reassign': 'Reassign',
  // Model-kind picker row.
  'litho.newShort': 'New',
  'litho.selectPlaceholder': '— select —',
  'litho.thisModelFallback': 'This model',
  'litho.deleteModelBody':
    'and all its formations, contacts, and cached surfaces will be permanently deleted. The stratigraphic parent is not affected. This cannot be undone.',
  // Lithology toolbar (Build model / fence / reset).
  'litho.building': 'Building…',
  'litho.buildModelStale': 'Build model · stale',
  'litho.buildModel': 'Build model',
  'litho.buildNoContacts':
    'No litho contacts yet — open a cross-section on the litho axis, Suggest litho, accept the layers, then return here to Build',
  'litho.buildingSolids': 'Building watertight body solids…',
  'litho.solidsStale': 'One or more body solids are stale — click to rebuild',
  'litho.buildSolidsTitle': 'Build the 3-D body solids from accepted contacts',
  // Background 3-D build (debt #282): phase labels for the progress bar + the
  // Cancel affordances. Phase keys are looked up by the backend phase name.
  'litho.building3dModel': 'Building 3-D model…',
  'litho.buildProgressStarting': 'Starting build…',
  'litho.buildProgressLabel': 'Labelling voxels…',
  'litho.buildProgressReconcile': 'Reconciling sections…',
  'litho.buildProgressExtract': 'Extracting body solids…',
  'litho.buildProgressPersist': 'Saving…',
  'litho.buildCancel': 'Cancel',
  'litho.buildCancelling': 'Cancelling…',
  'litho.buildCancelled': 'Build cancelled',
  // Lithology inspector (roster + solids legend).
  'litho.createGeoFirst':
    'Create a stratigraphic model first (Stratigraphy stage) — a lithological model refines it.',
  'litho.clearing': 'Clearing…',
  'litho.clearShort': 'Clear',
  'litho.instances': 'Instances',
  'litho.resolving': 'Resolving…',
  'litho.resolveInstances': 'Resolve instances',
  'litho.clearModelBody':
    'All litho units, contacts, correlations and surfaces in this model will be permanently deleted. This cannot be undone.',
  'litho.clearModelButton': 'Clear litho model',
  'litho.parentExtrapolatedReview': 'Parent extrapolated from TIN — click to confirm or reassign',
  'litho.noParentReview': 'No parent assigned — click to assign or detach',
  'litho.pillCounts': '{c} {cw}, {u} {uw}',
  'litho.contactWordOne': 'contact',
  'litho.contactWordMany': 'contacts',
  'litho.unitWordOne': 'unit',
  'litho.unitWordMany': 'units',
  'litho.lensDefinedOne': '{n} lens defined in this formation',
  'litho.lensDefinedMany': '{n} lenses defined in this formation',
  'litho.showMarkersN': 'Show {n} marker {bodies}',
  'litho.hideMarkersN': 'Hide {n} marker {bodies} (under-constrained)',
  'litho.bodyWordOne': 'body',
  'litho.bodyWordMany': 'bodies',
  'litho.showMarkers': 'Show markers',
  'litho.hideMarkers': 'Hide markers',
  'litho.collapseGroup': 'Collapse group',
  'litho.expandGroup': 'Expand group',
  'litho.bodyCount': '{n} {bodies}',
  'litho.markersHidden': '({n} {markers} hidden)',
  'litho.markers': '({n} {markers})',
  'litho.markerWordOne': 'marker',
  'litho.markerWordMany': 'markers',
  'litho.bodiesForName': 'Bodies for {name}',
  'litho.colourForBody': 'Colour for {name} #{ordinal}',
  // Litho hook toasts + LithoGeoSnapDialog (useLithoModelOps / useLithoSolids /
  // useLithoSuggestions / useGeologicalModel litho paths / LithologyCanvas).
  'litho.placeContactFailed': 'Could not place the litho formation contact.',
  'litho.createFormationFailed': 'Could not create the litho formation.',
  'litho.noFormationsToRebuild': 'No litho formations with contacts yet — nothing to rebuild.',
  'litho.cacheInSync': 'Litho cache in sync ({n} {surfaceWord} checked).',
  'litho.surfaceWordOne': 'surface',
  'litho.surfaceWordMany': 'surfaces',
  'litho.rebuiltSurfaces': 'Rebuilt {rebuilt} of {considered} litho {surfaceWord}.',
  'litho.rebuildSurfacesFailed': 'Could not rebuild litho surfaces — see console.',
  'litho.modelAlreadyEmpty': 'Litho model already empty.',
  'litho.clearedModel': 'Cleared litho model — {c} {contactWord}, {u} {unitWord} removed.',
  'litho.clearModelFailed': 'Could not clear litho model — see console.',
  'litho.createGeoModelFirst': 'Create a stratigraphic model before adding a lithological one.',
  'litho.createModelFailed': 'Could not create the lithological model.',
  'litho.activateModelFailed': 'Could not activate the lithological model.',
  'litho.deleteModelFailed': 'Could not delete the lithological model.',
  'litho.nothingToBuildYet': 'Nothing to build yet — open a cross-section on the litho axis first.',
  'litho.builtBodies': 'Built {n} {bodyWord}',
  'litho.nothingCouldBeBuilt': 'Nothing could be built — {reason}. The stored 3-D model was cleared.',
  'litho.uncoveredInvestigations':
    '{n} {investigationWord} outside the model footprint, with NO 3-D model: {named}{rest}',
  'litho.investigationWordOne': 'investigation',
  'litho.investigationWordMany': 'investigations',
  'litho.moreCount': ', +{n} more',
  'litho.underConstrainedBodies':
    '{n} under-constrained {bodyWord} (fewer than 3 CPT/borehole traces — slab approximation)',
  'litho.saveBodyColourFailed': 'Could not save body colour — try again.',
  'litho.gridTooLargeDefault': 'The requested grid is too large to build.',
  'litho.storedModelUnchanged': 'The stored 3-D model was not changed.',
  'litho.gridTooLargeRetry':
    '{reason} Try again with a horizontal spacing of at least {suggested} m. {untouched}',
  'litho.gridTooLargeNoRetry': '{reason} {untouched}',
  'litho.buildFailedGeneric': 'Could not build body solids — check the connection.',
  'litho.autoCorrelateFull': 'Auto-correlate: model already fully correlated — no new edges.',
  'litho.autoCorrelateCreated':
    'Auto-correlate: {created} {edgeWord} created, {existing} edge(s) already existed.',
  'litho.edgeWordOne': 'edge',
  'litho.edgeWordMany': 'edges',
  'litho.pinchOutLensOne':
    '{n} pinch-out lens candidate from crossings — shown as amber diamonds; the crossing edges were not drawn.',
  'litho.pinchOutLensMany':
    '{n} pinch-out lens candidates from crossings — shown as amber diamonds; the crossing edges were not drawn.',
  'litho.autoCorrelateFailed': 'Auto-correlate failed — see console.',
  'litho.noSuggestionsToClear': 'No correlation suggestions to clear.',
  'litho.clearedSuggestionsOne': 'Cleared {n} correlation suggestion.',
  'litho.clearedSuggestionsMany': 'Cleared {n} correlation suggestions.',
  'litho.clearSuggestionsFailed': 'Could not clear suggestions — see console.',
  'litho.noGhostToStrip': 'No ghost suggestions to strip.',
  'litho.noScopedGhostToStrip': 'No {scope} ghost suggestions to strip.',
  'litho.scopeCpt': 'cpt',
  'litho.scopeBorehole': 'borehole',
  'litho.strippedAdmixtures': 'Stripped admixtures from {n} {layerWord}.',
  'litho.layerWordOne': 'layer',
  'litho.layerWordMany': 'layers',
  'litho.noAdmixturesToRestore': 'No overridden borehole admixtures to restore.',
  'litho.restoredAdmixtures': 'Restored segmenter admixtures on {n} borehole {layerWord}.',
  'litho.fetchSuggestionsFailed': 'Could not fetch lithological suggestions.',
  'litho.acceptSuggestionFailed': 'Could not accept the litho suggestion.',
  'litho.acceptAllFailed': 'Could not accept all litho suggestions.',
  'litho.suggestedFailures': 'Suggested {ok}/{total} — {failed} failed.',
  'litho.acceptLayersFailed': 'Could not accept litho layers.',
  'litho.acceptedAnchorsInference': 'Accepted {n} {anchorWord} — inference updated.',
  'litho.acceptedAnchors': 'Accepted {n} {anchorWord}.',
  'litho.anchorWordOne': 'anchor',
  'litho.anchorWordMany': 'anchors',
  'litho.acceptedFailures': 'Accepted {ok}/{total} — {failed} failed.',
  'litho.fenceEmptyHint': 'No fence panels — accept correlations in the Sections stage',
  'litho.snapTitle': 'Snap to stratigraphic contact?',
  'litho.snapContactAt': 'The litho contact at',
  'litho.snapWithinMulti': 'sits within snap tolerance of two stratigraphic contacts.',
  'litho.snapWithinSingle': 'sits within snap tolerance of a stratigraphic contact.',
  'litho.snapPickContact': 'Pick a stratigraphic contact',
  'litho.snapDistanceAway': '({distance} m away)',
  'litho.snapGeoContactAt': 'Stratigraphic contact at',
  'litho.snapCancelKeepSeparate': 'Cancel — keep separate',
  'litho.snapMoveGeoToLitho': 'Move stratigraphic to litho',
  'litho.snapLithoToGeo': 'Snap litho to stratigraphic',

  // -------------------------------------------------------------------------
  // geotechnical stage.
  // -------------------------------------------------------------------------
  'geotech.units': 'Geotech units',
  'geotech.unitsFull': 'Geotechnical units',
  // The L1 list is soil groups now, not NAD-class rows (owner ruling 2026-08-31).
  'geotech.soilGroups': 'Geotechnical soil groups',
  'geotech.noUnits': 'No geotech units yet',
  'geotech.noBodyModel': 'No geotech body model yet',
  'geotech.noLithoModel': 'No lithological model yet',
  'geotech.selectedBody': 'Selected body',
  'geotech.estimateDisclaimer':
    'NAD packing classes are CPT-derived estimates — verify against the borehole descriptions before use.',
  'geotech.rosterBlurb':
    'Geotech units that describe ground in this model. A unit that describes nothing is not listed — there is nothing in it.',
  'geotech.runSubdivideHint':
    "Run 'Subdivide all bodies' to classify the lithological units into NAD packing classes.",
  'geotech.buildHint':
    "Run 'Subdivide all bodies' on the Sections stage (geotech axis), then click 'Build model' on the Geotechnical toolbar to generate the 3D NAD body solids.",
  'geotech.switchSolidFence': 'Switch between solid body model and fence-diagram walls',
  'geotech.resetAutoColour': 'Back to the automatic packing colour',
  // Cone-derived is the NORM and carries no badge (owner 2026-08-27); only
  // the exceptions are marked, so there is no key for a "CPT est." badge.
  'geotech.badgeCptEstPartial': 'No CPT (partial)',
  'geotech.badgeNoCpt': 'No CPT',
  'geotech.badgeConfidence':
    'Aggregated confidence of the packing-class assignment across all CPT layers',
  'geotech.badgePartialHint':
    'Most bands derived from CPT qc series. At least one had no cone in its body, so it took the weakest class seen there instead. Check the low-confidence bands before use.',
  'geotech.badgeNoCptHint':
    'No CPT data behind this class. It took the weakest class seen in the body, or the lithology floor. Verify before use.',
  'geotech.reSubdivideConfirm': 'Re-subdivide geotech model?',
  'geotech.reSubdivide': 'Re-subdivide',
  'geotech.preflightKeep':
    'Run the standard subdivide / divide steps on them, then build',
  'geotech.preflightIgnore':
    'Ignore them completely — the result is the model you had before they were imported',
  'geotech.subdivideFirst': 'Subdivide the bodies first.',
  // Re-subdivide confirm dialog body (ReSubdivideConfirmDialog). Split around
  // the bold / em-emphasised fragments so each keeps its emphasis.
  'geotech.thisSectionFallback': 'this section',
  'geotech.reSubdivideModelPre': 'Re-deriving under',
  'geotech.reSubdivideModelMid': 'clears all subdivisions',
  'geotech.reSubdivideModelWide': 'model-wide',
  'geotech.reSubdivideModelPost':
    '— every section’s packing bands and connections are rebuilt from the CPT data, and every borehole goes empty until you divide it again.',
  'geotech.reSubdivideRegenPre':
    'Re-subdividing regenerates the geotech packing connections on',
  'geotech.reSubdivideRegenPost': '— any manual connections you made there will be cleared.',
  'geotech.reSubdivideHandPre': 'It also rebuilds the packing bands on',
  'geotech.reSubdivideHandMid': 'from the CPT data, so its',
  'geotech.reSubdivideHandBandOne': '{n} hand-edited band',
  'geotech.reSubdivideHandBandMany': '{n} hand-edited bands',
  'geotech.reSubdivideHandPost':
    'go back to the segmenter’s boundaries. That cannot be recovered.',
  'geotech.reSubdivideAltPre': 'To get the automatic ties back',
  'geotech.reSubdivideAltEm': 'without',
  'geotech.reSubdivideAltPost':
    'losing your own, cancel and use Correlate packing → Auto-correlate instead.',
  // Geotech units roster (right pane) — soil ▸ litho body ▸ packing body
  // (owner ruling 2026-08-31 walk interview).
  'geotech.unitsWithBands': '{count} with bands',
  'geotech.collapseSoil': 'Collapse this soil',
  'geotech.expandSoil': 'Expand this soil',
  'geotech.collapseLithoBody': 'Collapse this litho body',
  'geotech.expandLithoBody': 'Expand this litho body',
  // A packing body whose parent litho body is not yet stamped falls in this
  // bucket rather than being dropped. Named for the CAUSE (no litho parent yet,
  // clears on the next recompute) — NOT "Ungrouped", which would collide with the
  // manual "(group N)" Join vocabulary on the same leaves (ux-reviewer 2026-09-01).
  'geotech.noLithoBody': 'No litho body',
  // The manual-group tag on a packing body joined into a group (debt #278 D4).
  // FLAG: owner-confirmable — "(group N)" vs "(group 1)" placement.
  'geotech.groupTag': '(group {count})',
  // The grouped-body Parameters header (debt #278 D2). FLAG: owner-confirmable
  // wording ("Group N — N bodies") + heading.
  'geotech.groupHeader': 'Group {group} — {count} bodies',
  'geotech.groupProvenanceHeading': 'Source litho bodies',
  'geotech.soilBodies': '{soil} litho bodies',
  'geotech.packingBodiesIn': 'Packing bodies in {label}',
  'geotech.bandLabel': '{count} band',
  'geotech.bandsLabel': '{count} bands',
  'geotech.contactLabel': '{count} contact in this model',
  'geotech.contactsLabel': '{count} contacts in this model',
  'geotech.chooseColor': '{color} — click to choose a colour for this unit',
  'geotech.colorForUnit': 'Colour for {label}',
  'geotech.sampleSource': 'Sample source:',
  // Geotech hook toasts + shell components (useGeologicalModel geotech paths /
  // useGeotechBuildPreflight / GeotechnicalToolbar / GeotechnicalCanvas /
  // GeotechnicalInspector / geotechBadges / GeotechBuildPreflightDialog /
  // GeotechBuildReportBanner). The build verbs Build model / Building… /
  // Build model · stale / Export fence / Reset camera reuse the litho.* keys.
  'geotech.selectLithoModelFirst': 'Select a lithological model first.',
  'geotech.subdivideAllBodiesFailed': 'Subdivide all bodies failed — see console.',
  'geotech.subdivideCptsFailed': 'Subdivide CPTs failed — see console.',
  'geotech.tieReviewOne':
    '{n} accepted packing tie needs checking — the band it was drawn on changed. Look for the ! marks on the geotech sections.',
  'geotech.tieReviewMany':
    '{n} accepted packing ties need checking — the band it was drawn on changed. Look for the ! marks on the geotech sections.',
  'geotech.tieReviewBoreholeOne':
    '{n} accepted packing tie needs checking — the borehole band it was drawn on changed. Look for the ! marks on the geotech sections.',
  'geotech.tieReviewBoreholeMany':
    '{n} accepted packing ties need checking — the borehole band it was drawn on changed. Look for the ! marks on the geotech sections.',
  'geotech.divideBoreholesNeedsCpts': 'Run "1 · Subdivide CPTs" before dividing boreholes.',
  'geotech.noBoreholeSelected': 'No borehole selected — nothing to divide.',
  'geotech.divideBoreholesFailed': 'Divide boreholes failed — see console.',
  'geotech.confidenceHigh': 'High',
  'geotech.confidenceMedium': 'Medium',
  'geotech.confidenceLow': 'Low',
  'geotech.nadClassParen': '(NAD {nad})',
  'geotech.noLithoModelHint':
    'Create a lithological model in the Lithology stage and accept litho suggestions, then return here to build the 3D geotechnical model.',
  'geotech.fenceEmptyHint': 'No fence panels — connect packing bands on the Sections stage',
  'geotech.subdividing': 'Subdividing…',
  'geotech.buildNoBands':
    'No geotech bands yet — run "Subdivide all bodies" on the Sections stage (geotech axis) first, then Build',
  'geotech.buildSubdividingTitle': 'Subdividing the tests that had no packing bands, then building…',
  'geotech.buildingSolidsTitle': 'Building watertight NAD body solids…',
  'geotech.solidsStaleTitle': 'One or more geotech body solids are stale — click to rebuild',
  'geotech.buildSolidsTitle': 'Build the 3-D NAD body solids from the geotech partition',
  'geotech.excludedTestsOne': '{count} test excluded',
  'geotech.excludedTestsMany': '{count} tests excluded',
  'geotech.excludedTitleOne':
    'The last build ignored {names} — it has no packing bands, so the model is the one you had before it was imported.',
  'geotech.excludedTitleMany':
    'The last build ignored {names} — they have no packing bands, so the model is the one you had before they were imported.',
  'geotech.excludedClickHint': 'Click to open the next one on a cross-section.',
  'geotech.excludedAriaHint': 'Activate to open the next excluded test.',
  'geotech.preflightTitleOne': 'This test has no packing bands yet',
  'geotech.preflightTitleMany': 'These {count} tests have no packing bands yet',
  'geotech.preflightBodyOne':
    'It is part of the model the build is framed on, so the build would draw a gap around it with no packing data to fill. Open it to subdivide it by hand, or choose one of the two builds below.',
  'geotech.preflightBodyMany':
    'They are part of the model the build is framed on, so the build would draw a gap around them with no packing data to fill. Open each one to subdivide it by hand, or choose one of the two builds below.',
  'geotech.preflightVisitTitle': 'Open {name} on a cross-section that carries it',
  'geotech.preflightDropWarning':
    '— Building without {name} removes {sections} from the build; its space fills from the neighbouring sections.',
  'geotech.preflightBuildWithoutOne': 'Build without it',
  'geotech.preflightBuildWithoutMany': 'Build without them',
  'geotech.preflightSubdivideOne': 'Subdivide it & build',
  'geotech.preflightSubdivideMany': 'Subdivide them & build',
  'geotech.preflightGiveUpOne':
    '{names} still has no packing bands, so nothing was built — subdivide on the Sections stage, then Build again.',
  'geotech.preflightGiveUpMany':
    '{names} still have no packing bands, so nothing was built — subdivide on the Sections stage, then Build again.',
  'geotech.reportBroken': '{failed} of {total} model guarantees broken{tail}',
  'geotech.reportNotCheckedTail': ', {n} not checked',
  'geotech.reportHeld': '{held} of {total} model guarantees held, {n} not checked',
  'geotech.reportClean': 'no gaps — all {total} model guarantees held',
  'geotech.reportVisitSpot': 'Open {name} at this spot',
  'geotech.reportSectionFallback': 'the section',
  'geotech.reportShowMe': 'Show me',
  'geotech.reportNotChecked': 'Not checked — {reason}.',
  'geotech.reportModelCheck': 'Model check',
  'geotech.reportHideDetail': 'Hide the detail',
  'geotech.reportShowDetail': 'Show every guarantee and where it stands',
  'geotech.reportLess': 'Less',
  'geotech.reportDetail': 'Detail',
  // Admixture → NAD-family prompt (owner ruling 2026-09-04, refined 2026-09-05:
  // name the admixture found; only the clay/silt or sand fork is asked, gravel
  // never). Asked before the subdivide for units the NAD table can read two ways.
  'geotech.admixtureChoiceTitle': 'Which NAD classes for these admixtures?',
  'geotech.admixtureChoiceBody':
    'These units carry a clay/silt or sand admixture the NAD table can classify two ways. Choose, per unit, whether to classify it as the plain soil or with its admixture before dividing.',
  // Names the specific admixture found, so the engineer sees WHY it is asked.
  'geotech.admixtureFound': 'This {soil} carries a {admixture} admixture.',
  'geotech.admixturePureOption': 'Plain {soil}',
  // The "with" option names the family the soil forks on: clay/silt for a coarse
  // soil, sand for a fine soil.
  'geotech.admixtureWithOptionFines': '{soil} with clay/silt admixture',
  'geotech.admixtureWithOptionSand': '{soil} with sand admixture',
  'geotech.admixtureChoiceConfirm': 'Divide',
  'geotech.admixtureChoiceCancel': 'Cancel',
  'geotech.admixtureChoiceGate': 'Choose a class for every unit to continue.',
  'geotech.admixtureChoiceReopen': 'Admixture NAD choices',
  'geotech.admixtureChoiceReopenTitle':
    'Review or change which NAD family each admixture unit is classified into.',
  'geotech.admixtureChoiceSaveFailed': 'Could not save the admixture NAD choices — nothing was divided.',
} as const
